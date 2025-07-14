/**
 * Unit tests for authentication logic using fastify.inject()
 * Tests JWT validation and permission checking without full server
 */

import { buildTestApp } from '../helpers/index.js';
import {
  createTestToken,
  createExpiredToken,
  createInvalidToken,
  createNoPermissionsToken,
  createLimitedPermissionsToken,
  createAuthHeader,
  PERMISSION_SETS,
  extractTokenPayload
} from '../helpers/index.js';
import {
  TEST_HEADERS,
  MCP_REQUESTS,
  validateSseHeaders
} from '../helpers/index.js';

describe('Authentication Unit Tests', () => {
  describe('JWT Token Validation', () => {
    it('should accept valid JWT tokens', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
    });

    it('should reject expired tokens', async () => {
      const app = await buildTestApp();
      const expiredToken = createExpiredToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(expiredToken)
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(401);
      const data = response.json();
      expect(data.error).toBeDefined();
    });

    it('should reject tokens with wrong secret', async () => {
      const app = await buildTestApp();
      const invalidToken = createInvalidToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(invalidToken)
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject malformed JWT tokens', async () => {
      const app = await buildTestApp();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          Authorization: 'Bearer invalid.jwt.format'
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(401);
    });

    it('should validate token structure', async () => {
      const token = createTestToken();
      const payload = extractTokenPayload(token);

      expect(payload.iss).toBe('mapbox-mcp-server');
      expect(payload.aud).toBe('mapbox-mcp-server');
      expect(payload.sub).toBe('test-user');
      expect(payload.permissions).toEqual(['mapbox:*']);
      expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
    });
  });

  describe('Permission Validation', () => {
    it('should allow wildcard permissions', async () => {
      const app = await buildTestApp();
      const token = createTestToken(PERMISSION_SETS.FULL_ACCESS);

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.GEOCODE_FORWARD
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.result).toBeDefined();
    });

    it('should allow specific permissions for matching tools', async () => {
      const app = await buildTestApp();
      const token = createLimitedPermissionsToken(PERMISSION_SETS.GEOCODE_ONLY);

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.GEOCODE_FORWARD
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.result).toBeDefined();
    });

    it('should reject insufficient permissions', async () => {
      const app = await buildTestApp();
      const token = createLimitedPermissionsToken(
        PERMISSION_SETS.DIRECTIONS_ONLY
      );

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.GEOCODE_FORWARD // Requires geocode permission
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('permission');
    });

    it('should reject tokens with no permissions', async () => {
      const app = await buildTestApp();
      const token = createNoPermissionsToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.GEOCODE_FORWARD
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('permission');
    });
  });

  describe('Permission Matrix Testing', () => {
    const testCases = [
      {
        permissions: PERMISSION_SETS.GEOCODE_ONLY,
        allowedTools: ['forward_geocode_tool', 'reverse_geocode_tool'],
        deniedTools: ['directions_tool', 'poi_search_tool']
      },
      {
        permissions: PERMISSION_SETS.DIRECTIONS_ONLY,
        allowedTools: ['directions_tool'],
        deniedTools: ['forward_geocode_tool', 'poi_search_tool']
      },
      {
        permissions: PERMISSION_SETS.POI_ONLY,
        allowedTools: ['poi_search_tool', 'category_search_tool'],
        deniedTools: ['forward_geocode_tool', 'directions_tool']
      }
    ];

    testCases.forEach(({ permissions, allowedTools, deniedTools }) => {
      describe(`Permission set: ${permissions.join(', ')}`, () => {
        allowedTools.forEach((toolName) => {
          it(`should allow ${toolName}`, async () => {
            const app = await buildTestApp();
            const token = createLimitedPermissionsToken(permissions);

            const response = await app.inject({
              method: 'POST',
              url: '/messages',
              headers: {
                ...TEST_HEADERS.JSON,
                ...createAuthHeader(token)
              },
              payload: {
                jsonrpc: '2.0',
                id: 'test',
                method: 'tools/call',
                params: {
                  name: toolName,
                  arguments: getValidArgsForTool(toolName)
                }
              }
            });

            expect(response.statusCode).toBe(200);
            const data = response.json();
            expect(data.result).toBeDefined();
          });
        });

        deniedTools.forEach((toolName) => {
          it(`should deny ${toolName}`, async () => {
            const app = await buildTestApp();
            const token = createLimitedPermissionsToken(permissions);

            const response = await app.inject({
              method: 'POST',
              url: '/messages',
              headers: {
                ...TEST_HEADERS.JSON,
                ...createAuthHeader(token)
              },
              payload: {
                jsonrpc: '2.0',
                id: 'test',
                method: 'tools/call',
                params: {
                  name: toolName,
                  arguments: getValidArgsForTool(toolName)
                }
              }
            });

            expect(response.statusCode).toBe(200);
            const data = response.json();
            expect(data.error).toBeDefined();
            expect(data.error.message).toContain('permission');
          });
        });
      });
    });
  });

  describe('Authentication for Different HTTP Methods', () => {
    it('should require auth for GET /messages (SSE)', async () => {
      const app = await buildTestApp();

      const response = await app.inject({
        method: 'GET',
        url: '/messages',
        headers: TEST_HEADERS.SSE
      });

      expect(response.statusCode).toBe(401);
    });

    it('should require auth for DELETE /messages', async () => {
      const app = await buildTestApp();

      const response = await app.inject({
        method: 'DELETE',
        url: '/messages',
        headers: {
          'Mcp-Session-Id': 'test-session'
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('should allow authenticated GET requests for SSE', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'GET',
        url: '/messages',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        },
        payloadAsStream: true // Enable streaming mode for SSE testing
      });

      // Test SSE connection establishment
      expect(response.statusCode).toBe(200);

      // Validate SSE-specific headers
      validateSseHeaders(response.headers);

      // Verify session ID is generated
      expect(response.headers['mcp-session-id']).toBeTruthy();

      // No need to test streaming data - just connection establishment
    });

    it('should allow authenticated DELETE requests', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'DELETE',
        url: '/messages',
        headers: {
          ...createAuthHeader(token),
          'Mcp-Session-Id': 'test-session'
        }
      });

      expect(response.statusCode).toBe(204);
    });
  });

  describe('Token Edge Cases', () => {
    it('should handle tokens with extra claims', async () => {
      const app = await buildTestApp();
      const token = createTestToken(PERMISSION_SETS.FULL_ACCESS, {
        sub: 'user-with-extra-claims'
      });

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(200);
    });

    it('should handle very long permission lists', async () => {
      const app = await buildTestApp();
      const manyPermissions = Array.from(
        { length: 50 },
        (_, i) => `custom:perm${i}`
      );
      const token = createTestToken(manyPermissions);

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(200);
    });

    it('should handle tokens with undefined permissions', async () => {
      const app = await buildTestApp();
      const token = createTestToken([]);

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      // Empty permissions should still allow tools/list but no tools execution
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.result).toBeDefined();
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
      profile: 'mapbox/driving'
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
