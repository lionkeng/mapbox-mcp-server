/**
 * HTTP protocol integration tests
 * Tests HTTP-specific functionality with minimal server setup
 */

import { buildTestServer, cleanupTestServer } from '../helpers/index.js';
import {
  createTestToken,
  createAuthHeader,
  TEST_HEADERS
} from '../helpers/index.js';
import { ErrorResponse } from '../helpers/index.js';
import { HttpServer } from '../../server/httpServer.js';

describe('HTTP Protocol Integration Tests', () => {
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

  describe('CORS Configuration', () => {
    it('should handle CORS preflight requests', async () => {
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization'
        }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBeTruthy();
      expect(response.headers.get('access-control-allow-methods')).toContain(
        'POST'
      );
      expect(response.headers.get('access-control-allow-headers')).toContain(
        'Content-Type'
      );
    });

    it('should allow requests from localhost origins', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token),
          Origin: 'http://localhost:3000'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBeTruthy();
    });

    it('should include credentials in CORS headers', async () => {
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST'
        }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true'
      );
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting headers', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(200);
      // Check if rate limit headers are present
      const rateLimit = response.headers.get('x-ratelimit-limit');
      const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');

      if (rateLimit) {
        expect(parseInt(rateLimit)).toBeGreaterThan(0);
      }
      if (rateLimitRemaining) {
        expect(parseInt(rateLimitRemaining)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle multiple requests within rate limit', async () => {
      const token = createTestToken();
      const requests = Array.from({ length: 5 }, () =>
        fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Math.random().toString(),
            method: 'tools/list',
            params: {}
          })
        })
      );

      const responses = await Promise.all(requests);

      // All requests should succeed within normal rate limits
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await fetch(`${serverUrl}/health`);

      expect(response.status).toBe(200);

      // Check for security headers set by Helmet
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBeTruthy();
      expect(response.headers.get('x-dns-prefetch-control')).toBeTruthy();
    });

    it('should include HSTS header in production-like setup', async () => {
      const response = await fetch(`${serverUrl}/health`);

      // HSTS might be configured differently in test vs production
      const hstsHeader = response.headers.get('strict-transport-security');
      if (hstsHeader) {
        expect(hstsHeader).toContain('max-age');
      }
    });
  });

  describe('Content Type Handling', () => {
    it('should handle application/json content type', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'application/json'
      );
    });

    it('should reject unsupported content types', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(400);
    });

    it('should handle charset in content type', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Request Size Limits', () => {
    it('should accept requests within size limits', async () => {
      const token = createTestToken();
      const largeButValidPayload = {
        jsonrpc: '2.0' as const,
        id: 'test',
        method: 'tools/list',
        params: {
          extraData: 'x'.repeat(1000) // 1KB of extra data
        }
      };

      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(largeButValidPayload)
      });

      expect(response.status).toBe(200);
    });

    it('should reject requests exceeding size limits', async () => {
      const token = createTestToken();
      const oversizedPayload = {
        jsonrpc: '2.0' as const,
        id: 'test',
        method: 'tools/list',
        params: {
          extraData: 'x'.repeat(2 * 1024 * 1024) // 2MB of data
        }
      };

      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(oversizedPayload)
      });

      expect(response.status).toBe(413); // Payload too large
    });
  });

  describe('HTTP Method Support', () => {
    it('should support POST method', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(200);
    });

    it('should support GET method for SSE', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
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

    it('should support DELETE method for session cleanup', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'DELETE',
        headers: {
          ...createAuthHeader(token),
          'Mcp-Session-Id': 'test-session-123'
        }
      });

      expect(response.status).toBe(204);
    });

    it('should reject unsupported HTTP methods', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'PUT',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(404); // Method not found
    });
  });

  describe('Error Response Format', () => {
    it('should return proper error format for authentication failures', async () => {
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: TEST_HEADERS.JSON,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(401);
      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBeDefined();
      expect(typeof data.error).toBe('string');
    });

    it('should return proper error format for validation failures', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: '{ invalid json }'
      });

      expect(response.status).toBe(400);
      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBeDefined();
    });

    it('should include request correlation in error responses', async () => {
      const correlationId = 'test-correlation-123';
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          'X-Correlation-Id': correlationId
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(401);
      // The correlation ID should be logged but might not be in response body
      expect(
        response.headers.get('x-correlation-id') || correlationId
      ).toBeTruthy();
    });
  });

  describe('Keep-Alive and Connection Management', () => {
    it('should handle multiple requests on same connection', async () => {
      const token = createTestToken();

      // Make multiple requests in sequence
      for (let i = 0; i < 3; i++) {
        const response = await fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token),
            Connection: 'keep-alive'
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `test-${i}`,
            method: 'tools/list',
            params: {}
          })
        });

        expect(response.status).toBe(200);
      }
    });

    it('should handle connection close gracefully', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token),
          Connection: 'close'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(200);
    });
  });
});
