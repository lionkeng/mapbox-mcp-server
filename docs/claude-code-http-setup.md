# Claude Code HTTP Transport Setup

This guide shows how to configure the Mapbox MCP Server with HTTP transport for use with Claude Code.

## Prerequisites

- Node.js installed
- Mapbox access token ([get one here](https://account.mapbox.com/))
- Claude Code CLI installed

## Configuration Steps

### 1. Set Environment Variables

```bash
# Required environment variables
export MAPBOX_ACCESS_TOKEN="pk.your_mapbox_token_here"
export JWT_SECRET="your-secure-32-character-secret"

# Generate a secure JWT secret (if needed)
openssl rand -base64 32
```

### 2. Start the Server with HTTP Transport

```bash
# Clone and build the server
git clone https://github.com/mapbox/mapbox-mcp-server.git
cd mapbox-mcp-server
npm install
npm run build

# Start with HTTP transport
node dist/index.js --http --port 8080

# Or with additional options
node dist/index.js --http --port 8080 --metrics --cors
```

### 3. Generate a JWT Token

Use the provided script:

```bash
node scripts/generate-jwt.js
```

### 4. Add to Claude Code

```bash
# Add the MCP server with HTTP transport
claude mcp add --transport http mapbox-server http://localhost:8080/messages \
  --header "Authorization: Bearer YOUR_JWT_TOKEN_HERE"
```

Replace `YOUR_JWT_TOKEN_HERE` with the token generated in step 3.

## Available Permissions

You can create tokens with specific permissions instead of full access:

- `mapbox:*` - Full access to all tools
- `mapbox:geocode` - Forward and reverse geocoding
- `mapbox:directions` - Routing and navigation
- `mapbox:isochrone` - Isochrone calculations
- `mapbox:matrix` - Travel time/distance matrices
- `mapbox:poi` - POI and category search
- `mapbox:static-images` - Static map generation

Example with limited permissions:

```javascript
const token = jwt.sign(
  {
    iss: 'mapbox-mcp-server',
    sub: 'claude-code-user',
    aud: 'mapbox-mcp-server',
    permissions: ['mapbox:geocode', 'mapbox:directions'] // Only geocoding and directions
  },
  process.env.JWT_SECRET,
  { expiresIn: '24h' }
);
```

## Testing the Connection

Once added, you can test the connection in Claude Code:

```
What coffee shops are near Times Square?
```

This should use the Mapbox geocoding and POI search tools through the HTTP transport.

## Troubleshooting

### JWT Secret Issues

If you get authentication errors, ensure:

- JWT_SECRET is at least 32 characters long
- The same JWT_SECRET is used for both server and token generation
- The token hasn't expired

### Connection Issues

1. Check server is running:

   ```bash
   curl http://localhost:8080/health
   ```

2. Test with a direct API call:
   ```bash
   curl -X POST http://localhost:8080/messages \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "tools/list",
       "params": {}
     }'
   ```

### Port Conflicts

If port 8080 is in use, change it:

```bash
node dist/index.js --http --port 3000
claude mcp add --transport http mapbox-server http://localhost:3000/messages \
  --header "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Security Considerations

- Keep your JWT_SECRET secure and never commit it to version control
- Use environment variables or a secrets manager for production
- Regularly rotate tokens and secrets
- Consider using shorter token expiration times for enhanced security

## Advanced Configuration

### Using Environment Variables Only

You can configure everything via environment variables:

```bash
export MCP_TRANSPORT=http
export PORT=8080
export HOST=0.0.0.0
export MAPBOX_ACCESS_TOKEN="pk.your_token"
export JWT_SECRET="your-secret"

node dist/index.js
```

### Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build

ENV MCP_TRANSPORT=http
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
```

Run with:

```bash
docker run -p 8080:8080 \
  -e MAPBOX_ACCESS_TOKEN="pk.your_token" \
  -e JWT_SECRET="your-secret" \
  mapbox-mcp-server
```

## Next Steps

- Review the [main documentation](../README.md) for available tools
- Check the [API examples](../examples/) for usage patterns
- Set up monitoring with the `/metrics` endpoint (if enabled)
