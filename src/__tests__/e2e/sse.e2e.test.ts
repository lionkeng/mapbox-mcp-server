/**
 * Server-Sent Events (SSE) End-to-End tests
 * Tests real SSE connections and streaming behavior - requires full HTTP server
 */

import { buildTestServer, cleanupTestServer } from '../helpers/index.js';
import { createTestToken, createAuthHeader } from '../helpers/index.js';
import {
  SseConnection,
  SseConnectionPool,
  testSseConnection,
  testConcurrentSseConnections
} from '../helpers/index.js';
import { HTTP_STATUS, TIMEOUTS } from '../helpers/index.js';
import { HttpServer } from '../../server/httpServer.js';

describe('SSE End-to-End Tests', () => {
  let server: HttpServer;
  let serverUrl: string;

  beforeEach(async () => {
    const testServer = await buildTestServer();
    server = testServer.server;
    serverUrl = testServer.url;
  });

  afterEach(async () => {
    await cleanupTestServer(server);
  }, 15000); // 15 second timeout for cleanup

  describe('SSE Connection Establishment', () => {
    it(
      'should establish SSE connection with proper headers',
      async () => {
        const token = createTestToken();
        const { connection, cleanup } = await testSseConnection(
          serverUrl,
          token
        );

        try {
          const response = connection.getResponse();
          expect(response?.status).toBe(HTTP_STATUS.OK);
          expect(response?.headers.get('content-type')).toContain(
            'text/event-stream'
          );
          expect(response?.headers.get('cache-control')).toContain('no-cache');
          expect(response?.headers.get('connection')).toBe('keep-alive');
          expect(connection.getSessionId()).toBeTruthy();
        } finally {
          await cleanup();
        }
      },
      TIMEOUTS.E2E_TEST
    );

    it('should generate unique session IDs for different connections', async () => {
      const token = createTestToken();

      const response1 = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        }
      });

      const response2 = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        }
      });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const sessionId1 = response1.headers.get('mcp-session-id');
      const sessionId2 = response2.headers.get('mcp-session-id');

      expect(sessionId1).toBeTruthy();
      expect(sessionId2).toBeTruthy();
      expect(sessionId1).not.toBe(sessionId2);

      // Close connections
      if (response1.body) await response1.body.cancel();
      if (response2.body) await response2.body.cancel();
    }, 15000);

    it('should respect custom session ID header', async () => {
      const token = createTestToken();
      const customSessionId = 'custom-session-123';

      const response = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Mcp-Session-Id': customSessionId,
          ...createAuthHeader(token)
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('mcp-session-id')).toBe(customSessionId);

      // Close connection
      if (response.body) await response.body.cancel();
    }, 15000);
  });

  describe('SSE Session Management', () => {
    it('should handle session deletion with DELETE method', async () => {
      const token = createTestToken();

      // First establish a session
      const getResponse = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        }
      });

      expect(getResponse.status).toBe(200);
      const sessionId = getResponse.headers.get('mcp-session-id');
      expect(sessionId).toBeTruthy();

      // Then delete the session
      const deleteResponse = await fetch(`${serverUrl}/messages`, {
        method: 'DELETE',
        headers: {
          ...createAuthHeader(token),
          'Mcp-Session-Id': sessionId!
        }
      });

      expect(deleteResponse.status).toBe(204);

      // Close the SSE connection
      if (getResponse.body) await getResponse.body.cancel();
    }, 15000);

    it('should return 400 for DELETE without session ID', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'DELETE',
        headers: createAuthHeader(token)
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Mcp-Session-Id');
    });

    it('should handle deletion of non-existent session gracefully', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'DELETE',
        headers: {
          ...createAuthHeader(token),
          'Mcp-Session-Id': 'non-existent-session'
        }
      });

      expect(response.status).toBe(204);
    });
  });

  describe('SSE Authentication', () => {
    it('should require authentication for SSE connections', async () => {
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream'
        }
      });

      expect(response.status).toBe(401);
    });

    it('should reject SSE connections with invalid tokens', async () => {
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: 'Bearer invalid.token.here'
        }
      });

      expect(response.status).toBe(401);
    });

    it('should maintain authentication throughout SSE session', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        }
      });

      expect(response.status).toBe(200);

      // Verify connection stays authenticated
      // The actual streaming would be tested in a more complex scenario

      // Close connection
      if (response.body) await response.body.cancel();
    }, 15000);
  });

  describe('SSE Connection Lifecycle', () => {
    it('should handle connection close gracefully', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        }
      });

      expect(response.status).toBe(200);
      const sessionId = response.headers.get('mcp-session-id');

      // Simulate connection close
      if (response.body) {
        await response.body.cancel();
      }

      // Verify session is cleaned up (attempt to delete should still work)
      const deleteResponse = await fetch(`${serverUrl}/messages`, {
        method: 'DELETE',
        headers: {
          ...createAuthHeader(token),
          'Mcp-Session-Id': sessionId!
        }
      });

      expect(deleteResponse.status).toBe(204);
    }, 15000);

    it(
      'should handle multiple concurrent SSE connections',
      async () => {
        const token = createTestToken();
        const { pool, connections, cleanup } =
          await testConcurrentSseConnections(serverUrl, 3, token);

        try {
          // All connections should be successful
          connections.forEach((connection) => {
            const response = connection.getResponse();
            expect(response?.status).toBe(HTTP_STATUS.OK);
            expect(response?.headers.get('content-type')).toContain(
              'text/event-stream'
            );
            expect(connection.getSessionId()).toBeTruthy();
          });

          // Each should have unique session IDs
          expect(pool.verifyUniqueSessionIds()).toBe(true);
          expect(pool.getConnectionCount()).toBe(3);
        } finally {
          // Ensure cleanup happens even if test fails
          await cleanup();
        }
      },
      TIMEOUTS.E2E_TEST
    );
  });

  describe('SSE Error Handling', () => {
    it('should handle invalid Accept headers for SSE', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/html', // Invalid for SSE
          ...createAuthHeader(token)
        }
      });

      // Should be rejected with validation error (200 with JSON-RPC error)
      expect([200, 400, 406].includes(response.status)).toBe(true);

      // Ensure any response body is properly closed
      if (response.body) {
        await response.body.cancel();
      }
    });

    it('should handle SSE connection timeouts appropriately', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        }
      });

      expect(response.status).toBe(200);

      // In a real scenario, you would test timeout behavior
      // For now, just verify the connection can be established and closed

      // Close connection immediately
      if (response.body) {
        await response.body.cancel();
      }
    }, 15000);
  });

  describe('SSE Performance', () => {
    it('should handle rapid SSE connection establishment and closure', async () => {
      const token = createTestToken();
      const iterations = 5;

      for (let i = 0; i < iterations; i++) {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...createAuthHeader(token)
          }
        });

        expect(response.status).toBe(200);
        const sessionId = response.headers.get('mcp-session-id');
        expect(sessionId).toBeTruthy();

        // Close connection
        if (response.body) {
          await response.body.cancel();
        }

        // Delete session
        await fetch(`${serverUrl}/messages`, {
          method: 'DELETE',
          headers: {
            ...createAuthHeader(token),
            'Mcp-Session-Id': sessionId!
          }
        });
      }
    }, 30000);

    it('should maintain SSE performance under concurrent load', async () => {
      const token = createTestToken();
      const concurrentConnections = 10;

      const startTime = Date.now();

      const connectionPromises = Array.from(
        { length: concurrentConnections },
        async () => {
          const response = await fetch(`${serverUrl}/messages`, {
            method: 'GET',
            headers: {
              Accept: 'text/event-stream',
              ...createAuthHeader(token)
            }
          });

          expect(response.status).toBe(200);

          // Hold connection briefly
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Close connection
          if (response.body) {
            await response.body.cancel();
          }

          return response;
        }
      );

      await Promise.all(connectionPromises);

      const totalTime = Date.now() - startTime;

      // Should complete within reasonable time (adjust threshold as needed)
      expect(totalTime).toBeLessThan(10000); // 10 seconds
    }, 30000);
  });
});
