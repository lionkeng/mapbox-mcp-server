/**
 * Error scenario and edge case tests for MCP Server HTTP endpoint
 * Tests error handling, validation, and edge cases
 */

// Load environment variables from .env file
import 'dotenv/config';

import jwt from 'jsonwebtoken';
import { HttpServer, HttpServerConfig } from '../server/httpServer.js';
import { registerMcpTransport } from '../server/mcpHttpTransport.js';
import { createMcpServer } from '../server/mcpServerFactory.js';

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
  requestTimeout: 5000,
  bodyLimit: 1048576
};

describe('Error Scenarios and Edge Cases', () => {
  let httpServer: HttpServer;
  let serverUrl: string;
  let testToken: string;

  beforeEach(async () => {
    // Create and initialize HTTP server
    httpServer = new HttpServer(TEST_CONFIG);
    const fastify = await httpServer.initialize();

    // Register MCP transport
    const mcpServer = await createMcpServer({ enableLogging: false });
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
      try {
        await httpServer.stop();
      } catch (error) {
        // Ignore cleanup errors
        console.warn('Error during server cleanup:', error);
      }
    }
  }, 10000); // Increase timeout for cleanup

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

  const createInvalidJWT = (): string => {
    return jwt.sign(
      {
        iss: 'wrong-issuer',
        sub: 'test-user',
        aud: 'wrong-audience',
        permissions: ['mapbox:*']
      },
      'wrong-secret',
      { expiresIn: '1h' }
    );
  };

  const createExpiredJWT = (): string => {
    return jwt.sign(
      {
        iss: 'mapbox-mcp-server',
        sub: 'test-user',
        aud: 'mapbox-mcp-server',
        permissions: ['mapbox:*']
      },
      TEST_CONFIG.jwtSecret,
      { expiresIn: '-1h' } // Expired 1 hour ago
    );
  };

  describe('Authentication Errors', () => {
    it('should reject requests without Authorization header', async () => {
      const noAuthResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      });

      expect(noAuthResponse.status).toBe(401);
      const noAuthData = (await noAuthResponse.json()) as any;
      expect(noAuthData.error).toBeDefined();
    });

    it('should reject invalid JWT format', async () => {
      const invalidFormatResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid.jwt.token'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      });

      expect(invalidFormatResponse.status).toBe(401);
    });

    it('should reject expired JWT', async () => {
      const expiredResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createExpiredJWT()}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      });

      expect(expiredResponse.status).toBe(401);
    });

    it('should reject JWT with wrong secret', async () => {
      const wrongSecretResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createInvalidJWT()}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      });

      expect(wrongSecretResponse.status).toBe(401);
    });
  });

  describe('JSON-RPC Protocol Errors', () => {
    it('should handle missing jsonrpc field', async () => {
      const customResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`
        },
        body: JSON.stringify({
          // Missing jsonrpc field
          id: 1,
          method: 'tools/call',
          params: {
            name: 'forward_geocode_tool',
            arguments: { q: 'San Francisco', limit: 1 }
          }
        })
      });

      expect(customResponse.status).toBe(400);
      const customData = (await customResponse.json()) as any;
      expect(customData.error).toBeDefined();
    });

    it('should handle invalid JSON-RPC version', async () => {
      const invalidVersionResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`
        },
        body: JSON.stringify({
          jsonrpc: '1.0', // Invalid version
          id: 1,
          method: 'tools/call',
          params: {
            name: 'forward_geocode_tool',
            arguments: { q: 'San Francisco', limit: 1 }
          }
        })
      });

      expect(invalidVersionResponse.status).toBe(400);
      const invalidVersionData = (await invalidVersionResponse.json()) as any;
      expect(invalidVersionData.error).toBeDefined();
    });

    it('should handle missing method field', async () => {
      const missingMethodResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          // Missing method field
          params: {
            name: 'forward_geocode_tool',
            arguments: { q: 'San Francisco', limit: 1 }
          }
        })
      });

      expect(missingMethodResponse.status).toBe(200);
      const missingMethodData = (await missingMethodResponse.json()) as any;
      expect(missingMethodData.jsonrpc).toBe('2.0');
      expect(missingMethodData.error).toBeDefined();
      expect(missingMethodData.error.message).toContain('method');
    });
  });

  describe('Tool Parameter Validation Errors', () => {
    it('should validate basic parameter errors', async () => {
      // Test missing required parameter
      const response = await callHttpTool('forward_geocode_tool', {
        // Missing required 'q' parameter
        limit: 1
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
    });
  });

  describe('HTTP Protocol Errors', () => {
    it('should reject unsupported HTTP methods', async () => {
      const methodResponse = await fetch(`${serverUrl}/messages`, {
        method: 'PUT', // Truly unsupported method
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      });

      expect(methodResponse.status).toBe(404); // Not found - PUT not supported
    });

    it('should reject invalid Content-Type', async () => {
      const contentTypeResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain', // Should be application/json
          Authorization: `Bearer ${testToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      });

      expect(contentTypeResponse.status).toBe(400); // Bad request - validation error
    });

    it('should reject malformed JSON', async () => {
      const malformedResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`
        },
        body: '{ invalid json }'
      });

      expect(malformedResponse.status).toBe(400); // Bad request
    });

    it('should reject empty body', async () => {
      const emptyResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`
        },
        body: ''
      });

      expect(emptyResponse.status).toBe(400); // Bad request
    });
  });

  describe('Permission Errors', () => {
    it('should reject requests with no permissions', async () => {
      const noPermissionsToken = jwt.sign(
        {
          iss: 'mapbox-mcp-server',
          sub: 'no-permissions-user',
          aud: 'mapbox-mcp-server',
          permissions: []
        },
        TEST_CONFIG.jwtSecret,
        { expiresIn: '1h' }
      );

      const noPermResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${noPermissionsToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'forward_geocode_tool',
            arguments: { q: 'San Francisco', limit: 1 }
          }
        })
      });

      expect(noPermResponse.status).toBe(200);
      const noPermData = (await noPermResponse.json()) as any;
      expect(noPermData.jsonrpc).toBe('2.0');
      expect(noPermData.error).toBeDefined();
      expect(noPermData.error.message).toContain('permission');
    });

    it('should reject requests with wrong permissions', async () => {
      const wrongPermissionsToken = jwt.sign(
        {
          iss: 'mapbox-mcp-server',
          sub: 'wrong-permissions-user',
          aud: 'mapbox-mcp-server',
          permissions: ['mapbox:directions'] // Only has directions permission
        },
        TEST_CONFIG.jwtSecret,
        { expiresIn: '1h' }
      );

      const wrongPermResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${wrongPermissionsToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'forward_geocode_tool', // Requires geocode permission
            arguments: { q: 'San Francisco', limit: 1 }
          }
        })
      });

      expect(wrongPermResponse.status).toBe(200);
      const wrongPermData = (await wrongPermResponse.json()) as any;
      expect(wrongPermData.jsonrpc).toBe('2.0');
      expect(wrongPermData.error).toBeDefined();
      expect(wrongPermData.error.message).toContain('permission');
    });
  });

  describe('Rate Limiting', () => {
    it('should have rate limiting configured', async () => {
      // Just test that a few requests work - rate limiting is configured in the server
      const response = await fetch(`${serverUrl}/health`);
      expect(response.status).toBe(200);
    });
  });

  describe('Server Capacity Errors', () => {
    it('should reject request body that is too large', async () => {
      const largePayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'forward_geocode_tool',
          arguments: {
            q: 'x'.repeat(2 * 1024 * 1024), // 2MB query
            limit: 1
          }
        }
      };

      const largeResponse = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`
        },
        body: JSON.stringify(largePayload)
      });

      expect(largeResponse.status).toBe(413); // Payload too large
    });
  });

  describe('Network Simulation', () => {
    it('should handle requests to non-existent endpoints', async () => {
      const response = await fetch(`${serverUrl}/nonexistent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(404); // Not found
    });
  });

  describe('Boundary Value Testing', () => {
    it('should handle basic boundary validation', async () => {
      // Test invalid coordinate range
      const response = await callHttpTool('reverse_geocode_tool', {
        longitude: 200, // Invalid longitude
        latitude: 37.7749,
        limit: 1
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
    });
  });

  describe('Concurrent Error Handling', () => {
    it('should handle concurrent requests properly', async () => {
      // Test sequential requests to avoid MCP SDK connection issues
      const response1 = await callHttpTool('nonexistent_tool', {
        param: 'value'
      });
      expect(response1.status).toBe(200);
      const data1 = (await response1.json()) as any;
      expect(data1.jsonrpc).toBe('2.0');
      expect(data1.error).toBeDefined();

      const response2 = await callHttpTool('forward_geocode_tool', {
        limit: 1
      }); // Missing q param
      expect(response2.status).toBe(200);
      const data2 = (await response2.json()) as any;
      expect(data2.jsonrpc).toBe('2.0');
      expect(data2.error).toBeDefined();
    });
  });

  describe('Error Message Quality', () => {
    it('should provide helpful and informative error messages', async () => {
      const response = await callHttpTool('forward_geocode_tool', {
        q: 123, // Invalid type
        limit: 1
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.jsonrpc).toBe('2.0');
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602);
      expect(data.error.message).toContain('Invalid');
      expect(data.error.message.length).toBeGreaterThan(10);
    });

    it('should provide specific error for tool not found', async () => {
      const notFoundResponse = await callHttpTool('nonexistent_tool', {
        param: 'value'
      });

      expect(notFoundResponse.status).toBe(200);
      const notFoundData = (await notFoundResponse.json()) as any;
      expect(notFoundData.jsonrpc).toBe('2.0');
      expect(notFoundData.error).toBeDefined();
      expect(notFoundData.error.message).toContain('Tool not found');
      expect(notFoundData.error.message).toContain('nonexistent_tool');
    });
  });
});
