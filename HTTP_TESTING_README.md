# MCP Server Testing Guide for Mapbox MCP Server

This document provides a comprehensive guide for testing the Mapbox MCP Server, covering both **MCP protocol level testing** (using the official SDK) and **HTTP endpoint testing** (using custom utilities). This ensures all 8 MCP tools are properly tested through multiple interfaces.

## Overview

The Mapbox MCP Server exposes all its tools via an HTTP endpoint that implements the MCP (Model Context Protocol) over HTTP with JSON-RPC 2.0. This testing infrastructure provides complete coverage for:

- **8 Mapbox Tools**: geocoding (forward/reverse), directions, isochrone, matrix, POI search, category search, static maps
- **MCP Protocol Compliance**: Testing with official `@modelcontextprotocol/sdk` client
- **Authentication**: JWT-based security with permission-based access control
- **Error Handling**: Comprehensive error scenarios and edge cases
- **Performance**: Concurrent requests and rate limiting
- **HTTP Transport**: Direct JSON-RPC 2.0 testing for debugging

## Quick Start

### Method 1: MCP Protocol Level Testing (Recommended for MCP Development)

Test the server using the official MCP SDK client to verify protocol compliance:

```bash
# Option 1: Using npm script (loads .env automatically)
npm run test:client

# Option 2: Run TypeScript directly
npx tsx scripts/client.ts

# Option 3: Set environment variables inline
MAPBOX_ACCESS_TOKEN="your_token" JWT_SECRET="your_secret" npx tsx scripts/client.ts
```

This MCP client test (`scripts/client.ts`) demonstrates:

1. **Authentic MCP Client Connection**: Uses the official `@modelcontextprotocol/sdk` client
2. **JWT Authentication**: Generates and uses proper JWT tokens
3. **Protocol Compliance**: Tests actual MCP protocol methods (`listTools`, `callTool`)
4. **Real Tool Calls**: Executes geocoding tools with real Mapbox API calls
5. **Error Handling**: Shows how MCP clients handle validation and errors

#### What the MCP Client Test Does:

```typescript
// Connects using official MCP SDK
const client = new Client({ name: 'mcp-http-client', version: '1.0.0' });
await client.connect(transport);

// Lists all available tools
const toolsResult = await client.listTools();

// Calls tools using MCP protocol
const geocodeResult = await client.callTool({
  name: 'forward_geocode_tool',
  arguments: { q: '1600 Pennsylvania Avenue, Washington DC' }
});
```

This is the **most accurate way** to test your MCP server as it uses the same SDK that real MCP clients (like Claude Desktop) would use.

### Method 2: Simple Test Script (HTTP Level Testing)

Test the HTTP endpoint directly using custom HTTP utilities:

```bash
# Option 1: Using npm script (loads .env automatically)
npm run test:http

# Option 2: Set environment variables inline
MAPBOX_ACCESS_TOKEN="your_mapbox_token_here" JWT_SECRET="your_jwt_secret_here" npm run test:http

# Option 3: Export environment variables then run
export MAPBOX_ACCESS_TOKEN="your_mapbox_token_here"
export JWT_SECRET="your_jwt_secret_here"
npm run test:http

# Option 4: Run script directly
node scripts/test-http-endpoint.js
```

**Note**: Both scripts automatically load environment variables from a `.env` file in the project root if it exists.

### Available Scripts

The following npm scripts are available for testing:

```bash
npm run test:client        # Run MCP SDK client test (recommended)
npm run test:http          # Run HTTP endpoint test script
npm run test              # Run full Jest test suite
```

The HTTP test script will:

1. Start an HTTP server
2. Test MCP initialization
3. List all available tools
4. Test each tool with sample data
5. Test error handling
6. Clean up and stop the server

### Method 3: Comprehensive Test Suite

For more thorough testing, use the complete test suite:

```bash
# Install dependencies
npm install

# Run comprehensive integration tests
npm test src/__tests__/httpEndpointIntegration.test.ts

# Run end-to-end workflow tests
npm test src/__tests__/endToEndWorkflows.test.ts

# Run error scenario tests
npm test src/__tests__/errorScenarios.test.ts
```

## Test Files

### 1. `src/__tests__/httpEndpointIntegration.test.ts`

Comprehensive integration tests for all 8 MCP tools:

- Tests each tool with valid parameters
- Tests each tool with invalid parameters
- Tests authentication and permissions
- Tests concurrent requests
- Tests rate limiting

### 2. `src/__tests__/endToEndWorkflows.test.ts`

End-to-end workflow scenarios:

- Complete MCP client workflow (initialize → list → call)
- Travel planning workflow (geocode → directions → isochrone → map)
- Location analysis workflow (reverse geocode → POI → category search)
- Multi-point logistics workflow (matrix → directions)
- Permission-based workflows
- Performance testing

### 3. `src/__tests__/errorScenarios.test.ts`

Comprehensive error and edge case testing:

- Authentication errors (missing/invalid/expired tokens)
- JSON-RPC protocol errors
- Tool parameter validation
- HTTP protocol errors
- Permission errors
- Rate limiting errors
- Boundary value testing

## MCP Client Testing Details

The `scripts/client.ts` file provides a complete example of how to connect to your MCP server using the official SDK:

### Key Features:

- **StreamableHTTPClientTransport**: Uses the official MCP HTTP transport
- **JWT Token Generation**: Creates properly formatted authentication tokens
- **Error Handling**: Demonstrates graceful handling of MCP protocol errors
- **Real API Calls**: Makes actual calls to Mapbox services

### Example Output:

```
Available tools: [ 'matrix_tool', 'reverse_geocode_tool', 'forward_geocode_tool', 'isochrone_tool', 'poi_search_tool', 'category_search_tool', 'static_map_image_tool', 'directions_tool' ]

Calling forward geocoding tool...
Forward geocoding result: {
  "content": [
    {
      "type": "text",
      "text": "Address: 1600 Pennsylvania Avenue Northwest, Washington, District of Columbia 20500, United States\nCoordinates: -77.036133, 38.895111"
    }
  ]
}

Calling reverse geocoding tool...
Reverse geocoding result: {
  "content": [
    {
      "type": "text",
      "text": "Address: 1600 Pennsylvania Avenue Northwest, Washington, District of Columbia 20500, United States"
    }
  ]
}
```

### Prerequisites for MCP Client Testing:

1. **Start your MCP server** (in another terminal):

   ```bash
   npm run dev  # Starts server on http://localhost:8080/mcp
   ```

2. **Run the MCP client test**:
   ```bash
   npm run test:client
   ```

## Available Tools

The HTTP endpoint provides access to all 8 Mapbox tools:

| Tool                  | Tool Name               | Description                                              |
| --------------------- | ----------------------- | -------------------------------------------------------- |
| **Forward Geocoding** | `forward_geocode_tool`  | Convert addresses to coordinates                         |
| **Reverse Geocoding** | `reverse_geocode_tool`  | Convert coordinates to addresses                         |
| **Directions**        | `directions_tool`       | Get routing directions between points                    |
| **Isochrone**         | `isochrone_tool`        | Generate travel time polygons                            |
| **Matrix**            | `matrix_tool`           | Calculate travel times/distances between multiple points |
| **POI Search**        | `poi_search_tool`       | Search for points of interest                            |
| **Category Search**   | `category_search_tool`  | Search by business category                              |
| **Static Map Images** | `static_map_image_tool` | Generate static map images                               |

## Test Utilities

### HTTP Test Helpers (`src/utils/requestUtils.testHelpers.ts`)

The test utilities provide convenient functions for HTTP endpoint testing:

```javascript
import {
  callHttpTool,
  listHttpTools,
  initializeHttpMcp,
  createTestJWT,
  testData
} from '../utils/requestUtils.testHelpers.js';

// Create test configuration
const httpTestConfig = {
  serverUrl: 'http://localhost:3000',
  jwtSecret: 'your-secret',
  permissions: ['mapbox:*']
};

// Test a tool
const response = await callHttpTool(httpTestConfig, 'forward_geocode_tool', {
  q: 'San Francisco, CA',
  limit: 1
});

// Use predefined test data
const response = await callHttpTool(
  httpTestConfig,
  'directions_tool',
  testData.directions.valid
);
```

### Test Data Generators

Pre-defined test data for all tools:

```javascript
import { testData } from '../utils/requestUtils.testHelpers.js';

// Valid test data for each tool
testData.geocoding.forward.valid; // Forward geocoding
testData.geocoding.reverse.valid; // Reverse geocoding
testData.directions.valid; // Directions
testData.isochrone.valid; // Isochrone
testData.matrix.valid; // Matrix
testData.poi.valid; // POI search
testData.category.valid; // Category search
testData.staticMap.valid; // Static map

// Invalid test data for error testing
testData.geocoding.forward.invalid;
testData.directions.invalid;
// ... etc
```

### Mock Response Generators

For unit testing without actual API calls:

```javascript
import {
  createMockGeocodingResponse,
  createMockDirectionsResponse,
  createMockIsochroneResponse,
  createMockMatrixResponse,
  createMockPoiResponse,
  createMockStaticMapResponse,
  createMockErrorResponse
} from '../utils/requestUtils.testHelpers.js';
```

## Authentication

The HTTP endpoint uses JWT-based authentication with permission scopes:

```javascript
// Create test JWT with specific permissions
const token = createTestJWT({
  serverUrl: 'http://localhost:3000',
  jwtSecret: 'your-secret',
  permissions: ['mapbox:geocode', 'mapbox:directions'] // Limited permissions
});

// Use token in requests
const response = await callHttpTool(httpTestConfig, 'tool_name', args, token);
```

### Permission Scopes

- `mapbox:*` - Full access to all tools
- `mapbox:geocode` - Forward and reverse geocoding
- `mapbox:directions` - Directions API
- `mapbox:isochrone` - Isochrone API
- `mapbox:matrix` - Matrix API
- `mapbox:poi` - POI and category search
- `mapbox:static-images` - Static map images

## Example Usage

### Basic Tool Call

```javascript
import { HttpServer } from './src/server/httpServer.js';
import { registerMcpTransport } from './src/server/mcpHttpTransport.js';
import { createMcpServer } from './src/server/mcpServerFactory.js';
import { callHttpTool } from './src/utils/requestUtils.testHelpers.js';

// Start server
const httpServer = new HttpServer(config);
const { port } = await httpServer.start();

// Register MCP transport
const mcpServer = await createMcpServer();
const fastify = httpServer.getFastify();
await registerMcpTransport(fastify, mcpServer);

// Test configuration
const httpTestConfig = {
  serverUrl: `http://127.0.0.1:${port}`,
  jwtSecret: 'your-secret',
  permissions: ['mapbox:*']
};

// Call a tool
const response = await callHttpTool(httpTestConfig, 'forward_geocode_tool', {
  q: 'San Francisco, CA',
  limit: 1
});

const data = await response.json();
console.log(data.result.content[0].text); // Geocoding results

// Cleanup
await httpServer.stop();
```

### Error Testing

```javascript
// Test invalid parameters
const errorResponse = await callHttpTool(
  httpTestConfig,
  'forward_geocode_tool',
  {
    q: 123, // Should be string
    limit: 'invalid' // Should be number
  }
);

const errorData = await errorResponse.json();
console.log(errorData.error.code); // -32602 (Invalid params)
console.log(errorData.error.message); // Descriptive error message
```

### Concurrent Testing

```javascript
// Test multiple tools concurrently
const promises = [
  callHttpTool(config, 'forward_geocode_tool', { q: 'NYC', limit: 1 }),
  callHttpTool(config, 'poi_search_tool', {
    q: 'coffee',
    proximity: { longitude: -74, latitude: 40 },
    limit: 3
  }),
  callHttpTool(config, 'directions_tool', {
    coordinates: [
      [-74, 40],
      [-73, 41]
    ],
    routing_profile: 'driving'
  })
];

const responses = await Promise.all(promises);
// All responses will be properly formatted JSON-RPC responses
```

## Testing Best Practices

1. **Always test with real Mapbox API keys** for integration tests
2. **Use mock responses** for unit tests to avoid API rate limits
3. **Test both success and error scenarios** for each tool
4. **Test permission-based access control** with different JWT tokens
5. **Test concurrent requests** to ensure thread safety
6. **Test edge cases and boundary values** (coordinates at poles, maximum zoom levels, etc.)
7. **Clean up resources** (stop servers) in test teardown

## Environment Variables

Required for running tests:

```bash
# Required
MAPBOX_ACCESS_TOKEN=pk.your_mapbox_public_token

# Optional (will use defaults if not provided)
JWT_SECRET=your-jwt-secret-at-least-32-characters-long
LOG_LEVEL=info
```

### Setting Up Environment Variables:

1. **Create a `.env` file** in the project root:

   ```bash
   # Generate a secure JWT secret
   openssl rand -base64 32

   # Add to .env file
   echo "MAPBOX_ACCESS_TOKEN=pk.your_actual_token_here" >> .env
   echo "JWT_SECRET=your_generated_secret_here" >> .env
   ```

2. **Get a Mapbox access token** from https://account.mapbox.com/access-tokens/

3. **Verify setup**:

   ```bash
   # Test MCP client connection
   npm run test:client

   # Test HTTP endpoint
   npm run test:http
   ```

## Troubleshooting

### Common Issues

1. **"Tool not found" errors**: Ensure the MCP server is properly initialized and tools are registered
2. **Authentication failures**: Check JWT secret and token format
3. **Permission errors**: Verify JWT contains required permissions for the tool
4. **Rate limiting**: Add delays between rapid requests or use different API keys
5. **Network timeouts**: Increase request timeout in server configuration
6. **MCP Client connection issues**:
   - Ensure server is running on `http://localhost:8080/mcp`
   - Check that `npm run dev` is running in another terminal
   - Verify JWT_SECRET is set and matches between client and server
7. **Schema validation errors**: These are normal for `listTools()` due to Zod schema conversion - the individual `callTool()` operations should work fine

### Debug Mode

Enable debug logging:

```bash
# For MCP client testing
LOG_LEVEL=debug npm run test:client

# For HTTP endpoint testing
LOG_LEVEL=debug npm run test:http

# For server development
LOG_LEVEL=debug npm run dev
```

## Integration with CI/CD

The test suite can be integrated into CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Test HTTP Endpoint
  env:
    MAPBOX_ACCESS_TOKEN: ${{ secrets.MAPBOX_ACCESS_TOKEN }}
    JWT_SECRET: ${{ secrets.JWT_SECRET }}
  run: |
    npm test src/__tests__/httpEndpointIntegration.test.ts
```

## Performance Considerations

- Tests make real API calls and count against Mapbox quotas
- Use rate limiting in CI environments
- Consider using Mapbox test tokens for automated testing
- Monitor API usage to avoid unexpected charges

## Contributing

When adding new tools or modifying existing ones:

1. Add test cases to `httpEndpointIntegration.test.ts`
2. Add realistic test data to `requestUtils.testHelpers.ts`
3. Add error scenarios to `errorScenarios.test.ts`
4. Update this documentation

This testing infrastructure ensures that all MCP tools are properly accessible and functional through the HTTP endpoint, providing confidence in the server's reliability and compliance with the MCP protocol.
