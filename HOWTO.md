# How to Run Mapbox MCP Server as Standalone

This guide provides step-by-step instructions for running the Mapbox MCP Server as a standalone application with fastify integration.

## Overview

The Mapbox MCP Server is a **Model Context Protocol (MCP) server** that provides AI agents with access to Mapbox's geospatial APIs. It can run in two modes:

- **Stdio Mode** (default): Direct integration with MCP clients like Claude Desktop
- **HTTP Mode**: Full REST API server with authentication for web integrations

## Prerequisites

- **Node.js 22+**
- **Mapbox Access Token** - Get one from [Mapbox Account Dashboard](https://account.mapbox.com/access-tokens/)
- **JWT Secret** (for HTTP mode) - 32+ character cryptographically secure string

## Installation

1. **Clone and install dependencies:**

   ```bash
   git clone <repository-url>
   cd mapbox-mcp-server
   npm install
   ```

2. **Build the project:**

   ```bash
   npm run build
   ```

3. **Set up environment variables:**

   ```bash
   # Required for all modes
   export MAPBOX_ACCESS_TOKEN="pk.your_mapbox_token_here"

   # Required for HTTP mode only
   export JWT_SECRET="your-32-plus-character-secure-secret-here"
   ```

## Running the Server

### Stdio Mode (Default)

For direct MCP integration with Claude Desktop:

```bash
node dist/index.js
```

### HTTP Mode

For web-based integrations with full REST API:

```bash
node dist/index.js --http
```

Or set environment variable:

```bash
export MCP_TRANSPORT=http
node dist/index.js
```

The HTTP server will start on `http://localhost:8080` by default.

## Configuration

### Environment Variables

| Variable              | Required       | Default   | Description                       |
| --------------------- | -------------- | --------- | --------------------------------- |
| `MAPBOX_ACCESS_TOKEN` | ✅             | -         | Your Mapbox API access token      |
| `JWT_SECRET`          | HTTP mode only | -         | 32+ character secret for JWT auth |
| `MCP_TRANSPORT`       | ❌             | `stdio`   | Transport mode: `stdio` or `http` |
| `PORT`                | ❌             | `8080`    | HTTP server port                  |
| `HOST`                | ❌             | `0.0.0.0` | HTTP server host                  |

### Transport Selection Priority

1. Command line flag: `--http`
2. Environment variable: `MCP_TRANSPORT=http`
3. Default: `stdio`

## Usage Examples

### Claude Desktop Integration (Stdio Mode)

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "mapbox": {
      "command": "node",
      "args": ["/path/to/mapbox-mcp-server/dist/index.js"],
      "env": {
        "MAPBOX_ACCESS_TOKEN": "pk.your_token_here"
      }
    }
  }
}
```

### HTTP API Integration

1. **Start the server:**

   ```bash
   MAPBOX_ACCESS_TOKEN=pk.xxx JWT_SECRET=your-secret node dist/index.js --http
   ```

2. **Get JWT token:**

   ```bash
   curl -X POST http://localhost:8080/auth/token \
     -H "Content-Type: application/json" \
     -d '{"username": "user", "password": "pass"}'
   ```

3. **Make MCP requests:**
   ```bash
   curl -X POST http://localhost:8080/messages \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "tools/list",
       "params": {}
     }'
   ```

## Available Tools

The server provides 8 geospatial tools:

| Tool               | Description                             |
| ------------------ | --------------------------------------- |
| **forwardGeocode** | Convert addresses to coordinates        |
| **reverseGeocode** | Convert coordinates to addresses        |
| **poiSearch**      | Search for points of interest           |
| **categorySearch** | Search locations by category            |
| **directions**     | Get routing and navigation instructions |
| **matrix**         | Calculate travel time/distance matrices |
| **isochrone**      | Generate reachability areas             |
| **staticMapImage** | Create static map images                |

### Example Tool Usage (via HTTP)

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "forwardGeocode",
      "arguments": {
        "query": "1600 Pennsylvania Avenue NW, Washington, DC"
      }
    }
  }'
```

## Health and Monitoring

### Health Check Endpoints (HTTP Mode)

- **Health Check:** `GET /health`
- **Readiness Probe:** `GET /ready`
- **Metrics:** `GET /metrics` (if enabled)

Example:

```bash
curl http://localhost:8080/health
# Response: {"status": "ok", "timestamp": "2024-01-01T00:00:00.000Z"}
```

## Docker Deployment

### Build Docker Image

```bash
docker build -t mapbox-mcp-server .
```

### Run Container (Stdio Mode)

```bash
docker run \
  -e MAPBOX_ACCESS_TOKEN=pk.your_token_here \
  mapbox-mcp-server
```

### Run Container (HTTP Mode)

```bash
docker run \
  -p 8080:8080 \
  -e MAPBOX_ACCESS_TOKEN=pk.your_token_here \
  -e JWT_SECRET=your-secure-secret \
  mapbox-mcp-server --http
```

## Troubleshooting

### Common Issues

**1. "MAPBOX_ACCESS_TOKEN is required"**

- Solution: Set the environment variable with your Mapbox token
- Verify token at: https://account.mapbox.com/access-tokens/

**2. "JWT_SECRET must be at least 32 characters" (HTTP mode)**

- Solution: Generate a secure 32+ character secret:
  ```bash
  openssl rand -base64 32
  ```

**3. "Port 8080 already in use"**

- Solution: Change port with `PORT=3000` environment variable

**4. Type checking errors during development**

- Solution: Run type checker: `npx tsc --noEmit`

**5. Tools not working**

- Check Mapbox token permissions and quota
- Verify API endpoints are accessible
- Check server logs for detailed error messages

### Debug Mode

Enable detailed logging:

```bash
DEBUG=mapbox-mcp:* node dist/index.js
```

### Verify Installation

Test the server is working:

1. **Stdio mode:** Start server and send MCP ping
2. **HTTP mode:** Check health endpoint
   ```bash
   curl http://localhost:8080/health
   ```

## Support

- **Issues:** Report bugs and feature requests on GitHub
- **Documentation:** Check the main README.md for additional details
- **Mapbox API:** Refer to [Mapbox API Documentation](https://docs.mapbox.com/)

---

## Development Guidelines

### Directory Naming Convention

This project follows **kebab-case** naming for directories:

**✅ Correct:**

- `src/tools/forward-geocode-tool/`
- `src/tools/category-search-tool/`
- `src/tools/static-map-image-tool/`

**❌ Incorrect:**

- `src/tools/forwardGeocodeTool/`
- `src/tools/categorySearchTool/`
- `src/tools/staticMapImageTool/`

This convention ensures consistency across the codebase and follows standard practices for multi-word directory names.

---

**Note:** This server provides a secure, production-ready interface to Mapbox's powerful geospatial APIs through the Model Context Protocol, enabling AI agents to perform location-based tasks and analysis.
