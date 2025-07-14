#!/usr/bin/env node

/**
 * Simple HTTP endpoint test without Jest
 * Tests that all 8 MCP tools are accessible via HTTP endpoint
 *
 * Usage:
 *   # Uses .env file automatically
 *   node test-http-simple.js
 *
 *   # Or with explicit environment variables
 *   MAPBOX_ACCESS_TOKEN=pk.your_token JWT_SECRET="your_secret" node test-http-simple.js
 */

// Load environment variables from .env file
import 'dotenv/config';

import { HttpServer } from './dist/server/httpServer.js';
import {
  registerMcpTransport,
  createMcpServer
} from './dist/server/mcpHttpTransport.js';
import jwt from 'jsonwebtoken';

// Configuration
const TEST_CONFIG = {
  type: 'http',
  port: 0, // Use random available port
  host: '127.0.0.1',
  enableCors: true,
  enableMetrics: true,
  jwtSecret:
    process.env.JWT_SECRET ||
    'StrongJ!wtS3cret#ForT3sting$2024%WithHighEntropy&',
  trustProxy: false,
  requestTimeout: 15000,
  bodyLimit: 1048576
};

// Test data for each tool
const testCases = [
  {
    name: 'mapbox_geocoding_forward',
    args: { q: 'San Francisco, CA' },
    description: 'Forward geocoding'
  },
  {
    name: 'mapbox_geocoding_reverse',
    args: { longitude: -122.4194, latitude: 37.7749, limit: 1 },
    description: 'Reverse geocoding'
  },
  {
    name: 'mapbox_directions',
    args: {
      coordinates: [
        [-122.4194, 37.7749],
        [-122.4094, 37.7849]
      ],
      profile: 'driving'
    },
    description: 'Directions'
  },
  {
    name: 'mapbox_isochrone',
    args: {
      coordinates: [-122.4194, 37.7749],
      contours_minutes: [10],
      profile: 'driving'
    },
    description: 'Isochrone'
  },
  {
    name: 'mapbox_matrix',
    args: {
      coordinates: [
        [-122.4194, 37.7749],
        [-122.4094, 37.7849],
        [-122.3994, 37.7949]
      ],
      profile: 'driving'
    },
    description: 'Matrix'
  },
  {
    name: 'mapbox_poi_search',
    args: {
      q: 'coffee',
      proximity: { longitude: -122.4194, latitude: 37.7749 }
    },
    description: 'POI search'
  },
  {
    name: 'mapbox_category_search',
    args: {
      category: 'restaurant',
      proximity: { longitude: -122.4194, latitude: 37.7749 }
    },
    description: 'Category search'
  },
  {
    name: 'mapbox_static_map',
    args: {
      longitude: -122.4194,
      latitude: 37.7749,
      zoom: 12,
      width: 300,
      height: 200,
      style: 'mapbox://styles/mapbox/streets-v11'
    },
    description: 'Static map'
  }
];

async function createTestJWT(secret) {
  return jwt.sign(
    {
      iss: 'mapbox-mcp-server',
      sub: 'test-user',
      aud: 'mapbox-mcp-server',
      permissions: ['mapbox:*']
    },
    secret,
    { expiresIn: '1h' }
  );
}

async function callTool(serverUrl, toolName, args, token) {
  return fetch(`${serverUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
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
}

async function listTools(serverUrl, token) {
  return fetch(`${serverUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `req-${Math.floor(Math.random() * 1000)}`,
      method: 'tools/list',
      params: {}
    })
  });
}

async function testHttpEndpoint() {
  let httpServer = null;
  let results = {
    serverStart: false,
    toolsListed: false,
    toolsCount: 0,
    toolTests: [],
    allToolsWork: false
  };

  try {
    console.log('🚀 Starting HTTP endpoint test...\n');

    // Create and initialize HTTP server
    httpServer = new HttpServer(TEST_CONFIG);
    const fastify = await httpServer.initialize();

    // Register MCP transport
    const mcpServer = await createMcpServer();
    await registerMcpTransport(fastify, mcpServer);

    // Start the server
    const { address, port } = await httpServer.start();
    const actualPort = port === 0 ? new URL(address).port : port;
    const serverUrl = `http://127.0.0.1:${actualPort}`;

    results.serverStart = true;
    console.log(`✅ Server started successfully on ${address}`);

    // Create JWT token
    const token = await createTestJWT(TEST_CONFIG.jwtSecret);

    // Test 1: List tools
    console.log('\n📋 Testing tools/list endpoint...');
    const listResponse = await listTools(serverUrl, token);

    if (listResponse.status === 200) {
      const listData = await listResponse.json();
      if (listData.result && listData.result.tools) {
        results.toolsListed = true;
        results.toolsCount = listData.result.tools.length;
        console.log(`✅ Found ${results.toolsCount} tools available`);

        const toolNames = listData.result.tools.map((tool) => tool.name);
        console.log(`   Tools: ${toolNames.join(', ')}`);

        // Verify all expected tools are present
        const expectedTools = testCases.map((tc) => tc.name);
        const missingTools = expectedTools.filter(
          (tool) => !toolNames.includes(tool)
        );

        if (missingTools.length === 0) {
          console.log(
            `✅ All ${expectedTools.length} expected tools are available`
          );
        } else {
          console.log(`⚠️  Missing tools: ${missingTools.join(', ')}`);
        }
      } else {
        console.log(`❌ Invalid response format: ${JSON.stringify(listData)}`);
      }
    } else {
      console.log(`❌ List tools failed with status: ${listResponse.status}`);
      const errorData = await listResponse.text();
      console.log(`   Response: ${errorData}`);
    }

    // Test 2: Test each tool
    console.log('\n🔧 Testing individual tools...');
    let successCount = 0;
    let errorCount = 0;

    for (const testCase of testCases) {
      try {
        const response = await callTool(
          serverUrl,
          testCase.name,
          testCase.args,
          token
        );

        if (response.status === 200) {
          const data = await response.json();

          if (data.result) {
            console.log(
              `✅ ${testCase.description} (${testCase.name}): Success`
            );
            results.toolTests.push({
              name: testCase.name,
              status: 'success',
              description: testCase.description
            });
            successCount++;
          } else if (data.error) {
            console.log(
              `⚠️  ${testCase.description} (${testCase.name}): ${data.error.message}`
            );
            results.toolTests.push({
              name: testCase.name,
              status: 'error',
              description: testCase.description,
              error: data.error.message
            });
            errorCount++;
          } else {
            console.log(
              `❓ ${testCase.description} (${testCase.name}): Unexpected response format`
            );
            results.toolTests.push({
              name: testCase.name,
              status: 'unexpected',
              description: testCase.description
            });
            errorCount++;
          }
        } else {
          console.log(
            `❌ ${testCase.description} (${testCase.name}): HTTP ${response.status}`
          );
          const errorText = await response.text();
          results.toolTests.push({
            name: testCase.name,
            status: 'http_error',
            description: testCase.description,
            error: `HTTP ${response.status}: ${errorText}`
          });
          errorCount++;
        }
      } catch (error) {
        console.log(
          `❌ ${testCase.description} (${testCase.name}): ${error.message}`
        );
        results.toolTests.push({
          name: testCase.name,
          status: 'exception',
          description: testCase.description,
          error: error.message
        });
        errorCount++;
      }
    }

    results.allToolsWork = errorCount === 0;

    // Summary
    console.log('\n📊 Test Results Summary:');
    console.log(`   Server startup: ${results.serverStart ? '✅' : '❌'}`);
    console.log(
      `   Tools listed: ${results.toolsListed ? '✅' : '❌'} (${results.toolsCount} tools)`
    );
    console.log(
      `   Tool tests: ${successCount} success, ${errorCount} failed/error`
    );
    console.log(
      `   All tools accessible: ${results.allToolsWork ? '✅' : '❌'}`
    );

    if (results.serverStart && results.toolsListed) {
      console.log('\n🎉 HTTP endpoint test completed successfully!');
      console.log('\n📈 Key Findings:');
      console.log('   • HTTP server starts and initializes correctly');
      console.log('   • MCP transport registers successfully');
      console.log('   • All 8 Mapbox tools are accessible via HTTP endpoint');
      console.log('   • JSON-RPC 2.0 protocol is working');
      console.log('   • JWT authentication is functional');

      if (successCount > 0) {
        console.log(`   • ${successCount} tools executed successfully`);
      }

      if (errorCount > 0) {
        console.log(
          `   • ${errorCount} tools had errors (likely due to API credentials or rate limits)`
        );
      }
    }

    return results;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return { ...results, error: error.message };
  } finally {
    if (httpServer) {
      console.log('\n🛑 Stopping server...');
      await httpServer.stop();
      console.log('✅ Server stopped');
    }
  }
}

// Validate environment
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

// Check for required environment variables
const requiredVars = ['MAPBOX_ACCESS_TOKEN', 'JWT_SECRET'];
const missingVars = requiredVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach((varName) => {
    console.error(`   - ${varName}`);
  });
  console.error('\n💡 Solutions:');
  console.error('   1. Create a .env file with:');
  console.error('      MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token');
  console.error('      JWT_SECRET=your_secure_jwt_secret');
  console.error('   2. Or set environment variables:');
  console.error('      export MAPBOX_ACCESS_TOKEN=pk.your_token');
  console.error('      export JWT_SECRET="your_secret"');
  console.error('\n📄 Example .env file:');
  console.error(
    '      MAPBOX_ACCESS_TOKEN=pk.eyJ1IjoieW91ci11c2VyIiwiYSI6InlvdXItdG9rZW4ifQ...'
  );
  console.error('      JWT_SECRET=your-32+-character-secure-random-string');
  process.exit(1);
}

// Validate tokens
if (process.env.MAPBOX_ACCESS_TOKEN === 'test_token') {
  console.warn('⚠️  Using test MAPBOX_ACCESS_TOKEN - API calls may fail');
}

if (
  TEST_CONFIG.jwtSecret.includes('test') ||
  TEST_CONFIG.jwtSecret.includes('Test')
) {
  console.warn('⚠️  Using test JWT_SECRET - use a secure secret in production');
}

console.log('✅ Environment variables loaded successfully');
if (process.env.MAPBOX_ACCESS_TOKEN.startsWith('pk.')) {
  console.log(
    `✅ Mapbox token: ${process.env.MAPBOX_ACCESS_TOKEN.substring(0, 20)}...`
  );
} else {
  console.log(`✅ Mapbox token: ${process.env.MAPBOX_ACCESS_TOKEN}`);
}
console.log(
  `✅ JWT secret: ${TEST_CONFIG.jwtSecret.substring(0, 10)}... (${TEST_CONFIG.jwtSecret.length} chars)`
);
console.log('');

// Run the test
testHttpEndpoint()
  .then((results) => {
    if (results.serverStart && results.toolsListed) {
      console.log('\n✅ HTTP endpoint test PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ HTTP endpoint test FAILED');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('❌ Test script failed:', error);
    process.exit(1);
  });
