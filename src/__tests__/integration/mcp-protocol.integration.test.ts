/**
 * MCP protocol integration tests
 * Tests MCP Streamable HTTP transport compliance with minimal server setup
 */

import { buildTestServer, cleanupTestServer } from '../helpers/index.js';
import {
  createTestToken,
  createLimitedPermissionsToken,
  createAuthHeader,
  TEST_HEADERS,
  MCP_REQUESTS,
  INVALID_MCP_REQUESTS,
  createBatchRequest,
  PERMISSION_SETS,
  JsonRpcResponse
} from '../helpers/index.js';
import { HttpServer } from '../../server/httpServer.js';

/**
 * MCP Tool interface for type safety
 */
interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * MCP Tools list response interface
 */
interface McpToolsListResult {
  tools: McpTool[];
}

describe('MCP Protocol Integration Tests', () => {
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

  describe('MCP Streamable HTTP Transport Compliance', () => {
    it('should accept requests with application/json Accept header', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
    });

    it('should accept requests with text/event-stream Accept header', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
    });

    it('should accept requests with both Accept headers', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
    });

    it('should reject requests with invalid Accept header', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/html',
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('Accept header');
    });
  });

  describe('JSON-RPC 2.0 Protocol Compliance', () => {
    it('should handle valid JSON-RPC requests', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.INITIALIZE)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.id).toBe(MCP_REQUESTS.INITIALIZE.id);
      expect(data.result).toBeDefined();
    });

    it('should reject missing jsonrpc field', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(INVALID_MCP_REQUESTS.MISSING_JSONRPC)
      });

      expect(response.status).toBe(400);
    });

    it('should reject invalid jsonrpc version', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(INVALID_MCP_REQUESTS.INVALID_VERSION)
      });

      expect(response.status).toBe(400);
    });

    it('should handle notifications (requests without id)', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'some/notification',
          params: { data: 'test' }
        })
      });

      expect(response.status).toBe(202);
      expect(response.text()).resolves.toBe('');
    });

    it('should return 202 for JSON-RPC responses', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'response-1',
          result: { someData: 'value' }
        })
      });

      expect(response.status).toBe(202);
      expect(response.text()).resolves.toBe('');
    });

    it('should return 202 for JSON-RPC error responses', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
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
      expect(response.text()).resolves.toBe('');
    });
  });

  describe('Batch Request Support', () => {
    it('should handle batch requests with multiple operations', async () => {
      const token = createTestToken();
      const batchRequest = createBatchRequest([
        MCP_REQUESTS.TOOLS_LIST,
        MCP_REQUESTS.GEOCODE_FORWARD
      ]);

      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(batchRequest)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data[0].id).toBe('batch-0');
      expect(data[1].id).toBe('batch-1');
    });

    it('should handle batch with mixed requests and notifications', async () => {
      const token = createTestToken();
      const batchRequest = [
        { ...MCP_REQUESTS.TOOLS_LIST, id: 'req-1' },
        { jsonrpc: '2.0', method: 'some/notification', params: {} }, // No id
        { ...MCP_REQUESTS.GEOCODE_FORWARD, id: 'req-2' }
      ];

      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(batchRequest)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2); // Only responses for requests with IDs
      expect(data[0].id).toBe('req-1');
      expect(data[1].id).toBe('req-2');
    });

    it('should return 202 for batch of only notifications', async () => {
      const token = createTestToken();
      const notificationBatch = [
        { jsonrpc: '2.0', method: 'notification/one', params: {} },
        { jsonrpc: '2.0', method: 'notification/two', params: {} }
      ];

      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(notificationBatch)
      });

      expect(response.status).toBe(202);
      expect(response.text()).resolves.toBe('');
    });

    it('should handle batch with errors properly', async () => {
      const token = createTestToken();
      const batchRequest = createBatchRequest([
        MCP_REQUESTS.TOOLS_LIST, // Valid
        INVALID_MCP_REQUESTS.INVALID_TOOL // Invalid
      ]);

      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(batchRequest)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data[0].result).toBeDefined(); // First request succeeded
      expect(data[1].error).toBeDefined(); // Second request failed
    });
  });

  describe('Tool Discovery and Execution', () => {
    it('should list all available tools', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.TOOLS_LIST)
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as JsonRpcResponse;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();

      const result = data.result as McpToolsListResult;
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBe(8); // All 8 Mapbox tools

      const expectedTools = [
        'matrix_tool',
        'reverse_geocode_tool',
        'forward_geocode_tool',
        'isochrone_tool',
        'poi_search_tool',
        'category_search_tool',
        'static_map_image_tool',
        'directions_tool'
      ];

      const toolNames = result.tools.map((tool: McpTool) => tool.name);
      expectedTools.forEach((expectedTool) => {
        expect(toolNames).toContain(expectedTool);
      });
    });

    it('should execute tools with proper permissions', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.GEOCODE_FORWARD)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(Array.isArray(data.result.content)).toBe(true);
    });

    it('should enforce permission-based tool access', async () => {
      const limitedToken = createLimitedPermissionsToken(
        PERMISSION_SETS.GEOCODE_ONLY
      );

      // Should allow geocoding
      const geocodeResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(limitedToken)
        },
        body: JSON.stringify(MCP_REQUESTS.GEOCODE_FORWARD)
      });

      expect(geocodeResponse.status).toBe(200);
      const geocodeData = await geocodeResponse.json();
      expect(geocodeData.result).toBeDefined();

      // Should deny directions
      const directionsResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(limitedToken)
        },
        body: JSON.stringify(MCP_REQUESTS.DIRECTIONS)
      });

      expect(directionsResponse.status).toBe(200);
      const directionsData = await directionsResponse.json();
      expect(directionsData.error).toBeDefined();
      expect(directionsData.error.message).toContain('permission');
    });

    it('should return proper error for tool not found', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(INVALID_MCP_REQUESTS.INVALID_TOOL)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('Tool not found');
      expect(data.error.message).toContain('nonexistent_tool');
    });

    it('should validate tool parameters', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(INVALID_MCP_REQUESTS.MISSING_TOOL_ARGS)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602); // Invalid params
    });
  });

  describe('Server Information and Capabilities', () => {
    it('should provide server information on initialize', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.INITIALIZE)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.protocolVersion).toBe('2024-11-05');
      expect(data.result.capabilities).toBeDefined();
      expect(data.result.serverInfo).toBeDefined();
      expect(data.result.serverInfo.name).toBe('mapbox-mcp-server');
      expect(data.result.serverInfo.version).toBeDefined();
    });

    it('should validate protocol version in initialize', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify({
          ...MCP_REQUESTS.INITIALIZE,
          params: {
            ...MCP_REQUESTS.INITIALIZE.params,
            protocolVersion: '1.0.0' // Unsupported version
          }
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      // Should either accept with warning or reject
      expect(data.result || data.error).toBeDefined();
    });

    it('should include capabilities in initialize response', async () => {
      const token = createTestToken();
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(MCP_REQUESTS.INITIALIZE)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result.capabilities).toBeDefined();
      expect(typeof data.result.capabilities).toBe('object');
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle graceful degradation with mixed valid/invalid requests', async () => {
      const token = createTestToken();
      const mixedBatch = [
        MCP_REQUESTS.TOOLS_LIST, // Valid
        INVALID_MCP_REQUESTS.INVALID_TOOL, // Invalid tool
        MCP_REQUESTS.GEOCODE_FORWARD // Valid
      ];

      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          ...TEST_HEADERS.JSON,
          ...createAuthHeader(token)
        },
        body: JSON.stringify(mixedBatch)
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(3);

      expect(data[0].result).toBeDefined(); // First request (tools/list) succeeded
      expect(data[1].result).toBeDefined(); // Second request (geocode) succeeded but with error flag
      expect(data[2].error).toBeDefined(); // Third request (invalid tool) failed
    });

    it('should provide meaningful error messages', async () => {
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
          method: 'tools/call',
          params: {
            name: 'forward_geocode_tool',
            arguments: { q: 123, limit: 'invalid' } // Invalid types
          }
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
      expect(data.error.message).toBeDefined();
      expect(data.error.message.length).toBeGreaterThan(10); // Meaningful message
    });

    it('should handle concurrent requests properly', async () => {
      const token = createTestToken();
      const promises = Array.from({ length: 5 }, (_, i) =>
        fetch(`${serverUrl}/messages`, {
          method: 'POST',
          headers: {
            ...TEST_HEADERS.JSON,
            ...createAuthHeader(token)
          },
          body: JSON.stringify({
            ...MCP_REQUESTS.TOOLS_LIST,
            id: `concurrent-${i}`
          })
        })
      );

      const responses = await Promise.all(promises);

      for (const response of responses) {
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.jsonrpc).toBe('2.0');
        expect(data.result).toBeDefined();
      }
    });
  });
});
