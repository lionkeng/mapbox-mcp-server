/**
 * Stdio server implementation for backward compatibility
 * Maintains the original stdio transport functionality
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toolRegistry } from './toolRegistry.js';
import { createLogger } from '@/utils/logger.js';
import { registerCleanup } from '@/utils/shutdown.js';

const logger = createLogger('stdio-server');

/**
 * Stdio server configuration
 */
export interface StdioServerConfig {
  enableLogging?: boolean;
}

/**
 * Stdio server for MCP protocol over standard input/output
 */
export class StdioServer {
  private server: McpServer | null = null;
  private transport: StdioServerTransport | null = null;
  private config: StdioServerConfig;

  constructor(config: StdioServerConfig = {}) {
    this.config = config;
  }

  /**
   * Creates and configures the MCP server
   */
  private async createMcpServer(): Promise<McpServer> {
    const server = new McpServer(
      {
        name: 'mapbox-mcp-server',
        version: process.env.npm_package_version || '0.2.0'
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: this.config.enableLogging ? {} : undefined
        }
      }
    );

    // Register all tools from the registry
    await toolRegistry.registerWithMcpServer(server);

    logger.info('MCP server created for stdio transport', {
      toolCount: toolRegistry.getToolCount(),
      logging: this.config.enableLogging
    });

    return server;
  }

  /**
   * Starts the stdio server
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error('Stdio server is already running');
    }

    try {
      // Create MCP server
      this.server = await this.createMcpServer();

      // Create stdio transport
      this.transport = new StdioServerTransport();

      // Connect server to transport
      await this.server.connect(this.transport);

      // Register cleanup
      registerCleanup('stdio-server', async () => {
        await this.stop();
      });

      logger.info('Stdio server started successfully', {
        pid: process.pid,
        toolCount: toolRegistry.getToolCount()
      });

      // Log available tools for debugging
      const tools = toolRegistry.listTools();
      logger.debug('Available tools', {
        tools: tools.map((t) => ({ name: t.name, description: t.description }))
      });
    } catch (error) {
      logger.error('Failed to start stdio server', { error });
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Stops the stdio server
   */
  async stop(): Promise<void> {
    if (!this.server || !this.transport) {
      return;
    }

    try {
      await this.cleanup();
      logger.info('Stdio server stopped successfully');
    } catch (error) {
      logger.error('Error stopping stdio server', { error });
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        logger.warn('Error closing stdio transport', { error });
      }
      this.transport = null;
    }

    this.server = null;
  }

  /**
   * Checks if server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.transport !== null;
  }

  /**
   * Gets server statistics
   */
  getStats(): {
    isRunning: boolean;
    toolCount: number;
    pid: number;
    uptime: number;
  } {
    return {
      isRunning: this.isRunning(),
      toolCount: toolRegistry.getToolCount(),
      pid: process.pid,
      uptime: process.uptime()
    };
  }

  /**
   * Gets the MCP server instance
   */
  getMcpServer(): McpServer | null {
    return this.server;
  }

  /**
   * Gets the transport instance
   */
  getTransport(): StdioServerTransport | null {
    return this.transport;
  }
}

/**
 * Creates and starts a stdio server
 */
export async function createStdioServer(
  config: StdioServerConfig = {}
): Promise<StdioServer> {
  const server = new StdioServer(config);
  await server.start();
  return server;
}
