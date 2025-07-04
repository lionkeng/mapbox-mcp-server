# HTTP Endpoint Testing for Mapbox MCP Server

This document provides a comprehensive guide for testing the HTTP endpoint of the Mapbox MCP Server, ensuring all 8 MCP tools are properly tested through the streamable HTTP interface.

## Overview

The Mapbox MCP Server exposes all its tools via an HTTP endpoint that implements the MCP (Model Context Protocol) over HTTP with JSON-RPC 2.0. This testing infrastructure provides complete coverage for:

- **8 Mapbox Tools**: geocoding (forward/reverse), directions, isochrone, matrix, POI search, category search, static maps
- **Authentication**: JWT-based security with permission-based access control
- **Error Handling**: Comprehensive error scenarios and edge cases
- **Performance**: Concurrent requests and rate limiting
- **Protocol Compliance**: Full MCP and JSON-RPC 2.0 compliance

## Quick Start

### Method 1: Simple Test Script (Recommended)

The easiest way to test the HTTP endpoint is using the provided test script:

```bash
# Set environment variables
export MAPBOX_ACCESS_TOKEN="your_mapbox_token_here"
export JWT_SECRET="your_jwt_secret_here"

# Run the test script
node test-http-endpoint.js
```

This script will:

1. Start an HTTP server
2. Test MCP initialization
3. List all available tools
4. Test each tool with sample data
5. Test error handling
6. Clean up and stop the server

### Method 2: Comprehensive Test Suite

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

## Available Tools

The HTTP endpoint provides access to all 8 Mapbox tools:

| Tool                       | Endpoint          | Description                                              |
| -------------------------- | ----------------- | -------------------------------------------------------- |
| `mapbox_geocoding_forward` | Forward geocoding | Convert addresses to coordinates                         |
| `mapbox_geocoding_reverse` | Reverse geocoding | Convert coordinates to addresses                         |
| `mapbox_directions`        | Directions API    | Get routing directions between points                    |
| `mapbox_isochrone`         | Isochrone API     | Generate travel time polygons                            |
| `mapbox_matrix`            | Matrix API        | Calculate travel times/distances between multiple points |
| `mapbox_poi_search`        | POI Search        | Search for points of interest                            |
| `mapbox_category_search`   | Category Search   | Search by business category                              |
| `mapbox_static_map`        | Static Images     | Generate static map images                               |

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
const response = await callHttpTool(
  httpTestConfig,
  'mapbox_geocoding_forward',
  {
    query: 'San Francisco, CA',
    limit: 1
  }
);

// Use predefined test data
const response = await callHttpTool(
  httpTestConfig,
  'mapbox_directions',
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
import {
  registerMcpTransport,
  createMcpServer
} from './src/server/mcpHttpTransport.js';
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
const response = await callHttpTool(
  httpTestConfig,
  'mapbox_geocoding_forward',
  {
    query: 'San Francisco, CA',
    limit: 1
  }
);

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
  'mapbox_geocoding_forward',
  {
    query: 123, // Should be string
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
  callHttpTool(config, 'mapbox_geocoding_forward', { query: 'NYC', limit: 1 }),
  callHttpTool(config, 'mapbox_poi_search', {
    query: 'coffee',
    proximity: [-74, 40],
    limit: 3
  }),
  callHttpTool(config, 'mapbox_directions', {
    coordinates: [
      [-74, 40],
      [-73, 41]
    ],
    profile: 'driving'
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

## Troubleshooting

### Common Issues

1. **"Tool not found" errors**: Ensure the MCP server is properly initialized and tools are registered
2. **Authentication failures**: Check JWT secret and token format
3. **Permission errors**: Verify JWT contains required permissions for the tool
4. **Rate limiting**: Add delays between rapid requests or use different API keys
5. **Network timeouts**: Increase request timeout in server configuration

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug node test-http-endpoint.js
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
