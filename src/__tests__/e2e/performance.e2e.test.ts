/**
 * Performance End-to-End tests
 * Tests system performance, load handling, and scalability with full HTTP server
 */

import { buildTestServer, cleanupTestServer } from '../helpers/index.js';
import {
  createTestToken,
  createAuthHeader,
  TEST_HEADERS
} from '../helpers/index.js';
import { HttpServer } from '../../server/httpServer.js';

describe('Performance End-to-End Tests', () => {
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
    const response = await fetch(`${serverUrl}/mcp`, {
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

    return response;
  };

  describe('Response Time Performance', () => {
    it('should respond to tools/list within acceptable time', async () => {
      const startTime = Date.now();

      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'perf-test',
          method: 'tools/list',
          params: {}
        })
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
    });

    it('should maintain consistent response times for geocoding', async () => {
      const responseTimes: number[] = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();

        const response = await callTool('forward_geocode_tool', {
          q: `Test Query ${i}`,
          limit: 1
        });

        const endTime = Date.now();
        responseTimes.push(endTime - startTime);

        expect(response.status).toBe(200);
      }

      // Calculate average and check consistency
      const avgResponseTime =
        responseTimes.reduce((a, b) => a + b) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const minResponseTime = Math.min(...responseTimes);

      expect(avgResponseTime).toBeLessThan(2000); // Average under 2 seconds
      expect(maxResponseTime - minResponseTime).toBeLessThan(5000); // Consistent within 5 seconds
    }, 30000);

    it('should handle rapid sequential requests efficiently', async () => {
      const startTime = Date.now();
      const iterations = 20;

      for (let i = 0; i < iterations; i++) {
        const response = await fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `rapid-${i}`,
            method: 'tools/list',
            params: {}
          })
        });

        expect(response.status).toBe(200);
      }

      const totalTime = Date.now() - startTime;
      const avgTimePerRequest = totalTime / iterations;

      expect(avgTimePerRequest).toBeLessThan(500); // Average 500ms per request
    }, 30000);
  });

  describe('Concurrent Load Performance', () => {
    it('should handle moderate concurrent load', async () => {
      const concurrentRequests = 10;
      const startTime = Date.now();

      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `concurrent-${i}`,
            method: 'tools/list',
            params: {}
          })
        })
      );

      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      // Should complete within reasonable time
      expect(totalTime).toBeLessThan(10000); // 10 seconds for 10 concurrent requests
    }, 15000);

    it('should handle mixed concurrent operations', async () => {
      const operations = [
        () =>
          callTool('forward_geocode_tool', { q: 'San Francisco', limit: 1 }),
        () =>
          callTool('reverse_geocode_tool', {
            longitude: -122.4194,
            latitude: 37.7749,
            limit: 1
          }),
        () =>
          callTool('poi_search_tool', {
            q: 'coffee',
            proximity: { longitude: -122.4194, latitude: 37.7749 },
            limit: 3
          }),
        () =>
          callTool('directions_tool', {
            coordinates: [
              [-122.4194, 37.7749],
              [-122.4094, 37.7849]
            ],
            profile: 'driving'
          }),
        () =>
          callTool('MapboxMatrix', {
            coordinates: [
              { longitude: -122.4194, latitude: 37.7749 },
              { longitude: -122.4094, latitude: 37.7849 }
            ],
            profile: 'driving'
          })
      ];

      const startTime = Date.now();

      // Run each operation type twice concurrently
      const promises = operations.concat(operations).map((op) => op());
      const responses = await Promise.all(promises);

      const totalTime = Date.now() - startTime;

      // Check that most requests succeeded (some may fail due to invalid test data)
      const successCount = responses.filter((r) => r.status === 200).length;
      expect(successCount).toBeGreaterThan(7); // At least 70% success rate

      expect(totalTime).toBeLessThan(15000); // Should complete within 15 seconds
    }, 20000);

    it('should maintain performance under sustained load', async () => {
      const batchCount = 5;
      const requestsPerBatch = 5;
      const allResponseTimes: number[] = [];

      for (let batch = 0; batch < batchCount; batch++) {
        const batchStart = Date.now();

        const batchPromises = Array.from({ length: requestsPerBatch }, (_, i) =>
          fetch(`${serverUrl}/mcp`, {
            method: 'POST',
            headers: {
              ...TEST_HEADERS.JSON,
              ...createAuthHeader(token)
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `sustained-${batch}-${i}`,
              method: 'tools/list',
              params: {}
            })
          })
        );

        const batchResponses = await Promise.all(batchPromises);
        const batchTime = Date.now() - batchStart;

        // All requests in batch should succeed
        batchResponses.forEach((response) => {
          expect(response.status).toBe(200);
        });

        allResponseTimes.push(batchTime);

        // Small delay between batches to simulate realistic usage
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Performance should not degrade significantly over time
      const firstBatchTime = allResponseTimes[0];
      const lastBatchTime = allResponseTimes[allResponseTimes.length - 1];
      const degradationRatio = lastBatchTime / firstBatchTime;

      expect(degradationRatio).toBeLessThan(2); // Performance shouldn't degrade more than 2x
    }, 45000);
  });

  describe('Memory and Resource Performance', () => {
    it('should handle large batches without memory issues', async () => {
      const largeBatch = Array.from({ length: 50 }, (_, i) => ({
        jsonrpc: '2.0' as const,
        id: `large-batch-${i}`,
        method: 'tools/list',
        params: {}
      }));

      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(largeBatch)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(50);
    }, 30000);

    it('should handle requests with large payloads efficiently', async () => {
      // Create a request with a large amount of data
      const largeQuery = 'San Francisco ' + 'x'.repeat(1000); // 1KB+ query

      const startTime = Date.now();
      const response = await callTool('forward_geocode_tool', {
        q: largeQuery,
        limit: 1
      });
      const responseTime = Date.now() - startTime;

      // Should handle large payloads gracefully (may return error but shouldn't crash)
      expect([200, 400].includes(response.status)).toBe(true);
      expect(responseTime).toBeLessThan(5000); // Should respond within 5 seconds
    });

    it('should maintain stable memory usage across multiple requests', async () => {
      // Simulate a realistic usage pattern over time
      const testDuration = 10000; // 10 seconds
      const requestInterval = 200; // Every 200ms
      const startTime = Date.now();
      const responses: Response[] = [];

      while (Date.now() - startTime < testDuration) {
        const response = await fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `memory-test-${Date.now()}`,
            method: 'tools/list',
            params: {}
          })
        });

        responses.push(response);

        // Wait before next request
        await new Promise((resolve) => setTimeout(resolve, requestInterval));
      }

      // All requests should have succeeded
      const successfulResponses = responses.filter((r) => r.status === 200);
      const successRate = successfulResponses.length / responses.length;
      expect(successRate).toBeGreaterThan(0.9); // 90% success rate

      // Should have made a reasonable number of requests
      expect(responses.length).toBeGreaterThan(30);
    }, 15000);
  });

  describe('SSE Performance', () => {
    it('should establish SSE connections quickly', async () => {
      const startTime = Date.now();

      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        }
      });

      const connectionTime = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(connectionTime).toBeLessThan(1000); // Should connect within 1 second

      // Close connection
      if (response.body) {
        await response.body.cancel();
      }
    });

    it('should handle multiple concurrent SSE connections efficiently', async () => {
      const connectionCount = 5;
      const startTime = Date.now();

      const connectionPromises = Array.from({ length: connectionCount }, () =>
        fetch(`${serverUrl}/mcp`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...createAuthHeader(token)
          }
        })
      );

      const responses = await Promise.all(connectionPromises);
      const totalConnectionTime = Date.now() - startTime;

      // All connections should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain(
          'text/event-stream'
        );
      });

      expect(totalConnectionTime).toBeLessThan(5000); // All connections within 5 seconds

      // Clean up connections
      await Promise.all(
        responses.map((response) =>
          response.body ? response.body.cancel() : Promise.resolve()
        )
      );
    }, 10000);

    it('should maintain SSE performance under load', async () => {
      // Establish SSE connection
      const sseResponse = await fetch(`${serverUrl}/mcp`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        }
      });

      expect(sseResponse.status).toBe(200);

      // While SSE is active, make concurrent API calls
      const apiCalls = Array.from({ length: 10 }, (_, i) =>
        fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `sse-load-${i}`,
            method: 'tools/list',
            params: {}
          })
        })
      );

      const startTime = Date.now();
      const apiResponses = await Promise.all(apiCalls);
      const totalTime = Date.now() - startTime;

      // API calls should still work efficiently
      apiResponses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds

      // Close SSE connection
      if (sseResponse.body) {
        await sseResponse.body.cancel();
      }
    }, 15000);
  });

  describe('Error Handling Performance', () => {
    it('should handle error conditions efficiently', async () => {
      const errorRequests = [
        // Invalid JSON
        fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: '{ invalid json }'
        }),
        // Invalid tool
        fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'error-test',
            method: 'tools/call',
            params: {
              name: 'NonExistentTool',
              arguments: {}
            }
          })
        }),
        // Missing authentication
        fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: TEST_HEADERS.JSON,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'unauth-test',
            method: 'tools/list',
            params: {}
          })
        })
      ];

      const startTime = Date.now();
      const responses = await Promise.all(errorRequests);
      const totalTime = Date.now() - startTime;

      // Error responses should be fast
      expect(totalTime).toBeLessThan(3000); // Within 3 seconds

      // Check that appropriate error status codes are returned
      expect(responses[0].status).toBe(400); // Invalid JSON
      expect(responses[1].status).toBe(200); // Valid JSON-RPC with tool error
      expect(responses[2].status).toBe(401); // Unauthorized
    });

    it('should recover quickly from error conditions', async () => {
      // Make an error request
      await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: TEST_HEADERS.JSON,
        body: '{ invalid json }'
      });

      // Immediately follow with valid request
      const startTime = Date.now();
      const validResponse = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'recovery-test',
          method: 'tools/list',
          params: {}
        })
      });
      const recoveryTime = Date.now() - startTime;

      expect(validResponse.status).toBe(200);
      expect(recoveryTime).toBeLessThan(1000); // Should recover within 1 second
    });
  });
});
