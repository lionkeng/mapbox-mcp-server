# Mapbox MCP Server - Permission System Documentation

## Overview

The Mapbox MCP Server implements a JWT-based permission system that controls access to Mapbox API tools. This system provides fine-grained authorization for different categories of Mapbox services.

## Permission Categories

The server defines the following permission categories:

### Core Permissions

| Permission             | Description                   | Tools                                              |
| ---------------------- | ----------------------------- | -------------------------------------------------- |
| `mapbox:geocode`       | Forward and reverse geocoding | `MapboxGeocodingForward`, `MapboxGeocodingReverse` |
| `mapbox:directions`    | Routing and navigation        | `MapboxDirections`                                 |
| `mapbox:isochrone`     | Isochrone calculations        | `MapboxIsochrone`                                  |
| `mapbox:matrix`        | Travel time/distance matrices | `MapboxMatrix`                                     |
| `mapbox:poi`           | Point of interest search      | `MapboxPoiSearch`, `MapboxCategorySearch`          |
| `mapbox:static-images` | Static map image generation   | `MapboxStaticMap`                                  |

### Special Permissions

| Permission | Description                                      |
| ---------- | ------------------------------------------------ |
| `mapbox:*` | Wildcard permission granting access to all tools |

## JWT Token Structure

JWT tokens must include a `permissions` array in the payload. The complete token structure is:

```json
{
  "iss": "mapbox-mcp-server",
  "sub": "user-id",
  "aud": "mapbox-mcp-server",
  "exp": 1234567890,
  "iat": 1234567890,
  "permissions": ["mapbox:geocode", "mapbox:directions"]
}
```

### Required Fields

- `iss` (issuer): Must be `"mapbox-mcp-server"`
- `sub` (subject): User identifier
- `aud` (audience): Must be `"mapbox-mcp-server"`
- `exp` (expiration): Unix timestamp for token expiration
- `iat` (issued at): Unix timestamp when token was created
- `permissions` (optional): Array of permission strings

## Creating JWT Tokens

### Step 1: Set up your JWT secret

Ensure your `JWT_SECRET` environment variable is set to a secure string (minimum 32 characters).

### Step 2: Create the payload

```javascript
const payload = {
  iss: 'mapbox-mcp-server',
  sub: 'user123',
  aud: 'mapbox-mcp-server',
  exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour from now
  iat: Math.floor(Date.now() / 1000),
  permissions: ['mapbox:geocode', 'mapbox:directions']
};
```

### Step 3: Sign the token

```javascript
const jwt = require('jsonwebtoken');
const token = jwt.sign(payload, process.env.JWT_SECRET);
```

## Common Permission Combinations

### Basic User

```json
{
  "permissions": ["mapbox:geocode"]
}
```

### Navigation App

```json
{
  "permissions": ["mapbox:geocode", "mapbox:directions", "mapbox:matrix"]
}
```

### Analytics Dashboard

```json
{
  "permissions": ["mapbox:isochrone", "mapbox:matrix", "mapbox:static-images"]
}
```

### Administrator

```json
{
  "permissions": ["mapbox:*"]
}
```

## Usage Examples

### HTTP Transport

```bash
# Create a token with geocoding permissions
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "MapboxGeocodingForward",
    "arguments": {
      "address": "1600 Pennsylvania Avenue NW, Washington, DC"
    }
  }'
```

### Stdio Transport

For stdio transport, permissions are not enforced as it's typically used in trusted environments.

## Permission Validation

The server validates permissions at two levels:

1. **Method-level**: MCP protocol methods like `resources/read` require `mapbox:resources` permission
2. **Tool-level**: Each tool requires specific permissions as defined in the mapping above

### Permission Checking Logic

- **Exact match**: User must have the exact permission required by the tool
- **Wildcard**: `mapbox:*` grants access to all tools
- **Multiple permissions**: User can have multiple permissions in their token

## Error Handling

### Common Permission Errors

#### Insufficient Permissions

```json
{
  "error": "Insufficient permissions. Required: mapbox:geocode"
}
```

#### Invalid Token

```json
{
  "error": "Invalid or expired token"
}
```

#### Unknown Tool

```json
{
  "error": "No permissions defined for tool: unknown_tool"
}
```

## Security Best Practices

1. **Use strong JWT secrets**: Minimum 32 characters with high entropy
2. **Set appropriate expiration times**: Default is 1 hour
3. **Principle of least privilege**: Only grant necessary permissions
4. **Rotate JWT secrets regularly**: Especially in production environments
5. **Validate token issuer and audience**: Prevents token reuse attacks

## Environment Configuration

### Required Environment Variables

```bash
# Required for all transports
MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token_here

# Required for HTTP transport only
JWT_SECRET=your_32_character_minimum_secret_here
```

### Optional Configuration

```bash
# Token expiration (default: 3600 seconds = 1 hour)
JWT_EXPIRATION=3600

# Enable debug logging
LOG_LEVEL=debug
```

## Troubleshooting

### Permission Denied Errors

1. **Check token validity**: Ensure token is not expired
2. **Verify permissions**: Make sure the required permission is in the token
3. **Check tool names**: Ensure you're using the correct tool name
4. **Validate JWT secret**: Ensure the secret matches between token creation and validation

### Token Creation Issues

1. **Invalid JWT secret**: Must be at least 32 characters
2. **Missing required fields**: Ensure all required JWT fields are present
3. **Incorrect issuer/audience**: Must match server expectations

### Debug Mode

Enable debug logging to see detailed permission checking:

```bash
LOG_LEVEL=debug npm start
```

This will show detailed logs of permission validation, including which permissions are being checked and why access is granted or denied.
