/**
 * Fastify app builders for testing
 * Provides both injection-based and full server setups
 */

import fastify, { FastifyInstance } from 'fastify';
import { HttpServer, HttpServerConfig } from '../../server/httpServer.js';
import {
  registerMcpTransport,
  createMcpServer
} from '../../server/mcpHttpTransport.js';
import { TEST_SERVER_CONFIG } from './constants.js';

/**
 * Default test configuration for HTTP server
 */
export const DEFAULT_TEST_CONFIG: HttpServerConfig = {
  type: 'http',
  port: TEST_SERVER_CONFIG.PORT,
  host: TEST_SERVER_CONFIG.HOST,
  enableCors: true,
  enableMetrics: true,
  jwtSecret: TEST_SERVER_CONFIG.JWT_SECRET,
  trustProxy: false,
  requestTimeout: TEST_SERVER_CONFIG.REQUEST_TIMEOUT,
  bodyLimit: TEST_SERVER_CONFIG.BODY_LIMIT
};

/**
 * Creates a Fastify app for injection-based unit testing
 * Does not start an HTTP server - use app.inject() for testing
 */
export async function buildTestApp(
  config: Partial<HttpServerConfig> = {}
): Promise<FastifyInstance> {
  const testConfig = { ...DEFAULT_TEST_CONFIG, ...config };

  const httpServer = new HttpServer(testConfig);
  const app = await httpServer.initialize();

  // Register MCP transport
  const mcpServer = await createMcpServer();
  await registerMcpTransport(app, mcpServer);

  return app;
}

/**
 * Creates a full HTTP server for integration/E2E testing
 * Returns both the server instance and the actual URL to connect to
 */
export async function buildTestServer(
  config: Partial<HttpServerConfig> = {}
): Promise<{
  server: HttpServer;
  url: string;
  port: number;
}> {
  const testConfig = { ...DEFAULT_TEST_CONFIG, ...config };

  const httpServer = new HttpServer(testConfig);
  const app = await httpServer.initialize();

  // Register MCP transport
  const mcpServer = await createMcpServer();
  await registerMcpTransport(app, mcpServer);

  // Start the server
  const { port } = await httpServer.start();
  const url = `http://127.0.0.1:${port}`;

  return {
    server: httpServer,
    url,
    port
  };
}

/**
 * Creates a minimal Fastify app without MCP transport
 * Useful for testing core HTTP functionality in isolation
 */
export async function buildMinimalApp(
  config: Partial<HttpServerConfig> = {}
): Promise<FastifyInstance> {
  const testConfig = { ...DEFAULT_TEST_CONFIG, ...config };

  const httpServer = new HttpServer(testConfig);
  const app = await httpServer.initialize();

  return app;
}

/**
 * Cleanup helper for test servers
 */
export async function cleanupTestServer(server: HttpServer): Promise<void> {
  try {
    // Force close all connections before stopping
    await server.stop();

    // Add a small delay to allow connections to fully close
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (error) {
    // Ignore cleanup errors in tests but log them for debugging
    console.warn('Error during test server cleanup:', error);
  }
}
