#!/usr/bin/env node

/**
 * Simple test script to demonstrate HTTP endpoint testing
 *
 * Usage:
 *   MAPBOX_ACCESS_TOKEN=your_token JWT_SECRET=your_secret node scripts/test-http-endpoint.js
 *   OR
 *   npm run test:http (requires .env file with MAPBOX_ACCESS_TOKEN and JWT_SECRET)
 *
 * This script demonstrates how to test all MCP Server tools via the HTTP endpoint.
 */

// Load environment variables from .env file before importing other modules
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
config({ path: path.join(__dirname, '..', '.env') });

import { HttpServer } from '../dist/server/httpServer.js';
import { registerMcpTransport } from '../dist/server/mcpHttpTransport.js';
import { createMcpServer } from '../dist/server/mcpServerFactory.js';
import {
  callHttpTool,
  listHttpTools,
  initializeHttpMcp
} from '../dist/utils/requestUtils.testHelpers.js';

// Configuration
const TEST_CONFIG = {
  type: 'http',
  port: 0, // Use random available port
  host: '127.0.0.1',
  enableCors: true,
  enableMetrics: true,
  jwtSecret:
    process.env.JWT_SECRET ||
    'test-secret-key-at-least-32-characters-long-for-testing',
  trustProxy: false,
  requestTimeout: 15000,
  bodyLimit: 1048576
};

async function testHttpEndpoint() {
  let httpServer = null;

  try {
    console.log('🚀 Starting HTTP server for testing...');

    // Create and initialize HTTP server
    httpServer = new HttpServer(TEST_CONFIG);
    const fastify = await httpServer.initialize();

    // Register MCP transport
    const mcpServer = await createMcpServer();
    await registerMcpTransport(fastify, mcpServer);

    // Start the server
    const { address, port } = await httpServer.start();

    // Extract actual port from the address if port is 0 (random port)
    const actualPort = port === 0 ? new URL(address).port : port;

    const httpTestConfig = {
      serverUrl: `http://127.0.0.1:${actualPort}`,
      jwtSecret: TEST_CONFIG.jwtSecret,
      permissions: ['mapbox:*']
    };

    console.log(`✅ Server started on ${address}`);

    console.log('🔗 MCP transport registered');

    // Test 1: Initialize MCP connection
    console.log('\n📋 Test 1: Initialize MCP connection');
    const initResponse = await initializeHttpMcp(httpTestConfig);
    if (initResponse.status === 200) {
      const initData = await initResponse.json();
      console.log(
        `✅ Initialization successful: ${initData.result.serverInfo.name}`
      );
    } else {
      console.log(`❌ Initialization failed: ${initResponse.status}`);
    }

    // Test 2: List available tools
    console.log('\n📋 Test 2: List available tools');
    const listResponse = await listHttpTools(httpTestConfig);
    if (listResponse.status === 200) {
      const listData = await listResponse.json();
      const toolNames = listData.result.tools.map((tool) => tool.name);
      console.log(
        `✅ Found ${toolNames.length} tools: ${toolNames.join(', ')}`
      );
    } else {
      console.log(`❌ Tool listing failed: ${listResponse.status}`);
    }

    // Test 3: Test each tool with sample data
    console.log('\n📋 Test 3: Test tools with sample data');

    const toolTests = [
      {
        name: 'forward_geocode_tool',
        args: { q: 'San Francisco, CA', limit: 1 },
        description: 'Forward geocoding'
      },
      {
        name: 'reverse_geocode_tool',
        args: { longitude: -122.4194, latitude: 37.7749, limit: 1 },
        description: 'Reverse geocoding'
      },
      {
        name: 'directions_tool',
        args: {
          coordinates: [
            [-122.4194, 37.7749],
            [-122.4094, 37.7849]
          ],
          routing_profile: 'driving'
        },
        description: 'Directions'
      },
      {
        name: 'isochrone_tool',
        args: {
          profile: 'mapbox/driving',
          coordinates: { longitude: -122.4194, latitude: 37.7749 },
          contours_minutes: [10],
          generalize: 0
        },
        description: 'Isochrone'
      },
      {
        name: 'matrix_tool',
        args: {
          coordinates: [
            { longitude: -122.4194, latitude: 37.7749 },
            { longitude: -122.4094, latitude: 37.7849 },
            { longitude: -122.3994, latitude: 37.7949 }
          ],
          profile: 'driving'
        },
        description: 'Matrix'
      },
      {
        name: 'poi_search_tool',
        args: {
          q: 'coffee',
          proximity: { longitude: -122.4194, latitude: 37.7749 },
          limit: 3
        },
        description: 'POI search'
      },
      {
        name: 'category_search_tool',
        args: {
          category: 'restaurant',
          proximity: { longitude: -122.4194, latitude: 37.7749 },
          limit: 3
        },
        description: 'Category search'
      },
      {
        name: 'static_map_image_tool',
        args: {
          center: { longitude: -122.4194, latitude: 37.7749 },
          zoom: 12,
          size: { width: 300, height: 200 },
          style: 'mapbox/streets-v12'
        },
        description: 'Static map'
      }
    ];

    for (const test of toolTests) {
      try {
        const response = await callHttpTool(
          httpTestConfig,
          test.name,
          test.args
        );
        if (response.status === 200) {
          const data = await response.json();
          if (data.result) {
            console.log(`✅ ${test.description} (${test.name}): Success`);
          } else if (data.error) {
            console.log(
              `⚠️  ${test.description} (${test.name}): ${data.error.message}`
            );
          }
        } else {
          console.log(
            `❌ ${test.description} (${test.name}): HTTP ${response.status}`
          );
        }
      } catch (error) {
        console.log(`❌ ${test.description} (${test.name}): ${error.message}`);
      }
    }

    // Test 4: Test error handling
    console.log('\n📋 Test 4: Test error handling');

    try {
      const errorResponse = await callHttpTool(
        httpTestConfig,
        'nonexistent_tool',
        {}
      );
      if (errorResponse.status === 200) {
        const errorData = await errorResponse.json();
        if (errorData.error) {
          console.log(
            `✅ Error handling: Correctly returned error for nonexistent tool`
          );
        }
      }
    } catch (error) {
      console.log(`❌ Error handling test failed: ${error.message}`);
    }

    // Test 5: Test invalid parameters
    console.log('\n📋 Test 5: Test invalid parameters');

    try {
      const invalidResponse = await callHttpTool(
        httpTestConfig,
        'forward_geocode_tool',
        {
          q: 123, // Should be string
          limit: 1
        }
      );

      if (invalidResponse.status === 200) {
        const invalidData = await invalidResponse.json();
        if (invalidData.error) {
          console.log(
            `✅ Parameter validation: Correctly rejected invalid parameters`
          );
        }
      }
    } catch (error) {
      console.log(`❌ Parameter validation test failed: ${error.message}`);
    }

    console.log('\n🎉 All tests completed!');
    console.log('\n📚 Usage Summary:');
    console.log(
      'This demonstrates that all 8 MCP Server tools are accessible via the HTTP endpoint.'
    );
    console.log('The HTTP endpoint provides:');
    console.log('- Complete MCP protocol support');
    console.log('- JWT-based authentication');
    console.log('- JSON-RPC 2.0 messaging');
    console.log('- Comprehensive error handling');
    console.log('- Input validation for all tools');
    console.log(
      '- Support for all Mapbox APIs (geocoding, directions, isochrone, matrix, POI, static maps)'
    );
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    if (httpServer) {
      console.log('\n🛑 Stopping server...');
      await httpServer.stop();
      console.log('✅ Server stopped');
    }
  }
}

// Check for required environment variables
if (!process.env.MAPBOX_ACCESS_TOKEN) {
  console.error('❌ MAPBOX_ACCESS_TOKEN environment variable is required');
  console.log(
    'Usage: MAPBOX_ACCESS_TOKEN=your_token JWT_SECRET=your_secret node scripts/test-http-endpoint.js'
  );
  process.exit(1);
}

// Run the test
testHttpEndpoint().catch((error) => {
  console.error('❌ Test script failed:', error);
  process.exit(1);
});
