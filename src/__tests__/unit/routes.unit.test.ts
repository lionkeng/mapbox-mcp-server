/**
 * Unit tests for HTTP routes using fastify.inject()
 * Tests route handlers without starting a full HTTP server
 */

import { buildTestApp, buildMinimalApp } from '../helpers/index.js';
import {
  createTestToken,
  createAuthHeader,
  TEST_HEADERS,
  MCP_REQUESTS
} from '../helpers/index.js';

describe('Routes Unit Tests', () => {
  describe('Health Endpoints', () => {
    it('should return healthy status on /health', async () => {
      const app = await buildMinimalApp();

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.status).toBe('healthy');
      expect(data.timestamp).toBeDefined();
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return ready status on /ready', async () => {
      const app = await buildMinimalApp();

      const response = await app.inject({
        method: 'GET',
        url: '/ready'
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.status).toBe('ready');
      expect(data.timestamp).toBeDefined();
    });

    it('should return metrics when enabled', async () => {
      const app = await buildMinimalApp({ enableMetrics: true });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics'
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.uptime).toBeGreaterThanOrEqual(0);
      expect(data.connections).toBeDefined();
      expect(data.requests).toBeDefined();
      expect(data.memory).toBeDefined();
    });

    it('should return 404 for metrics when disabled', async () => {
      const app = await buildMinimalApp({ enableMetrics: false });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics'
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Messages Endpoint - Authentication', () => {
    it('should require authentication for POST /messages', async () => {
      const app = await buildTestApp();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: TEST_HEADERS.JSON,
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(401);
      const data = response.json();
      expect(data.error).toBeDefined();
    });

    it('should accept valid JWT token', async () => {
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

    it('should reject malformed Authorization header', async () => {
      const app = await buildTestApp();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          Authorization: 'InvalidFormat token'
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject missing Bearer prefix', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          Authorization: token // Missing "Bearer " prefix
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Messages Endpoint - Content Type Validation', () => {
    it('should accept application/json Content-Type', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          'Content-Type': 'application/json',
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(200);
    });

    it('should reject invalid Content-Type', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          'Content-Type': 'text/plain',
          ...createAuthHeader(token)
        },
        payload: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle missing Content-Type', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: createAuthHeader(token),
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      // Should default to application/json or handle gracefully
      expect([200, 400]).toContain(response.statusCode);
    });
  });

  describe('Messages Endpoint - JSON-RPC Validation', () => {
    it('should validate JSON-RPC 2.0 format', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: {
          // Missing jsonrpc field
          id: 'test',
          method: 'tools/list',
          params: {}
        }
      });

      expect(response.statusCode).toBe(400);
      const data = response.json();
      expect(data.error).toBeDefined();
    });

    it('should reject invalid JSON-RPC version', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: {
          jsonrpc: '1.0', // Invalid version
          id: 'test',
          method: 'tools/list',
          params: {}
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle malformed JSON', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: '{ invalid json }'
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle empty request body', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: ''
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('HTTP Method Support', () => {
    it.skip('should support GET for SSE endpoint', () => {
      // Skipped: Fastify.inject() does not support streaming endpoints that never close (SSE).
      // This test is covered by integration/e2e tests.
    });

    it('should support DELETE for session cleanup', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'DELETE',
        url: '/messages',
        headers: {
          ...createAuthHeader(token),
          'Mcp-Session-Id': 'test-session-123'
        }
      });

      expect(response.statusCode).toBe(204);
    });

    it('should reject unsupported HTTP methods', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'PUT',
        url: '/messages',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent routes', async () => {
      const app = await buildTestApp();

      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent'
      });

      expect(response.statusCode).toBe(404);
    });

    it('should handle server errors gracefully', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      // Trigger an error by sending invalid tool name
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
            name: 'nonexistent_tool',
            arguments: {}
          }
        }
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('Tool not found');
    });
  });
});
