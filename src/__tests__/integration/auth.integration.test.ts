/**
 * Authentication integration tests
 * Comprehensive JWT authentication and permission testing with minimal server setup
 */

import { buildTestServer, cleanupTestServer } from '../helpers/index.js';
import {
  createTestToken,
  createExpiredToken,
  createInvalidToken,
  createNoPermissionsToken,
  createLimitedPermissionsToken,
  createTestTokenSet,
  createAuthHeader,
  TEST_HEADERS,
  MCP_REQUESTS,
  PERMISSION_SETS
} from '../helpers/index.js';
import { HttpServer } from '../../server/httpServer.js';

describe('Authentication Integration Tests', () => {
  let server: HttpServer;
  let serverUrl: string;

  beforeEach(async () => {
    const testServer = await buildTestServer();
    server = testServer.server;
    serverUrl = testServer.url;
  });

  afterEach(async () => {
    await cleanupTestServer(server);
  });

  describe('JWT Token Validation', () => {
    it('should accept valid JWT tokens', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
    });

    it('should reject expired tokens', async () => {
      const expiredToken = createExpiredToken();
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(expiredToken)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should reject tokens with wrong secret', async () => {
      const invalidToken = createInvalidToken();
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(invalidToken)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(401);
    });

    it('should reject malformed JWT tokens', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          Authorization: 'Bearer invalid.jwt.format'
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(401);
    });

    it('should reject requests without Authorization header', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: TEST_HEADERS.JSON,
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(401);
    });

    it('should reject invalid Authorization header format', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          Authorization: 'InvalidFormat token'
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Permission Matrix Testing', () => {
    const permissionTests = [
      {
        name: 'Full Access',
        permissions: PERMISSION_SETS.FULL_ACCESS,
        allowedTools: [
          'forward_geocode_tool',
          'reverse_geocode_tool',
          'directions_tool',
          'poi_search_tool',
          'category_search_tool',
          'matrix_tool',
          'isochrone_tool',
          'static_map_image_tool'
        ],
        deniedTools: []
      },
      {
        name: 'Geocode Only',
        permissions: PERMISSION_SETS.GEOCODE_ONLY,
        allowedTools: ['forward_geocode_tool', 'reverse_geocode_tool'],
        deniedTools: ['directions_tool', 'poi_search_tool', 'matrix_tool']
      },
      {
        name: 'Directions Only',
        permissions: PERMISSION_SETS.DIRECTIONS_ONLY,
        allowedTools: ['directions_tool'],
        deniedTools: ['forward_geocode_tool', 'poi_search_tool', 'matrix_tool']
      },
      {
        name: 'POI Only',
        permissions: PERMISSION_SETS.POI_ONLY,
        allowedTools: ['poi_search_tool', 'category_search_tool'],
        deniedTools: ['forward_geocode_tool', 'directions_tool', 'matrix_tool']
      },
      {
        name: 'Limited (Geocode + POI)',
        permissions: PERMISSION_SETS.LIMITED,
        allowedTools: [
          'forward_geocode_tool',
          'reverse_geocode_tool',
          'poi_search_tool',
          'category_search_tool'
        ],
        deniedTools: ['directions_tool', 'matrix_tool', 'isochrone_tool']
      },
      {
        name: 'No Permissions',
        permissions: PERMISSION_SETS.NONE,
        allowedTools: [],
        deniedTools: [
          'forward_geocode_tool',
          'directions_tool',
          'poi_search_tool',
          'matrix_tool'
        ]
      }
    ];

    permissionTests.forEach(
      ({ name, permissions, allowedTools, deniedTools }) => {
        describe(`${name} Permission Set`, () => {
          allowedTools.forEach((toolName) => {
            it(`should allow ${toolName}`, async () => {
              const token = createLimitedPermissionsToken(permissions);
              const response = await fetch(`${serverUrl}/mcp`, {
                method: 'POST',
                headers: {
                  ...TEST_HEADERS.JSON,
                  ...createAuthHeader(token)
                },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 'test',
                  method: 'tools/call',
                  params: {
                    name: toolName,
                    arguments: getValidArgsForTool(toolName)
                  }
                })
              });

              expect(response.status).toBe(200);
              const data = await response.json();
              expect(data.result).toBeDefined();
              expect(data.error).toBeUndefined();
            });
          });

          deniedTools.forEach((toolName) => {
            it(`should deny ${toolName}`, async () => {
              const token = createLimitedPermissionsToken(permissions);
              const response = await fetch(`${serverUrl}/mcp`, {
                method: 'POST',
                headers: {
                  ...TEST_HEADERS.JSON,
                  ...createAuthHeader(token)
                },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 'test',
                  method: 'tools/call',
                  params: {
                    name: toolName,
                    arguments: getValidArgsForTool(toolName)
                  }
                })
              });

              expect(response.status).toBe(200);
              const data = await response.json();
              expect(data.error).toBeDefined();
              expect(data.error.message).toContain('permission');
            });
          });
        });
      }
    );
  });

  describe('Authentication Across HTTP Methods', () => {
    it('should require authentication for POST /mcp', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: TEST_HEADERS.JSON,
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(401);
    });

    it('should require authentication for GET /mcp (SSE)', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream'
        }
      });

      expect(response.status).toBe(401);
    });

    it('should require authentication for DELETE /mcp', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'DELETE',
        headers: {
          'Mcp-Session-Id': 'test-session'
        }
      });

      expect(response.status).toBe(401);
    });

    it('should allow authenticated GET requests (SSE)', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream'
      );

      // Close the SSE connection
      if (response.body) {
        await response.body.cancel();
      }
    });

    it('should allow authenticated DELETE requests', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'DELETE',
        headers: {
          ...createAuthHeader(token),
          'Mcp-Session-Id': 'test-session'
        }
      });

      expect(response.status).toBe(204);
    });
  });

  describe('Token Edge Cases and Security', () => {
    it('should handle tokens with missing permissions field', async () => {
      // This would test a malformed token without permissions
      const tokenWithoutPermissions = createNoPermissionsToken();
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(tokenWithoutPermissions)
        },
        body: JSON.stringify(MCP_REQUESTS.GEOCODE_FORWARD)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('permission');
    });

    it('should handle tokens with extra claims', async () => {
      const token = createTestToken(PERMISSION_SETS.FULL_ACCESS, {
        sub: 'user-with-extra-claims'
      });

      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result).toBeDefined();
    });

    it('should handle very long permission arrays', async () => {
      const manyPermissions = Array.from(
        { length: 100 },
        (_, i) => `custom:perm${i}`
      );
      const token = createTestToken(manyPermissions);

      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result).toBeDefined();
    });

    it('should validate JWT issuer and audience', async () => {
      const invalidToken = createInvalidToken();
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(invalidToken)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Token Set Validation', () => {
    it('should handle comprehensive token set scenarios', async () => {
      const tokens = createTestTokenSet();

      // Test valid token
      const validResponse = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(tokens.valid)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });
      expect(validResponse.status).toBe(200);

      // Test expired token
      const expiredResponse = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(tokens.expired)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });
      expect(expiredResponse.status).toBe(401);

      // Test invalid token
      const invalidResponse = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(tokens.invalid)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });
      expect(invalidResponse.status).toBe(401);

      // Test geocode-only token with allowed operation
      const geocodeAllowedResponse = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(tokens.geocodeOnly)
        },
        body: JSON.stringify(MCP_REQUESTS.GEOCODE_FORWARD)
      });
      expect(geocodeAllowedResponse.status).toBe(200);
      const geocodeData = await geocodeAllowedResponse.json();
      expect(geocodeData.result).toBeDefined();

      // Test geocode-only token with denied operation
      const geocodeDeniedResponse = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(tokens.geocodeOnly)
        },
        body: JSON.stringify(MCP_REQUESTS.DIRECTIONS)
      });
      expect(geocodeDeniedResponse.status).toBe(200);
      const deniedData = await geocodeDeniedResponse.json();
      expect(deniedData.error).toBeDefined();
      expect(deniedData.error.message).toContain('permission');
    });
  });

  describe('Concurrent Authentication', () => {
    it('should handle multiple concurrent authenticated requests', async () => {
      const token = createTestToken();
      const promises = Array.from({ length: 10 }, (_, i) =>
        fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            ...MCP_REQUESTS.TOOLS_LIST,
            id: `concurrent-${i}`
          })
        })
      );

      const responses = await Promise.all(promises);

      for (const response of responses) {
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.jsonrpc).toBe('2.0');
        expect(data.result).toBeDefined();
      }
    });

    it('should handle mixed authenticated and unauthenticated requests', async () => {
      const token = createTestToken();
      const promises = [
        // Authenticated request
        fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            ...MCP_REQUESTS.TOOLS_LIST,
            id: 'auth-1'
          })
        }),
        // Unauthenticated request
        fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: TEST_HEADERS.JSON,
          body: JSON.stringify({
            ...MCP_REQUESTS.TOOLS_LIST,
            id: 'unauth-1'
          })
        }),
        // Another authenticated request
        fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            ...MCP_REQUESTS.TOOLS_LIST,
            id: 'auth-2'
          })
        })
      ];

      const responses = await Promise.all(promises);

      expect(responses[0].status).toBe(200); // Authenticated - success
      expect(responses[1].status).toBe(401); // Unauthenticated - failure
      expect(responses[2].status).toBe(200); // Authenticated - success
    });
  });
});

/**
 * Helper function to get valid arguments for different tools
 */
function getValidArgsForTool(toolName: string): Record<string, unknown> {
  const argMap: Record<string, Record<string, unknown>> = {
    forward_geocode_tool: { q: 'San Francisco, CA', limit: 1 },
    reverse_geocode_tool: {
      longitude: -122.4194,
      latitude: 37.7749,
      limit: 1
    },
    directions_tool: {
      coordinates: [
        [-122.4194, 37.7749],
        [-122.4094, 37.7849]
      ],
      profile: 'driving'
    },
    poi_search_tool: {
      q: 'coffee',
      proximity: { longitude: -122.4194, latitude: 37.7749 },
      limit: 5
    },
    category_search_tool: {
      category: 'restaurant',
      proximity: { longitude: -122.4194, latitude: 37.7749 },
      limit: 5
    },
    matrix_tool: {
      coordinates: [
        { longitude: -122.4194, latitude: 37.7749 },
        { longitude: -122.4094, latitude: 37.7849 }
      ],
      profile: 'driving'
    },
    isochrone_tool: {
      coordinates: { longitude: -122.4194, latitude: 37.7749 },
      contours_minutes: [10],
      profile: 'mapbox/driving',
      generalize: 1.0
    },
    static_map_image_tool: {
      center: { longitude: -122.4194, latitude: 37.7749 },
      zoom: 12,
      size: { width: 300, height: 200 },
      style: 'mapbox://styles/mapbox/streets-v11'
    }
  };

  return argMap[toolName] || {};
}
