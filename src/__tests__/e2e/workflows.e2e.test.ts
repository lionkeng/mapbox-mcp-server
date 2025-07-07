/**
 * Multi-step workflow End-to-End tests
 * Tests complete business workflows that require state transitions and full HTTP server
 */

import { buildTestServer, cleanupTestServer } from '../helpers/index.js';
import {
  createTestToken,
  createAuthHeader,
  TEST_HEADERS
} from '../helpers/index.js';
import { HttpServer } from '../../server/httpServer.js';

describe('Workflows End-to-End Tests', () => {
  let server: HttpServer;
  let serverUrl: string;
  let token: string;

  beforeEach(async () => {
    const testServer = await buildTestServer();
    server = testServer.server;
    serverUrl = testServer.url;
    token = createTestToken();
  });

  afterEach(async () => {
    await cleanupTestServer(server);
  });

  // Helper function to make MCP tool calls
  const callTool = async (toolName: string, args: Record<string, unknown>) => {
    const response = await fetch(`${serverUrl}/messages`, {
      method: 'POST',
      headers: {
        ...TEST_HEADERS.JSON,
        ...createAuthHeader(token)
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

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jsonrpc).toBe('2.0');
    return data;
  };

  describe('Travel Planning Workflow', () => {
    it('should complete full travel planning: geocode → directions → isochrone → static map', async () => {
      // Step 1: Geocode starting point
      const geocodeData = await callTool('MapboxGeocodingForward', {
        q: 'Golden Gate Bridge, San Francisco, CA',
        limit: 1
      });

      expect(geocodeData.result).toBeDefined();
      expect(geocodeData.result.content).toBeDefined();

      // Step 2: Get directions from bridge to downtown
      const directionsData = await callTool('MapboxDirections', {
        coordinates: [
          [-122.4783, 37.8199], // Golden Gate Bridge
          [-122.4194, 37.7749] // Downtown SF
        ],
        profile: 'driving'
      });

      expect(directionsData.result).toBeDefined();
      expect(directionsData.result.content).toBeDefined();

      // Step 3: Generate isochrone from starting point
      const isochroneData = await callTool('MapboxIsochrone', {
        coordinates: { longitude: -122.4783, latitude: 37.8199 },
        contours_minutes: [10, 20],
        profile: 'mapbox/driving',
        generalize: 1.0
      });

      expect(isochroneData.result).toBeDefined();
      expect(isochroneData.result.content).toBeDefined();

      // Step 4: Create static map of the area
      const mapData = await callTool('MapboxStaticMap', {
        center: { longitude: -122.4783, latitude: 37.8199 },
        zoom: 12,
        size: { width: 400, height: 300 },
        style: 'mapbox://styles/mapbox/streets-v11'
      });

      expect(mapData.result).toBeDefined();
      expect(mapData.result.content).toBeDefined();
    }, 60000);

    it('should complete location analysis: reverse geocode → POI search → category search', async () => {
      const coordinates = { longitude: -122.4194, latitude: 37.7749 }; // Downtown SF

      // Step 1: Reverse geocode to understand the location
      const reverseData = await callTool('MapboxGeocodingReverse', {
        longitude: coordinates.longitude,
        latitude: coordinates.latitude,
        limit: 1
      });

      expect(reverseData.result).toBeDefined();
      expect(reverseData.result.content).toBeDefined();

      // Step 2: Search for nearby coffee shops
      const poiData = await callTool('MapboxPoiSearch', {
        q: 'coffee',
        proximity: coordinates,
        limit: 5
      });

      expect(poiData.result).toBeDefined();
      expect(poiData.result.content).toBeDefined();

      // Step 3: Search for restaurants by category
      const categoryData = await callTool('MapboxCategorySearch', {
        category: 'restaurant',
        proximity: coordinates,
        limit: 5
      });

      expect(categoryData.result).toBeDefined();
      expect(categoryData.result.content).toBeDefined();
    }, 45000);

    it('should complete logistics workflow: matrix → directions for each route', async () => {
      const locations = [
        { longitude: -122.4194, latitude: 37.7749 }, // Downtown SF
        { longitude: -122.4094, latitude: 37.7849 }, // North Beach
        { longitude: -122.3994, latitude: 37.7949 } // Russian Hill
      ];

      // Step 1: Calculate distance/time matrix
      const matrixData = await callTool('MapboxMatrix', {
        coordinates: locations,
        profile: 'driving'
      });

      expect(matrixData.result).toBeDefined();
      expect(matrixData.result.content).toBeDefined();

      // Step 2: Get detailed directions for the shortest route
      const directionsData = await callTool('MapboxDirections', {
        coordinates: [
          [locations[0].longitude, locations[0].latitude],
          [locations[1].longitude, locations[1].latitude]
        ],
        profile: 'driving',
        steps: true
      });

      expect(directionsData.result).toBeDefined();
      expect(directionsData.result.content).toBeDefined();
    }, 45000);
  });

  describe('Complex Multi-Step Workflows', () => {
    it('should handle workflow with error recovery', async () => {
      // Step 1: Valid geocoding
      const geocodeData = await callTool('MapboxGeocodingForward', {
        q: 'San Francisco, CA',
        limit: 1
      });

      expect(geocodeData.result).toBeDefined();

      // Step 2: Attempt invalid operation (should fail gracefully)
      const invalidData = await callTool('MapboxGeocodingReverse', {
        longitude: 200, // Invalid longitude
        latitude: 37.7749,
        limit: 1
      });

      expect(invalidData.error).toBeDefined();

      // Step 3: Continue with valid operation (should succeed)
      const poiData = await callTool('MapboxPoiSearch', {
        q: 'restaurant',
        proximity: { longitude: -122.4194, latitude: 37.7749 },
        limit: 3
      });

      expect(poiData.result).toBeDefined();
    }, 30000);

    it('should maintain workflow state across multiple tool calls', async () => {
      // This simulates a workflow where results from one call inform the next

      // Step 1: Get location details
      const geocodeData = await callTool('MapboxGeocodingForward', {
        q: 'Union Square, San Francisco',
        limit: 1
      });

      expect(geocodeData.result).toBeDefined();

      // In a real implementation, you would parse the geocoding result
      // to extract coordinates for subsequent calls
      const unionSquareCoords = { longitude: -122.4077, latitude: 37.7879 };

      // Step 2: Use those coordinates for POI search
      const poiData = await callTool('MapboxPoiSearch', {
        q: 'shopping',
        proximity: unionSquareCoords,
        limit: 5
      });

      expect(poiData.result).toBeDefined();

      // Step 3: Generate isochrone around the same location
      const isochroneData = await callTool('MapboxIsochrone', {
        coordinates: unionSquareCoords,
        contours_minutes: [5, 10],
        profile: 'mapbox/walking',
        generalize: 1.0
      });

      expect(isochroneData.result).toBeDefined();

      // Step 4: Create map visualization
      const mapData = await callTool('MapboxStaticMap', {
        center: unionSquareCoords,
        zoom: 14,
        size: { width: 500, height: 400 },
        style: 'mapbox://styles/mapbox/streets-v11'
      });

      expect(mapData.result).toBeDefined();
    }, 60000);
  });

  describe('Concurrent Workflow Operations', () => {
    it('should handle parallel workflow execution', async () => {
      // Execute multiple independent workflows concurrently
      const workflows = [
        // Workflow 1: NYC geocoding and POI search
        (async () => {
          const geocode = await callTool('MapboxGeocodingForward', {
            q: 'Times Square, New York',
            limit: 1
          });
          expect(geocode.result).toBeDefined();

          const poi = await callTool('MapboxPoiSearch', {
            q: 'theater',
            proximity: { longitude: -73.9857, latitude: 40.7589 },
            limit: 3
          });
          expect(poi.result).toBeDefined();

          return { geocode, poi };
        })(),

        // Workflow 2: SF directions and matrix
        (async () => {
          const directions = await callTool('MapboxDirections', {
            coordinates: [
              [-122.4194, 37.7749],
              [-122.4094, 37.7849]
            ],
            profile: 'walking'
          });
          expect(directions.result).toBeDefined();

          const matrix = await callTool('MapboxMatrix', {
            coordinates: [
              { longitude: -122.4194, latitude: 37.7749 },
              { longitude: -122.4094, latitude: 37.7849 },
              { longitude: -122.3994, latitude: 37.7949 }
            ],
            profile: 'driving'
          });
          expect(matrix.result).toBeDefined();

          return { directions, matrix };
        })(),

        // Workflow 3: London reverse geocoding and categories
        (async () => {
          const reverse = await callTool('MapboxGeocodingReverse', {
            longitude: -0.1276,
            latitude: 51.5074,
            limit: 1
          });
          expect(reverse.result).toBeDefined();

          const category = await callTool('MapboxCategorySearch', {
            category: 'museum',
            proximity: { longitude: -0.1276, latitude: 51.5074 },
            limit: 5
          });
          expect(category.result).toBeDefined();

          return { reverse, category };
        })()
      ];

      // Wait for all workflows to complete
      const results = await Promise.all(workflows);

      // Verify all workflows completed successfully
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      });
    }, 90000);

    it('should handle mixed success/failure in concurrent operations', async () => {
      const operations = [
        // Valid operation
        callTool('MapboxGeocodingForward', {
          q: 'San Francisco',
          limit: 1
        }),

        // Invalid operation (bad coordinates)
        callTool('MapboxGeocodingReverse', {
          longitude: 200,
          latitude: 100,
          limit: 1
        }),

        // Valid operation
        callTool('MapboxPoiSearch', {
          q: 'coffee',
          proximity: { longitude: -122.4194, latitude: 37.7749 },
          limit: 3
        })
      ];

      const results = await Promise.all(operations);

      // First operation should succeed
      expect(results[0].result).toBeDefined();
      expect(results[0].error).toBeUndefined();

      // Second operation should fail
      expect(results[1].error).toBeDefined();
      expect(results[1].result).toBeUndefined();

      // Third operation should succeed
      expect(results[2].result).toBeDefined();
      expect(results[2].error).toBeUndefined();
    }, 45000);
  });

  describe('Workflow Performance and Scalability', () => {
    it('should handle high-frequency workflow execution', async () => {
      const startTime = Date.now();
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const data = await callTool('MapboxGeocodingForward', {
          q: `Test Query ${i}`,
          limit: 1
        });

        // Some queries may fail (invalid locations), but server should handle gracefully
        expect(data.result || data.error).toBeDefined();
      }

      const totalTime = Date.now() - startTime;

      // Should complete within reasonable time
      expect(totalTime).toBeLessThan(30000); // 30 seconds for 10 operations
    }, 45000);

    it('should maintain workflow consistency under load', async () => {
      // Simulate multiple clients running workflows simultaneously
      const clientWorkflows = Array.from({ length: 5 }, async (_, clientId) => {
        const results = [];

        // Each client performs a mini-workflow
        for (let step = 0; step < 3; step++) {
          const data = await callTool('MapboxGeocodingForward', {
            q: `Client ${clientId} Step ${step}`,
            limit: 1
          });

          results.push(data);
        }

        return results;
      });

      const allResults = await Promise.all(clientWorkflows);

      // Verify all clients completed their workflows
      expect(allResults).toHaveLength(5);
      allResults.forEach((clientResults) => {
        expect(clientResults).toHaveLength(3);
        clientResults.forEach((result) => {
          expect(result.jsonrpc).toBe('2.0');
          expect(result.result || result.error).toBeDefined();
        });
      });
    }, 60000);
  });

  describe('Workflow Error Handling and Recovery', () => {
    it('should handle graceful degradation in workflow chains', async () => {
      // Workflow that continues despite individual failures
      const workflow = async () => {
        const results = [];

        // Step 1: Valid geocoding
        try {
          const step1 = await callTool('MapboxGeocodingForward', {
            q: 'San Francisco',
            limit: 1
          });
          results.push({ step: 1, success: true, data: step1 });
        } catch (error) {
          results.push({ step: 1, success: false, error });
        }

        // Step 2: Invalid operation (should fail but not break workflow)
        try {
          const step2 = await callTool('nonexistent_tool', {
            param: 'value'
          });
          const data = await step2.json();
          if (data.error) {
            results.push({ step: 2, success: false, error: data.error });
          } else {
            results.push({ step: 2, success: true, data: step2 });
          }
        } catch (error) {
          results.push({ step: 2, success: false, error });
        }

        // Step 3: Valid operation (should succeed)
        try {
          const step3 = await callTool('MapboxPoiSearch', {
            q: 'restaurant',
            proximity: { longitude: -122.4194, latitude: 37.7749 },
            limit: 3
          });
          results.push({ step: 3, success: true, data: step3 });
        } catch (error) {
          results.push({ step: 3, success: false, error });
        }

        return results;
      };

      const results = await workflow();

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true); // Step 1 should succeed
      expect(results[1].success).toBe(false); // Step 2 should fail
      expect(results[2].success).toBe(true); // Step 3 should succeed
    }, 45000);
  });
});
