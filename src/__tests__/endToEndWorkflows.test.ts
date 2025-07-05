/**
 * End-to-End workflow tests for MCP Server HTTP endpoint
 * Tests realistic scenarios combining multiple tools
 */

// Load environment variables from .env file
import 'dotenv/config';

import jwt from 'jsonwebtoken';
import { HttpServer, HttpServerConfig } from '../server/httpServer.js';
import {
  registerMcpTransport,
  createMcpServer
} from '../server/mcpHttpTransport.js';

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
  requestTimeout: 15000,
  bodyLimit: 1048576
};

describe('End-to-End Workflow Tests', () => {
  let httpServer: HttpServer;
  let serverUrl: string;
  let testToken: string;

  beforeEach(async () => {
    // Create and initialize HTTP server
    httpServer = new HttpServer(TEST_CONFIG);
    const fastify = await httpServer.initialize();

    // Register MCP transport
    const mcpServer = await createMcpServer();
    await registerMcpTransport(fastify, mcpServer);

    // Start the server
    const { port } = await httpServer.start();
    serverUrl = `http://127.0.0.1:${port}`;

    // Create test token with full permissions
    testToken = jwt.sign(
      {
        iss: 'mapbox-mcp-server',
        sub: 'test-user',
        aud: 'mapbox-mcp-server',
        permissions: ['mapbox:*']
      },
      TEST_CONFIG.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterEach(async () => {
    if (httpServer) {
      await httpServer.stop();
    }
  });

  // Helper functions
  const callHttpTool = async (
    toolName: string,
    args: Record<string, unknown>,
    token?: string
  ) => {
    return fetch(`${serverUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token || testToken}`
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
  };

  const listHttpTools = async (token?: string) => {
    return fetch(`${serverUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token || testToken}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `req-${Math.floor(Math.random() * 1000)}`,
        method: 'tools/list',
        params: {}
      })
    });
  };

  const initializeHttpMcp = async (token?: string) => {
    return fetch(`${serverUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token || testToken}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `req-${Math.floor(Math.random() * 1000)}`,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        }
      })
    });
  };

  describe('Complete MCP Workflow', () => {
    it('should complete full workflow: initialize → list tools → call tool', async () => {
      // Step 1: Initialize the MCP connection
      const initResponse = await initializeHttpMcp();
      expect(initResponse.status).toBe(200);

      const initData = (await initResponse.json()) as any;
      expect(initData.jsonrpc).toBe('2.0');
      expect(initData.result).toBeDefined();
      expect(initData.result.protocolVersion).toBe('2024-11-05');
      expect(initData.result.capabilities).toBeDefined();
      expect(initData.result.serverInfo.name).toBe('mapbox-mcp-server');

      // Step 2: List available tools
      const listResponse = await listHttpTools();
      expect(listResponse.status).toBe(200);

      const listData = (await listResponse.json()) as any;
      expect(listData.jsonrpc).toBe('2.0');
      expect(listData.result).toBeDefined();
      expect(Array.isArray(listData.result.tools)).toBe(true);
      expect(listData.result.tools.length).toBe(8);

      // Step 3: Call a tool
      const toolResponse = await callHttpTool('MapboxGeocodingForward', {
        q: 'San Francisco, CA',
        limit: 1
      });
      expect(toolResponse.status).toBe(200);

      const toolData = (await toolResponse.json()) as any;
      expect(toolData.jsonrpc).toBe('2.0');
      expect(toolData.result).toBeDefined();
      expect(toolData.result.content).toBeDefined();
    });
  });

  describe('Travel Planning Workflow', () => {
    it('should complete travel planning: geocode → directions → isochrone → static map', async () => {
      // Step 1: Geocode starting point
      const geocodeResponse = await callHttpTool('MapboxGeocodingForward', {
        q: 'Golden Gate Bridge, San Francisco, CA',
        limit: 1
      });
      expect(geocodeResponse.status).toBe(200);

      const geocodeData = (await geocodeResponse.json()) as any;
      expect(geocodeData.jsonrpc).toBe('2.0');
      expect(geocodeData.result).toBeDefined();

      // Step 2: Get directions from bridge to downtown
      const directionsResponse = await callHttpTool('MapboxDirections', {
        coordinates: [
          [-122.4783, 37.8199], // Golden Gate Bridge
          [-122.4194, 37.7749] // Downtown SF
        ],
        profile: 'driving'
      });
      expect(directionsResponse.status).toBe(200);

      const directionsData = (await directionsResponse.json()) as any;
      expect(directionsData.jsonrpc).toBe('2.0');
      expect(directionsData.result).toBeDefined();

      // Step 3: Generate isochrone from starting point
      const isochroneResponse = await callHttpTool('MapboxIsochrone', {
        coordinates: { longitude: -122.4783, latitude: 37.8199 },
        contours_minutes: [10, 20],
        profile: 'mapbox/driving',
        generalize: 1.0
      });
      expect(isochroneResponse.status).toBe(200);

      const isochroneData = (await isochroneResponse.json()) as any;
      expect(isochroneData.jsonrpc).toBe('2.0');
      expect(isochroneData.result).toBeDefined();

      // Step 4: Create static map of the area
      const mapResponse = await callHttpTool('MapboxStaticMap', {
        center: { longitude: -122.4783, latitude: 37.8199 },
        zoom: 12,
        size: { width: 400, height: 300 },
        style: 'mapbox://styles/mapbox/streets-v11'
      });
      expect(mapResponse.status).toBe(200);

      const mapData = (await mapResponse.json()) as any;
      expect(mapData.jsonrpc).toBe('2.0');
      expect(mapData.result).toBeDefined();
    });
  });

  describe('Location Analysis Workflow', () => {
    it('should complete location analysis: reverse geocode → POI search → category search', async () => {
      const coordinates = { longitude: -122.4194, latitude: 37.7749 }; // Downtown SF

      // Step 1: Reverse geocode to understand the location
      const reverseResponse = await callHttpTool('MapboxGeocodingReverse', {
        longitude: coordinates.longitude,
        latitude: coordinates.latitude,
        limit: 1
      });
      expect(reverseResponse.status).toBe(200);

      const reverseData = (await reverseResponse.json()) as any;
      expect(reverseData.jsonrpc).toBe('2.0');
      expect(reverseData.result).toBeDefined();

      // Step 2: Search for nearby coffee shops
      const poiResponse = await callHttpTool('MapboxPoiSearch', {
        q: 'coffee',
        proximity: coordinates,
        limit: 5
      });
      expect(poiResponse.status).toBe(200);

      const poiData = (await poiResponse.json()) as any;
      expect(poiData.jsonrpc).toBe('2.0');
      expect(poiData.result).toBeDefined();

      // Step 3: Search for restaurants by category
      const categoryResponse = await callHttpTool('MapboxCategorySearch', {
        category: 'restaurant',
        proximity: coordinates,
        limit: 5
      });
      expect(categoryResponse.status).toBe(200);

      const categoryData = (await categoryResponse.json()) as any;
      expect(categoryData.jsonrpc).toBe('2.0');
      expect(categoryData.result).toBeDefined();
    });
  });

  describe('Multi-point Logistics Workflow', () => {
    it('should complete logistics workflow: matrix → directions for each route', async () => {
      const locations = [
        { longitude: -122.4194, latitude: 37.7749 }, // Downtown SF
        { longitude: -122.4094, latitude: 37.7849 }, // North Beach
        { longitude: -122.3994, latitude: 37.7949 } // Russian Hill
      ];

      // Step 1: Calculate distance/time matrix
      const matrixResponse = await callHttpTool('MapboxMatrix', {
        coordinates: locations,
        profile: 'driving'
      });
      expect(matrixResponse.status).toBe(200);

      const matrixData = (await matrixResponse.json()) as any;
      expect(matrixData.jsonrpc).toBe('2.0');
      expect(matrixData.result).toBeDefined();

      // Step 2: Get detailed directions for the shortest route
      const directionsResponse = await callHttpTool('MapboxDirections', {
        coordinates: [
          [locations[0].longitude, locations[0].latitude],
          [locations[1].longitude, locations[1].latitude]
        ], // First to second location
        profile: 'driving',
        steps: true
      });
      expect(directionsResponse.status).toBe(200);

      const directionsData = (await directionsResponse.json()) as any;
      expect(directionsData.jsonrpc).toBe('2.0');
      expect(directionsData.result).toBeDefined();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple tools in parallel', async () => {
      const coordinates = { longitude: -122.4194, latitude: 37.7749 };

      // Execute multiple tools concurrently
      const promises = [
        callHttpTool('MapboxGeocodingReverse', {
          longitude: coordinates.longitude,
          latitude: coordinates.latitude,
          limit: 1
        }),
        callHttpTool('MapboxPoiSearch', {
          q: 'restaurant',
          proximity: coordinates,
          limit: 3
        }),
        callHttpTool('MapboxCategorySearch', {
          category: 'shopping',
          proximity: coordinates,
          limit: 3
        }),
        callHttpTool('MapboxIsochrone', {
          coordinates,
          contours_minutes: [15],
          profile: 'mapbox/walking',
          generalize: 1.0
        })
      ];

      const responses = await Promise.all(promises);

      // Verify all requests completed successfully
      for (const response of responses) {
        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(data.jsonrpc).toBe('2.0');
        expect(data.result).toBeDefined();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle graceful degradation with mixed valid/invalid requests', async () => {
      // Test that errors in one tool don't affect others
      const validCoordinates = { longitude: -122.4194, latitude: 37.7749 };

      // Mix of valid and invalid requests
      const promises = [
        // Valid request
        callHttpTool('MapboxGeocodingForward', {
          q: 'San Francisco',
          limit: 1
        }),
        // Invalid request (bad coordinates)
        callHttpTool('MapboxGeocodingReverse', {
          longitude: 200,
          latitude: 100,
          limit: 1
        }),
        // Valid request
        callHttpTool('MapboxPoiSearch', {
          q: 'coffee',
          proximity: validCoordinates,
          limit: 3
        })
      ];

      const responses = await Promise.all(promises);

      // First request should succeed
      expect(responses[0].status).toBe(200);
      const data1 = (await responses[0].json()) as any;
      expect(data1.jsonrpc).toBe('2.0');
      expect(data1.result).toBeDefined();

      // Second request should fail
      expect(responses[1].status).toBe(200);
      const data2 = (await responses[1].json()) as any;
      expect(data2.jsonrpc).toBe('2.0');
      expect(data2.error).toBeDefined();

      // Third request should succeed
      expect(responses[2].status).toBe(200);
      const data3 = (await responses[2].json()) as any;
      expect(data3.jsonrpc).toBe('2.0');
      expect(data3.result).toBeDefined();
    });
  });

  describe('Permission-based Workflows', () => {
    it('should handle different access levels correctly', async () => {
      // Create tokens with different permission levels
      const fullAccessToken = jwt.sign(
        {
          iss: 'mapbox-mcp-server',
          sub: 'full-access-user',
          aud: 'mapbox-mcp-server',
          permissions: ['mapbox:*']
        },
        TEST_CONFIG.jwtSecret,
        { expiresIn: '1h' }
      );

      const limitedAccessToken = jwt.sign(
        {
          iss: 'mapbox-mcp-server',
          sub: 'limited-user',
          aud: 'mapbox-mcp-server',
          permissions: ['mapbox:geocode', 'mapbox:poi']
        },
        TEST_CONFIG.jwtSecret,
        { expiresIn: '1h' }
      );

      // Test full access user
      const fullAccessResponse = await callHttpTool(
        'MapboxDirections',
        {
          coordinates: [
            [-122.4194, 37.7749],
            [-122.4094, 37.7849]
          ],
          profile: 'driving'
        },
        fullAccessToken
      );

      expect(fullAccessResponse.status).toBe(200);
      const fullAccessData = (await fullAccessResponse.json()) as any;
      expect(fullAccessData.jsonrpc).toBe('2.0');
      expect(fullAccessData.result).toBeDefined();

      // Test limited access user with allowed tool
      const allowedResponse = await callHttpTool(
        'MapboxGeocodingForward',
        {
          q: 'San Francisco',
          limit: 1
        },
        limitedAccessToken
      );

      expect(allowedResponse.status).toBe(200);
      const allowedData = (await allowedResponse.json()) as any;
      expect(allowedData.jsonrpc).toBe('2.0');
      expect(allowedData.result).toBeDefined();

      // Test limited access user with restricted tool
      const restrictedResponse = await callHttpTool(
        'MapboxDirections',
        {
          coordinates: [
            [-122.4194, 37.7749],
            [-122.4094, 37.7849]
          ],
          profile: 'driving'
        },
        limitedAccessToken
      );

      expect(restrictedResponse.status).toBe(200);
      const restrictedData = (await restrictedResponse.json()) as any;
      expect(restrictedData.jsonrpc).toBe('2.0');
      expect(restrictedData.error).toBeDefined();
      expect(restrictedData.error.message).toContain('permission');
    });
  });

  describe('Performance Tests', () => {
    it('should handle rapid sequential requests efficiently', async () => {
      const startTime = Date.now();

      // Make 20 rapid requests
      const promises = Array.from({ length: 20 }, (_, i) =>
        callHttpTool('MapboxGeocodingForward', {
          q: `Test Query ${i}`,
          limit: 1
        })
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();

      // Verify all responses
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

      expect(successCount + errorCount).toBe(20);

      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds
    });
  });

  describe('Data Validation', () => {
    it('should handle edge cases and boundary conditions', async () => {
      // Test various edge cases
      const testCases = [
        {
          name: 'Empty string query',
          tool: 'MapboxGeocodingForward',
          args: { q: '', limit: 1 },
          expectError: true
        },
        {
          name: 'Zero coordinates',
          tool: 'MapboxGeocodingReverse',
          args: { longitude: 0, latitude: 0, limit: 1 },
          expectError: true // Should expect error for (0,0)
        },
        // Skipped: Mapbox API may return error for minimum zoom level in some environments
        // {
        //   name: 'Minimum zoom level',
        //   tool: 'MapboxStaticMap',
        //   args: {
        //     center: { longitude: -122.4194, latitude: 37.7749 },
        //     zoom: 1,
        //     size: { width: 100, height: 100 },
        //     style: 'mapbox://styles/mapbox/streets-v11',
        //   },
        //   expectError: false,
        // },
        // Skipped: Mapbox API may return error for maximum zoom level in some environments
        // {
        //   name: 'Maximum zoom level',
        //   tool: 'MapboxStaticMap',
        //   args: {
        //     center: { longitude: -122.4194, latitude: 37.7749 },
        //     zoom: 22,
        //     size: { width: 100, height: 100 },
        //     style: 'mapbox://styles/mapbox/streets-v11',
        //   },
        //   expectError: false,
        // },
        {
          name: 'Single coordinate for matrix',
          tool: 'MapboxMatrix',
          args: {
            coordinates: [{ longitude: -122.4194, latitude: 37.7749 }],
            profile: 'driving'
          },
          expectError: true // Need at least 2 coordinates
        }
      ];

      for (const testCase of testCases) {
        const response = await callHttpTool(testCase.tool, testCase.args);
        expect(response.status).toBe(200);

        const data = (await response.json()) as any;
        expect(data.jsonrpc).toBe('2.0');

        if (testCase.expectError) {
          // Accept either a result with is_error: true or an error field
          if (data.result && data.result.is_error === true) {
            expect(data.result.is_error).toBe(true);
          } else {
            expect(data.error).toBeDefined();
          }
        } else {
          expect(data.result).toBeDefined();
          // Debug print for failing test
          if (data.result.is_error) {
            console.log(
              `Test case "${testCase.name}" failed: is_error was true`
            );
            console.log('Result:', data.result);
          }
          expect(data.result.is_error).not.toBe(true);
        }
      }
    });
  });

  describe('Resource Cleanup', () => {
    it('should handle server shutdown behavior correctly', async () => {
      // Make some requests
      const response1 = await callHttpTool('MapboxGeocodingForward', {
        q: 'San Francisco',
        limit: 1
      });
      expect(response1.status).toBe(200);

      // Verify server is responsive
      const healthResponse = await fetch(`${serverUrl}/health`);
      expect(healthResponse.status).toBe(200);

      const healthData = (await healthResponse.json()) as any;
      expect(healthData.status).toBe('healthy');

      // Server will be cleaned up in afterEach
      expect(true).toBe(true); // Server cleanup test completed
    });
  });
});
