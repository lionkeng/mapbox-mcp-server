import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  // Check for JWT_SECRET
  if (!process.env.JWT_SECRET) {
    console.error('Error: JWT_SECRET environment variable is required.');
    console.error('Set it in .env file or as an environment variable.');
    console.error('Generate with: openssl rand -base64 32');
    process.exit(1);
  }

  // Generate JWT token
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600; // 1 hour

  const payload = {
    iss: 'mapbox-mcp-server',
    sub: 'test-client',
    aud: 'mapbox-mcp-server',
    exp: now + expiresIn,
    iat: now,
    permissions: ['mapbox:*'] // Full access
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET);

  // Point to your MCP server's HTTP endpoint
  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost:8080/mcp'), // Adjust if your server uses a different path
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );

  const client = new Client({ name: 'mcp-http-client', version: '1.0.0' });

  await client.connect(transport);

  // Example: List tools
  try {
    const toolsResult = await client.listTools();
    console.log(
      'Available tools:',
      toolsResult.tools.map((tool: any) => tool.name)
    );
  } catch (error) {
    console.log(
      'Error listing tools (likely schema validation issue):',
      error.message
    );
    console.log('Testing direct tool calls instead...');
  }

  // Example: Call forward geocoding tool
  try {
    console.log('\nCalling forward geocoding tool...');
    const geocodeResult = await client.callTool({
      name: 'forward_geocode_tool',
      arguments: {
        q: '1600 Pennsylvania Avenue, Washington DC'
      }
    });
    console.log(
      'Forward geocoding result:',
      JSON.stringify(geocodeResult, null, 2)
    );
  } catch (error) {
    console.log('Error calling forward geocoding tool:', error.message);
  }

  // Example: Call reverse geocoding tool
  try {
    console.log('\nCalling reverse geocoding tool...');
    const reverseResult = await client.callTool({
      name: 'reverse_geocode_tool',
      arguments: {
        longitude: -77.036133,
        latitude: 38.895111
      }
    });
    console.log(
      'Reverse geocoding result:',
      JSON.stringify(reverseResult, null, 2)
    );
  } catch (error) {
    console.log('Error calling reverse geocoding tool:', error.message);
  }

  await client.close();
}

main().catch(console.error);
