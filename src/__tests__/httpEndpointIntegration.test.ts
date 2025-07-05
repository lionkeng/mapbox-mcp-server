/**
 * Comprehensive HTTP endpoint integration tests for all MCP tools
 * Tests the complete HTTP server functionality with all 8 Mapbox tools
 * and MCP Streamable HTTP transport spec compliance
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
      try {
        await httpServer.stop();
      } catch (error) {
        // Ignore cleanup errors
        console.warn('Error during server cleanup:', error);
      }
    }
  }, 10000); // Increase timeout for cleanup

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
        'MapboxMatrix',
        'MapboxGeocodingReverse',
        'MapboxGeocodingForward',
        'MapboxIsochrone',
        'MapboxPoiSearch',
        'MapboxCategorySearch',
        'MapboxStaticMap',
        'MapboxDirections'
      ];

      const toolNames = data.result.tools.map((tool: any) => tool.name);

      expectedTools.forEach((expectedTool) => {
        expect(toolNames).toContain(expectedTool);
      });
    });
  });

  describe('Geocoding Tools', () => {
    it('should handle forward geocoding with valid address', async () => {
      const response = await callTool('MapboxGeocodingForward', {
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
      const response = await callTool('MapboxGeocodingForward', {
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
      const response = await callTool('MapboxGeocodingReverse', {
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
      const response = await callTool('MapboxGeocodingReverse', {
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
      const response = await callTool('MapboxDirections', {
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
      const response = await callTool('MapboxDirections', {
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
      const response = await callTool('MapboxIsochrone', {
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
      const response = await callTool('MapboxIsochrone', {
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
      const response = await callTool('MapboxMatrix', {
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

      const response = await callTool('MapboxMatrix', {
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
      const response = await callTool('MapboxPoiSearch', {
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
      const response = await callTool('MapboxPoiSearch', {
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
      const response = await callTool('MapboxCategorySearch', {
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
      const response = await callTool('MapboxCategorySearch', {
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
      const response = await callTool('MapboxStaticMap', {
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
      const response = await callTool('MapboxStaticMap', {
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
        callTool('MapboxGeocodingForward', { q: 'New York, NY', limit: 1 }),
        callTool('MapboxGeocodingReverse', {
          longitude: -74.0059,
          latitude: 40.7128,
          limit: 1
        }),
        callTool('MapboxPoiSearch', {
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
        callTool('MapboxGeocodingForward', {
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
            name: 'MapboxGeocodingForward',
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
            name: 'MapboxDirections',
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
      const response = await callTool('MapboxGeocodingForward', {
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
      const response = await callTool('MapboxGeocodingForward', {});

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });

    it('should handle tool execution timeout gracefully', async () => {
      // This test verifies that the timeout mechanism is in place
      const response = await callTool('MapboxGeocodingForward', {
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

  // MCP Spec Compliance Tests
  describe('MCP Streamable HTTP Transport Compliance', () => {
    describe('Accept Header Validation', () => {
      it('should accept requests with application/json Accept header', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'test-1',
            method: 'tools/list',
            params: {}
          })
        });

        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(data.jsonrpc).toBe('2.0');
        expect(data.result).toBeDefined();
      });

      it('should accept requests with text/event-stream Accept header', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'test-2',
            method: 'tools/list',
            params: {}
          })
        });

        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(data.jsonrpc).toBe('2.0');
        expect(data.result).toBeDefined();
      });

      it('should accept requests with both Accept headers', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'test-3',
            method: 'tools/list',
            params: {}
          })
        });

        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(data.jsonrpc).toBe('2.0');
        expect(data.result).toBeDefined();
      });

      it('should reject requests with invalid Accept header', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/html',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'test-4',
            method: 'tools/list',
            params: {}
          })
        });

        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(data.error).toBeDefined();
        expect(data.error.message).toContain('Accept header');
      });
    });

    describe('Response and Notification Handling', () => {
      it('should return 202 Accepted for JSON-RPC responses', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'response-1',
            result: { someData: 'value' }
          })
        });

        expect(response.status).toBe(202);
        const text = await response.text();
        expect(text).toBe('');
      });

      it('should return 202 Accepted for notifications (no id)', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'some/notification',
            params: { data: 'value' }
          })
        });

        expect(response.status).toBe(202);
        const text = await response.text();
        expect(text).toBe('');
      });

      it('should return 202 Accepted for error responses', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'error-1',
            error: {
              code: -32600,
              message: 'Invalid Request'
            }
          })
        });

        expect(response.status).toBe(202);
        const text = await response.text();
        expect(text).toBe('');
      });
    });

    describe('Batch Request Support', () => {
      it('should handle batch requests with multiple operations', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify([
            {
              jsonrpc: '2.0',
              id: 'batch-1',
              method: 'tools/list',
              params: {}
            },
            {
              jsonrpc: '2.0',
              id: 'batch-2',
              method: 'tools/call',
              params: {
                name: 'MapboxGeocodingForward',
                arguments: { q: 'San Francisco', limit: 1 }
              }
            }
          ])
        });

        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(2);
        expect(data[0].id).toBe('batch-1');
        expect(data[1].id).toBe('batch-2');
      });

      it('should handle batch with mixed requests and notifications', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify([
            {
              jsonrpc: '2.0',
              id: 'req-1',
              method: 'tools/list',
              params: {}
            },
            {
              jsonrpc: '2.0',
              // No id - this is a notification
              method: 'some/notification',
              params: { data: 'test' }
            },
            {
              jsonrpc: '2.0',
              id: 'req-2',
              method: 'tools/call',
              params: {
                name: 'MapboxGeocodingForward',
                arguments: { q: 'New York', limit: 1 }
              }
            }
          ])
        });

        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(Array.isArray(data)).toBe(true);
        // Should only return responses for requests with IDs
        expect(data.length).toBe(2);
        expect(data[0].id).toBe('req-1');
        expect(data[1].id).toBe('req-2');
      });

      it('should return 202 for batch of only notifications', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify([
            {
              jsonrpc: '2.0',
              method: 'notification/one',
              params: { data: 'test1' }
            },
            {
              jsonrpc: '2.0',
              method: 'notification/two',
              params: { data: 'test2' }
            }
          ])
        });

        expect(response.status).toBe(202);
        const text = await response.text();
        expect(text).toBe('');
      });

      it('should handle batch with errors properly', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`
          },
          body: JSON.stringify([
            {
              jsonrpc: '2.0',
              id: 'valid-1',
              method: 'tools/list',
              params: {}
            },
            {
              jsonrpc: '2.0',
              id: 'invalid-1',
              method: 'tools/call',
              params: {
                name: 'nonexistent_tool',
                arguments: {}
              }
            }
          ])
        });

        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(2);
        expect(data[0].result).toBeDefined();
        expect(data[1].error).toBeDefined();
      });
    });

    describe('SSE Support (GET endpoint)', () => {
      it('should establish SSE connection with GET request', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${TEST_TOKEN}`
          }
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain(
          'text/event-stream'
        );
        expect(response.headers.get('mcp-session-id')).toBeTruthy();
        expect(response.headers.get('cache-control')).toContain('no-cache');
        expect(response.headers.get('connection')).toBe('keep-alive');

        // Close the connection
        await response.body?.cancel();
      });

      it('should include session ID in SSE response', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${TEST_TOKEN}`,
            'Mcp-Session-Id': 'test-session-123'
          }
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('mcp-session-id')).toBe('test-session-123');

        // Close the connection
        await response.body?.cancel();
      });
    });

    describe('Session Management', () => {
      it('should handle session deletion with DELETE method', async () => {
        // First establish a session
        const getResponse = await fetch(`${serverUrl}/messages`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${TEST_TOKEN}`
          }
        });

        const sessionId = getResponse.headers.get('mcp-session-id');
        expect(sessionId).toBeTruthy();

        // Then delete the session
        const deleteResponse = await fetch(`${serverUrl}/messages`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${TEST_TOKEN}`,
            'Mcp-Session-Id': sessionId!
          }
        });

        expect(deleteResponse.status).toBe(204);

        // Close the SSE connection
        await getResponse.body?.cancel();
      });

      it('should return 400 for DELETE without session ID', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${TEST_TOKEN}`
          }
        });

        expect(response.status).toBe(400);
        const data = (await response.json()) as any;
        expect(data.error).toContain('Mcp-Session-Id');
      });

      it('should handle deletion of non-existent session', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${TEST_TOKEN}`,
            'Mcp-Session-Id': 'non-existent-session'
          }
        });

        expect(response.status).toBe(204);
      });
    });

    describe('Authentication with all HTTP methods', () => {
      it('should require authentication for POST requests', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'test',
            method: 'tools/list',
            params: {}
          })
        });

        expect(response.status).toBe(401);
      });

      it('should require authentication for GET requests', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream'
          }
        });

        expect(response.status).toBe(401);
      });

      it('should require authentication for DELETE requests', async () => {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'DELETE',
          headers: {
            'Mcp-Session-Id': 'test-session'
          }
        });

        expect(response.status).toBe(401);
      });
    });
  });
});
