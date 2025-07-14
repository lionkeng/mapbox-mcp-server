// Debug script to check what the failing tests actually return
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { HttpServer } from './src/server/httpServer.js';
import {
  registerMcpTransport,
  createMcpServer
} from './src/server/mcpHttpTransport.js';

const TEST_CONFIG = {
  type: 'http',
  port: 0,
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

const testToken = jwt.sign(
  {
    iss: 'mapbox-mcp-server',
    sub: 'test-user',
    aud: 'mapbox-mcp-server',
    permissions: ['mapbox:*']
  },
  TEST_CONFIG.jwtSecret,
  { expiresIn: '1h' }
);

async function debugTest() {
  // Create server
  const httpServer = new HttpServer(TEST_CONFIG);
  const fastify = await httpServer.initialize();
  const mcpServer = await createMcpServer();
  await registerMcpTransport(fastify, mcpServer);
  const { port } = await httpServer.start();
  const serverUrl = `http://127.0.0.1:${port}`;

  // Test 1: Directions with invalid profile
  console.log('\n=== Test 1: Directions with invalid profile ===');
  const response1 = await fetch(`${serverUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${testToken}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'test-1',
      method: 'tools/call',
      params: {
        name: 'mapbox_directions',
        arguments: {
          coordinates: [
            [-122.4194, 37.7749],
            [-122.4094, 37.7849]
          ],
          profile: 'invalid_profile'
        }
      }
    })
  });
  const data1 = await response1.json();
  console.log('Response:', JSON.stringify(data1, null, 2));

  // Test 2: Category search with invalid category
  console.log('\n=== Test 2: Category search with invalid category ===');
  const response2 = await fetch(`${serverUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${testToken}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'test-2',
      method: 'tools/call',
      params: {
        name: 'mapbox_category_search',
        arguments: {
          category: 'invalid_category',
          proximity: { longitude: -122.4194, latitude: 37.7749 },
          limit: 5
        }
      }
    })
  });
  const data2 = await response2.json();
  console.log('Response:', JSON.stringify(data2, null, 2));

  // Test 3: Static map (should succeed)
  console.log('\n=== Test 3: Static map (should succeed) ===');
  const response3 = await fetch(`${serverUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${testToken}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'test-3',
      method: 'tools/call',
      params: {
        name: 'mapbox_static_map',
        arguments: {
          longitude: -122.4194,
          latitude: 37.7749,
          zoom: 12,
          width: 300,
          height: 200,
          style: 'mapbox://styles/mapbox/streets-v11'
        }
      }
    })
  });
  const data3 = await response3.json();
  console.log('Response:', JSON.stringify(data3, null, 2));

  await httpServer.stop();
}

debugTest().catch(console.error);
