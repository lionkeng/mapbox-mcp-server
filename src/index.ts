/**
 * Mapbox MCP Server - Main Entry Point
 * Supports both stdio and HTTP transports based on configuration
 */

// Load environment variables from .env file
import 'dotenv/config';

import { HttpServer } from './server/httpServer.js';
import { registerMcpTransport } from './server/mcpHttpTransport.js';
import { createMcpServer } from './server/mcpServerFactory.js';
import { createStdioServer, StdioServer } from './server/stdioServer.js';
import { toolRegistry } from './server/toolRegistry.js';
import { patchGlobalFetch } from './utils/requestUtils.js';
import { getVersionInfo } from './utils/versionUtils.js';
import { validateEnvironment } from '@/config/environment.js';
import { configureTransport } from '@/transport/selector.js';
import { isHttpTransport, HttpTransportConfig } from '@/types/transport.js';
import { logStartup, logShutdown, serverLogger } from '@/utils/logger.js';
import { setupGracefulShutdown } from '@/utils/shutdown.js';

/**
 * Configuration constants
 */
const CONFIG = {
  TIMEOUTS: {
    GRACEFUL_SHUTDOWN: 30000,
    REQUEST_TIMEOUT: 30000
  },
  LIMITS: {
    BODY_LIMIT: 1048576, // 1MB
    MAX_REQUEST_SIZE: 1048576 // 1MB
  },
  LOGGING: {
    DEFAULT_LEVEL: 'info'
  }
} as const;

/**
 * Gets tool count from registry
 */
function getToolCount(): number {
  return toolRegistry.getToolCount();
}

/**
 * Validates required environment variables
 */
function validateRequiredEnv(): void {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }
}

/**
 * Application main class
 */
class MapboxMcpApplication {
  private httpServer: HttpServer | null = null;
  private stdioServer: StdioServer | null = null;

  /**
   * Initializes the application
   */
  async initialize(): Promise<void> {
    // Setup graceful shutdown first
    setupGracefulShutdown({
      timeout: CONFIG.TIMEOUTS.GRACEFUL_SHUTDOWN,
      signals: ['SIGTERM', 'SIGINT', 'SIGUSR2']
    });

    // Validate environment
    validateEnvironment();
    validateRequiredEnv();

    // Patch global fetch with version info
    const versionInfo = getVersionInfo();
    patchGlobalFetch(versionInfo);

    serverLogger.info('Application initialized', {
      version: versionInfo.version,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    });
  }

  /**
   * Starts the appropriate server based on transport configuration
   */
  async start(): Promise<{ exitCode?: number; message?: string }> {
    const result = configureTransport();

    if (!result.success) {
      // Return error information instead of exiting
      return {
        exitCode: result.exitCode,
        message: result.error
      };
    }

    const config = result.config;

    if (isHttpTransport(config)) {
      await this.startHttpServer(config);
    } else {
      await this.startStdioServer();
    }

    return {}; // Success
  }

  /**
   * Starts the HTTP server
   */
  private async startHttpServer(config: HttpTransportConfig): Promise<void> {
    try {
      // Create MCP server with tools
      const mcpServer = await createMcpServer({ enableLogging: true });

      // Create HTTP server
      this.httpServer = new HttpServer({
        ...config,
        jwtSecret: process.env.JWT_SECRET!,
        trustProxy: true,
        requestTimeout: CONFIG.TIMEOUTS.REQUEST_TIMEOUT,
        bodyLimit: CONFIG.LIMITS.BODY_LIMIT
      });

      // Initialize HTTP server (creates Fastify instance)
      const fastify = await this.httpServer.initialize();

      // Register MCP transport BEFORE starting the server
      await registerMcpTransport(fastify, mcpServer, {
        enableStreaming: true,
        maxRequestSize: CONFIG.LIMITS.MAX_REQUEST_SIZE,
        requestTimeout: CONFIG.TIMEOUTS.REQUEST_TIMEOUT
      });

      // Now start the HTTP server
      const { address, port } = await this.httpServer.start();

      logStartup({
        transport: 'http',
        port,
        host: config.host,
        logLevel: process.env.LOG_LEVEL || CONFIG.LOGGING.DEFAULT_LEVEL
      });

      serverLogger.info('HTTP server ready', {
        address,
        port,
        cors: config.enableCors,
        metrics: config.enableMetrics,
        toolCount: getToolCount()
      });
    } catch (error) {
      serverLogger.error('Failed to start HTTP server', { error });
      throw error;
    }
  }

  /**
   * Starts the stdio server
   */
  private async startStdioServer(): Promise<void> {
    try {
      this.stdioServer = await createStdioServer({
        enableLogging: true
      });

      logStartup({
        transport: 'stdio',
        logLevel: process.env.LOG_LEVEL || CONFIG.LOGGING.DEFAULT_LEVEL
      });

      serverLogger.info('Stdio server ready', {
        pid: process.pid,
        toolCount: getToolCount()
      });
    } catch (error) {
      serverLogger.error('Failed to start stdio server', { error });
      throw error;
    }
  }

  /**
   * Stops the application
   */
  async stop(): Promise<void> {
    try {
      if (this.httpServer) {
        await this.httpServer.stop();
        this.httpServer = null;
      }

      if (this.stdioServer) {
        await this.stdioServer.stop();
        this.stdioServer = null;
      }

      logShutdown('Application stopped');
    } catch (error) {
      serverLogger.error('Error during application shutdown', { error });
      throw error;
    }
  }

  /**
   * Gets application status
   */
  getStatus(): {
    transport: 'http' | 'stdio' | 'none';
    isRunning: boolean;
    uptime: number;
  } {
    let transport: 'http' | 'stdio' | 'none' = 'none';
    let isRunning = false;

    if (this.httpServer?.isRunning()) {
      transport = 'http';
      isRunning = true;
    } else if (this.stdioServer?.isRunning()) {
      transport = 'stdio';
      isRunning = true;
    }

    return {
      transport,
      isRunning,
      uptime: process.uptime()
    };
  }
}

/**
 * Application main function
 */
async function main(): Promise<void> {
  const app = new MapboxMcpApplication();

  try {
    await app.initialize();
    const result = await app.start();

    // Handle exit conditions returned by start()
    if (result.exitCode !== undefined) {
      if (result.exitCode === 0) {
        // Help or version - output and exit gracefully
        console.log(result.message);
        process.exit(0);
      } else {
        // Configuration error
        console.error(result.message);
        process.exit(result.exitCode);
      }
    }
  } catch (error) {
    serverLogger.fatal('Application failed to start', { error });
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  serverLogger.fatal('Uncaught exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  serverLogger.fatal('Unhandled promise rejection', { reason, promise });
  process.exit(1);
});

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });
}
