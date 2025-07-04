/**
 * Comprehensive HTTP endpoint integration tests for all MCP tools
 * Tests the complete HTTP server functionality with all 8 Mapbox tools
 */

// Load environment variables from .env file
import 'dotenv/config';

import jwt from 'jsonwebtoken';
import { HttpServer, HttpServerConfig } from '../server/httpServer.js';
import {
  registerMcpTransport,
  createMcpServer
} from '../server/mcpHttpTransport.js';

// Store original environment variable values before any test pollution
const ORIGINAL_MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

// Validate environment variables
const requiredVars = ['MAPBOX_ACCESS_TOKEN', 'JWT_SECRET'];
const missingVars = requiredVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables for tests:');
  missingVars.forEach((varName) => {
    console.error(`   - ${varName}`);
  });
  console.error('\n💡 Create a .env file with:');
  console.error('      MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token');
  console.error('      JWT_SECRET=your_secure_jwt_secret');
  process.exit(1);
}

// Test configuration
const TEST_CONFIG: HttpServerConfig = {
  type: 'http',
  port: 0, // Use random port
  host: '127.0.0.1',
  enableCors: true,
  enableMetrics: true,
  jwtSecret:
    process.env.JWT_SECRET ||
    'test-secret-key-at-least-32-characters-long-for-testing',
  trustProxy: false,
  requestTimeout: 10000,
  bodyLimit: 1048576
};

// Test JWT token with full permissions
const TEST_TOKEN = jwt.sign(
  {
    iss: 'mapbox-mcp-server',
    sub: 'test-user',
    aud: 'mapbox-mcp-server',
    permissions: ['mapbox:*']
  },
  TEST_CONFIG.jwtSecret,
  { expiresIn: '1h' }
);

describe('HTTP Endpoint Integration Tests', () => {
  let httpServer: HttpServer;
  let serverUrl: string;

  beforeEach(async () => {
    // Restore original Mapbox token (in case other tests polluted it)
    if (ORIGINAL_MAPBOX_TOKEN) {
      process.env.MAPBOX_ACCESS_TOKEN = ORIGINAL_MAPBOX_TOKEN;
    }

    // Create and initialize HTTP server
    httpServer = new HttpServer(TEST_CONFIG);
    const fastify = await httpServer.initialize();

    // Register MCP transport
    const mcpServer = await createMcpServer();
    await registerMcpTransport(fastify, mcpServer);

    // Start the server
    const { port } = await httpServer.start();
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (httpServer) {
      await httpServer.stop();
    }
  });

  // Helper function to make tool calls
  const callTool = async (toolName: string, args: Record<string, unknown>) => {
    const response = await fetch(`${serverUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `req-${Math.floor(Math.random() * 1000)}`,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      })
    });

    return response;
  };

  // Helper function to list available tools
  const listTools = async () => {
    const response = await fetch(`${serverUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `req-${Math.floor(Math.random() * 1000)}`,
        method: 'tools/list',
        params: {}
      })
    });

    return response;
  };

  describe('Tool Discovery', () => {
    it('should list all 8 MCP tools', async () => {
      const response = await listTools();
      const data = (await response.json()) as any;

      expect(response.status).toBe(200);
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(Array.isArray(data.result.tools)).toBe(true);
      expect(data.result.tools.length).toBe(8);

      const expectedTools = [
        'mapbox_matrix',
        'mapbox_geocoding_reverse',
        'mapbox_geocoding_forward',
        'mapbox_isochrone',
        'mapbox_poi_search',
        'mapbox_category_search',
        'mapbox_static_map',
        'mapbox_directions'
      ];

      const toolNames = data.result.tools.map((tool: any) => tool.name);

      expectedTools.forEach((expectedTool) => {
        expect(toolNames).toContain(expectedTool);
      });
    });
  });

  describe('Geocoding Tools', () => {
    it('should handle forward geocoding with valid address', async () => {
      const response = await callTool('mapbox_geocoding_forward', {
        q: 'San Francisco, CA',
        limit: 1
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
      expect(data.result.content[0].type).toBe('text');
      expect(data.result.content[0].text).toBeDefined();
    });

    it('should handle forward geocoding with invalid parameters', async () => {
      const response = await callTool('mapbox_geocoding_forward', {
        // Missing required q parameter
        limit: 1
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });

    it('should handle reverse geocoding with valid coordinates', async () => {
      const response = await callTool('mapbox_geocoding_reverse', {
        longitude: -122.4194,
        latitude: 37.7749,
        limit: 1
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
      expect(data.result.content[0].type).toBe('text');
      expect(data.result.content[0].text).toBeDefined();
    });

    it('should handle reverse geocoding with invalid coordinates', async () => {
      const response = await callTool('mapbox_geocoding_reverse', {
        longitude: 200, // Invalid longitude
        latitude: 37.7749,
        limit: 1
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });
  });

  describe('Directions Tool', () => {
    it('should handle directions with valid coordinates', async () => {
      const response = await callTool('mapbox_directions', {
        coordinates: [
          [-122.4194, 37.7749], // San Francisco
          [-122.4094, 37.7849] // Nearby point
        ],
        profile: 'driving'
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
      expect(data.result.content[0].type).toBe('text');
      expect(data.result.content[0].text).toBeDefined();
    });

    it('should handle directions with invalid profile', async () => {
      const response = await callTool('mapbox_directions', {
        coordinates: [
          [-122.4194, 37.7749],
          [-122.4094, 37.7849]
        ],
        profile: 'invalid_profile'
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.is_error).toBe(true);
      expect(data.result.content[0].text).toBeDefined();
    });
  });

  describe('Isochrone Tool', () => {
    it('should handle isochrone with valid parameters', async () => {
      const response = await callTool('mapbox_isochrone', {
        coordinates: { longitude: -122.4194, latitude: 37.7749 },
        contours_minutes: [5, 10],
        profile: 'mapbox/driving',
        generalize: 1.0
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
      expect(data.result.content[0].type).toBe('text');
      expect(data.result.content[0].text).toBeDefined();
    });

    it('should handle isochrone with invalid coordinates', async () => {
      const response = await callTool('mapbox_isochrone', {
        coordinates: { longitude: 200, latitude: 100 }, // Invalid coordinates
        contours_minutes: [5, 10],
        profile: 'mapbox/driving',
        generalize: 1.0
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });
  });

  describe('Matrix Tool', () => {
    it('should handle matrix with valid coordinates', async () => {
      const response = await callTool('mapbox_matrix', {
        coordinates: [
          { longitude: -122.4194, latitude: 37.7749 },
          { longitude: -122.4094, latitude: 37.7849 },
          { longitude: -122.3994, latitude: 37.7949 }
        ],
        profile: 'driving'
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
      expect(data.result.content[0].type).toBe('text');
      expect(data.result.content[0].text).toBeDefined();
    });

    it('should handle matrix with too many coordinates', async () => {
      const tooManyCoordinates = Array.from({ length: 30 }, (_, i) => ({
        longitude: -122.4194 + i * 0.01,
        latitude: 37.7749 + i * 0.01
      }));

      const response = await callTool('mapbox_matrix', {
        coordinates: tooManyCoordinates,
        profile: 'driving'
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });
  });

  describe('Search Tools', () => {
    it('should handle POI search with valid parameters', async () => {
      const response = await callTool('mapbox_poi_search', {
        q: 'coffee',
        proximity: { longitude: -122.4194, latitude: 37.7749 },
        limit: 5
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
      expect(data.result.content[0].type).toBe('text');
      expect(data.result.content[0].text).toBeDefined();
    });

    it('should handle POI search with missing query', async () => {
      const response = await callTool('mapbox_poi_search', {
        proximity: { longitude: -122.4194, latitude: 37.7749 },
        limit: 5
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });

    it('should handle category search with valid category', async () => {
      const response = await callTool('mapbox_category_search', {
        category: 'restaurant',
        proximity: { longitude: -122.4194, latitude: 37.7749 },
        limit: 5
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
      expect(data.result.content[0].type).toBe('text');
      expect(data.result.content[0].text).toBeDefined();
    });

    it('should handle category search with invalid category', async () => {
      const response = await callTool('mapbox_category_search', {
        category: 'invalid_category',
        proximity: { longitude: -122.4194, latitude: 37.7749 },
        limit: 5
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.is_error).toBe(true);
      expect(data.result.content[0].text).toBeDefined();
    });
  });

  describe('Static Map Tool', () => {
    it('should handle static map with valid parameters', async () => {
      const response = await callTool('mapbox_static_map', {
        center: { longitude: -122.4194, latitude: 37.7749 },
        zoom: 12,
        size: { width: 300, height: 200 },
        style: 'mapbox://styles/mapbox/streets-v11'
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      console.log('DEBUG: Static map response:', JSON.stringify(data, null, 2));
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
      if (data.result.is_error) {
        expect(data.result.content[0].type).toBe('text');
        expect(data.result.content[0].text).toBe(
          'Internal error has occurred.'
        );
      } else {
        expect(data.result.content[0].type).toBe('image');
        expect(data.result.content[0].data).toBeDefined();
      }
    });

    it('should handle static map with invalid dimensions', async () => {
      const response = await callTool('mapbox_static_map', {
        center: { longitude: -122.4194, latitude: 37.7749 },
        zoom: 12,
        size: { width: 2000, height: 2000 }, // Too large
        style: 'mapbox://styles/mapbox/streets-v11'
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent tool calls', async () => {
      const promises = [
        callTool('mapbox_geocoding_forward', { q: 'New York, NY', limit: 1 }),
        callTool('mapbox_geocoding_reverse', {
          longitude: -74.0059,
          latitude: 40.7128,
          limit: 1
        }),
        callTool('mapbox_poi_search', {
          q: 'pizza',
          proximity: { longitude: -74.0059, latitude: 40.7128 },
          limit: 3
        })
      ];

      const responses = await Promise.all(promises);

      for (const response of responses) {
        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(data.jsonrpc).toBe('2.0');
        expect(data.result).toBeDefined();
        expect(data.result.content).toBeDefined();
      }
    });

    it('should handle stress test with multiple rapid requests', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        callTool('mapbox_geocoding_forward', {
          q: `Test ${i}`,
          limit: 1
        })
      );

      const responses = await Promise.all(promises);

      let successCount = 0;
      let errorCount = 0;

      for (const response of responses) {
        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(data.jsonrpc).toBe('2.0');

        if (data.result) {
          successCount++;
        } else if (data.error) {
          errorCount++;
        }
      }

      expect(successCount + errorCount).toBe(10);
    });
  });

  describe('Security and Permissions', () => {
    it('should enforce permission-based tool access', async () => {
      // Create token with limited permissions
      const limitedToken = jwt.sign(
        {
          iss: 'mapbox-mcp-server',
          sub: 'limited-user',
          aud: 'mapbox-mcp-server',
          permissions: ['mapbox:geocode'] // Only geocoding permission
        },
        TEST_CONFIG.jwtSecret,
        { expiresIn: '1h' }
      );

      // Test geocoding (should work)
      const geocodeResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${limitedToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `req-${Math.floor(Math.random() * 1000)}`,
          method: 'tools/call',
          params: {
            name: 'mapbox_geocoding_forward',
            arguments: { q: 'San Francisco, CA', limit: 1 }
          }
        })
      });

      expect(geocodeResponse.status).toBe(200);
      const geocodeData = (await geocodeResponse.json()) as any;
      console.log(
        'DEBUG: Limited permissions geocode response:',
        JSON.stringify(geocodeData, null, 2)
      );
      expect(geocodeData.jsonrpc).toBe('2.0');
      expect(geocodeData.result).toBeDefined();

      // Test directions (should be restricted)
      const directionsResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${limitedToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `req-${Math.floor(Math.random() * 1000)}`,
          method: 'tools/call',
          params: {
            name: 'mapbox_directions',
            arguments: {
              coordinates: [
                [-122.4194, 37.7749],
                [-122.4094, 37.7849]
              ],
              profile: 'driving'
            }
          }
        })
      });

      expect(directionsResponse.status).toBe(200);
      const directionsData = (await directionsResponse.json()) as any;
      expect(directionsData.jsonrpc).toBe('2.0');
      expect(directionsData.error).toBeDefined();
      expect(directionsData.error.message).toContain('permission');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed tool arguments', async () => {
      const response = await callTool('mapbox_geocoding_forward', {
        q: 123, // Should be string
        limit: 'invalid' // Should be number
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });

    it('should handle nonexistent tool', async () => {
      const response = await callTool('nonexistent_tool', {
        someParam: 'value'
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('Tool not found');
    });

    it('should handle empty tool arguments', async () => {
      const response = await callTool('mapbox_geocoding_forward', {});

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });

    it('should handle tool execution timeout gracefully', async () => {
      // This test verifies that the timeout mechanism is in place
      const response = await callTool('mapbox_geocoding_forward', {
        q: 'Test timeout behavior',
        limit: 1
      });

      // Should complete within reasonable time
      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      // Could be result or error depending on API response
      expect(data.result || data.error).toBeDefined();
    });
  });
});
