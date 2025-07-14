/**
 * Unified MCP server factory for both HTTP and STDIO transports
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAllTools } from '../tools/toolRegistry.js';
import { toolRegistry } from './toolRegistry.js';
import { createLogger } from '@/utils/logger.js';

const logger = createLogger('mcp-server-factory');

/**
 * Configuration options for creating an MCP server
 */
export interface McpServerConfig {
  enableLogging?: boolean;
  name?: string;
  version?: string;
}

/**
 * Creates a new MCP server instance with tools registered
 */
export async function createMcpServer(
  config: McpServerConfig = {}
): Promise<McpServer> {
  const {
    enableLogging = false,
    name = 'mapbox-mcp-server',
    version = process.env.npm_package_version || '0.2.0'
  } = config;

  const server = new McpServer(
    {
      name,
      version
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: enableLogging ? {} : undefined
      }
    }
  );

  // Register all tools from the registry
  getAllTools().forEach((tool) => {
    tool.installTo(server);
  });

  logger.info('MCP server created', {
    name,
    version,
    toolCount: toolRegistry.getToolCount(),
    logging: enableLogging
  });

  return server;
}
