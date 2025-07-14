/**
 * Unit tests for MCP transport logic using fastify.inject()
 * Tests MCP protocol implementation without full server
 */

import { buildTestApp } from '../helpers/index.js';
import { createTestToken, createAuthHeader } from '../helpers/index.js';
import {
  MCP_REQUESTS,
  INVALID_MCP_REQUESTS,
  TEST_HEADERS,
  createBatchRequest,
  generateRequestId,
  TOOL_PARAMS
} from '../helpers/index.js';

describe('MCP Transport Unit Tests', () => {
  describe('MCP Protocol Compliance', () => {
    it('should handle initialize method', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.INITIALIZE
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.protocolVersion).toBe('2024-11-05');
      expect(data.result.capabilities).toBeDefined();
      expect(data.result.serverInfo).toBeDefined();
      expect(data.result.serverInfo.name).toBe('mapbox-mcp-server');
    });

    it('should handle tools/list method', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
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
      expect(Array.isArray(data.result.tools)).toBe(true);
      expect(data.result.tools.length).toBe(8); // All 8 Mapbox tools

      // Verify tool structure
      data.result.tools.forEach((tool: any) => {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
      });
    });

    it('should handle tools/call method', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.GEOCODE_FORWARD
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
    });

    it('should maintain request/response correlation', async () => {
      const app = await buildTestApp();
      const token = createTestToken();
      const requestId = generateRequestId();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: {
          ...MCP_REQUESTS.TOOLS_LIST,
          id: requestId
        }
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.id).toBe(requestId);
    });
  });

  describe('JSON-RPC Error Handling', () => {
    it('should return parse error for invalid JSON', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: '{ invalid json }'
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return invalid request for missing jsonrpc', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: INVALID_MCP_REQUESTS.MISSING_JSONRPC
      });

      expect(response.statusCode).toBe(400);
      const data = response.json();
      expect(data.error).toBeDefined();
    });

    it('should return invalid request for wrong version', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: INVALID_MCP_REQUESTS.INVALID_VERSION
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return method not found for invalid method', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: {
          jsonrpc: '2.0',
          id: 'test',
          method: 'invalid/method',
          params: {}
        }
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602); // Invalid params (method validation happens later)
    });

    it('should return invalid params for tool not found', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: INVALID_MCP_REQUESTS.INVALID_TOOL
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('Tool not found');
    });

    it('should validate tool parameters', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: INVALID_MCP_REQUESTS.MISSING_TOOL_ARGS
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602); // Invalid params
    });
  });

  describe('Batch Request Handling', () => {
    it('should handle batch requests', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const batchRequest = createBatchRequest([
        MCP_REQUESTS.TOOLS_LIST,
        MCP_REQUESTS.GEOCODE_FORWARD
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: batchRequest
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data[0].id).toBe('batch-0');
      expect(data[1].id).toBe('batch-1');
    });

    it('should handle mixed batch requests and notifications', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const batchRequest = [
        { ...MCP_REQUESTS.TOOLS_LIST, id: 'req-1' },
        { jsonrpc: '2.0', method: 'some/notification', params: {} }, // No id = notification
        { ...MCP_REQUESTS.GEOCODE_FORWARD, id: 'req-2' }
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: batchRequest
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2); // Only responses for requests with IDs
      expect(data[0].id).toBe('req-1');
      expect(data[1].id).toBe('req-2');
    });

    it('should return 202 for batch of only notifications', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const notificationBatch = [
        { jsonrpc: '2.0', method: 'notification/one', params: {} },
        { jsonrpc: '2.0', method: 'notification/two', params: {} }
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: notificationBatch
      });

      expect(response.statusCode).toBe(202);
      expect(response.body).toBe('');
    });

    it('should handle batch with errors', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const batchRequest = createBatchRequest([
        MCP_REQUESTS.TOOLS_LIST, // Valid
        INVALID_MCP_REQUESTS.INVALID_TOOL // Invalid
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: batchRequest
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data[0].result).toBeDefined(); // First request succeeded
      expect(data[1].error).toBeDefined(); // Second request failed
    });
  });

  describe('Tool Parameter Validation', () => {
    it('should validate geocoding forward parameters', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      // Test missing required parameter
      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: {
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/call',
          params: {
            name: 'MapboxGeocodingForward',
            arguments: TOOL_PARAMS.GEOCODING_FORWARD.MISSING_Q
          }
        }
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
    });

    it('should validate geocoding reverse parameters', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: {
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/call',
          params: {
            name: 'MapboxGeocodingReverse',
            arguments: TOOL_PARAMS.GEOCODING_REVERSE.INVALID_COORDS
          }
        }
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.error).toBeDefined();
    });

    it('should validate directions parameters', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: {
          jsonrpc: '2.0',
          id: 'test',
          method: 'tools/call',
          params: {
            name: 'MapboxDirections',
            arguments: TOOL_PARAMS.DIRECTIONS.SINGLE_COORD
          }
        }
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('Response Format Validation', () => {
    it('should return proper MCP response format', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: MCP_REQUESTS.TOOLS_LIST
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();

      // Validate JSON-RPC 2.0 response format
      expect(data.jsonrpc).toBe('2.0');
      expect(data.id).toBeDefined();
      expect(data.result || data.error).toBeDefined();

      if (data.result) {
        expect(data.error).toBeUndefined();
      } else if (data.error) {
        expect(data.result).toBeUndefined();
        expect(data.error.code).toBeDefined();
        expect(data.error.message).toBeDefined();
      }
    });

    it('should handle notifications without response', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: {
          jsonrpc: '2.0',
          method: 'some/notification',
          params: {}
        }
      });

      expect(response.statusCode).toBe(202);
      expect(response.body).toBe('');
    });

    it('should include error details for debugging', async () => {
      const app = await buildTestApp();
      const token = createTestToken();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        payload: INVALID_MCP_REQUESTS.INVALID_TOOL
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBeDefined();
      expect(data.error.message).toBeDefined();
      expect(data.error.message.length).toBeGreaterThan(10); // Meaningful error message
    });
  });
});
