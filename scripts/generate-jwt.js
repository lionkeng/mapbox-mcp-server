#!/usr/bin/env node

/**
 * JWT Token Generator for Mapbox MCP Server
 *
 * Usage:
 *   node generate-jwt.js                    # Full access, 24h expiration
 *   node generate-jwt.js --hours 1          # Full access, 1h expiration
 *   node generate-jwt.js --permissions geocode,directions  # Limited permissions
 *   node generate-jwt.js --user-id my-app   # Custom user ID
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// ES module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file if it exists
try {
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv not available or .env file doesn't exist, continue without it
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  permissions: ['mapbox:*'],
  hours: 24,
  userId: 'claude-code-user'
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--permissions':
      if (args[i + 1]) {
        const perms = args[i + 1]
          .split(',')
          .map((p) => (p.startsWith('mapbox:') ? p : `mapbox:${p}`));
        options.permissions = perms;
        i++;
      }
      break;
    case '--hours':
      if (args[i + 1]) {
        options.hours = parseInt(args[i + 1], 10);
        i++;
      }
      break;
    case '--user-id':
      if (args[i + 1]) {
        options.userId = args[i + 1];
        i++;
      }
      break;
    case '--help':
      console.log(`
JWT Token Generator for Mapbox MCP Server

Usage:
  node generate-jwt.js [options]

Options:
  --permissions <list>  Comma-separated list of permissions (default: full access)
  --hours <number>      Token expiration in hours (default: 24)
  --user-id <string>    User identifier (default: claude-code-user)
  --help                Show this help message

Available Permissions:
  * or mapbox:*         Full access to all tools
  geocode               Forward and reverse geocoding
  directions            Routing and navigation
  isochrone             Isochrone calculations
  matrix                Travel time/distance matrices
  poi                   POI and category search
  static-images         Static map generation

Examples:
  # Full access for 24 hours
  node generate-jwt.js

  # Limited permissions for 1 hour
  node generate-jwt.js --permissions geocode,directions --hours 1

  # Custom user ID
  node generate-jwt.js --user-id my-application

Environment Variables:
  JWT_SECRET            Required. Must be at least 32 characters.
                        Generate with: openssl rand -base64 32
`);
      process.exit(0);
  }
}

// Check for JWT_SECRET
if (!process.env.JWT_SECRET) {
  console.error('Error: JWT_SECRET environment variable is required.');
  console.error('');
  console.error('Generate a secure secret with:');
  console.error('  openssl rand -base64 32');
  console.error('');
  console.error('Then set it:');
  console.error('  export JWT_SECRET="your-generated-secret"');
  console.error('');
  console.error('Or add it to a .env file in the project root:');
  console.error('  JWT_SECRET=your-generated-secret');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error(
    'Error: JWT_SECRET must be at least 32 characters for security.'
  );
  console.error(`Current length: ${process.env.JWT_SECRET.length}`);
  console.error('');
  console.error('Generate a secure secret with:');
  console.error('  openssl rand -base64 32');
  process.exit(1);
}

// jsonwebtoken is already imported at the top

// Generate token
const now = Math.floor(Date.now() / 1000);
const expiresIn = options.hours * 3600;

const payload = {
  iss: 'mapbox-mcp-server',
  sub: options.userId,
  aud: 'mapbox-mcp-server',
  exp: now + expiresIn,
  iat: now,
  permissions: options.permissions
};

try {
  const token = jwt.sign(payload, process.env.JWT_SECRET);

  console.log('JWT Token Generated Successfully!');
  console.log('================================');
  console.log('');
  console.log('Token Details:');
  console.log(`  User ID:     ${options.userId}`);
  console.log(`  Permissions: ${options.permissions.join(', ')}`);
  console.log(
    `  Expires:     ${new Date((now + expiresIn) * 1000).toISOString()} (${options.hours} hours)`
  );
  console.log('');
  console.log('Token:');
  console.log(token);
  console.log('');
  console.log('Add to Claude Code:');
  console.log(
    `claude mcp add --transport http mapbox-server http://localhost:8080/messages \\`
  );
  console.log(`  --header "Authorization: Bearer ${token}"`);
  console.log('');
  console.log('Test with curl (single request):');
  console.log(`curl -X POST http://localhost:8080/messages \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "Authorization: Bearer ${token}" \\`);
  console.log(
    `  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'`
  );
  console.log('');
  console.log('Test with curl (batch request):');
  console.log(`curl -X POST http://localhost:8080/messages \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "Authorization: Bearer ${token}" \\`);
  console.log(`  -d '[`);
  console.log(
    `    {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},`
  );
  console.log(
    `    {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {`
  );
  console.log(`      "name": "MapboxGeocodingForward",`);
  console.log(
    `      "arguments": {"q": "1600 Pennsylvania Avenue, Washington DC"}`
  );
  console.log(`    }}`);
  console.log(`  ]'`);
} catch (error) {
  console.error('Error generating token:', error.message);
  process.exit(1);
}
