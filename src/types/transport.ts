/**
 * Transport type definitions for the MCP server
 * Supports both stdio and HTTP transports
 */

/**
 * Transport types supported by the MCP server
 */
export type TransportType = 'stdio' | 'http';

/**
 * Base transport configuration
 */
export interface BaseTransportConfig {
  type: TransportType;
}

/**
 * Stdio transport configuration
 */
export interface StdioTransportConfig extends BaseTransportConfig {
  type: 'stdio';
}

/**
 * HTTP transport configuration
 */
export interface HttpTransportConfig extends BaseTransportConfig {
  type: 'http';
  port: number;
  host: string;
  enableMetrics?: boolean;
  enableCors?: boolean;
  enableRateLimit?: boolean;
  rateLimitMax?: number;
  rateLimitWindow?: number;
}

/**
 * Union type for all transport configurations
 */
export type TransportConfig = StdioTransportConfig | HttpTransportConfig;

/**
 * Transport selection result
 */
export interface TransportSelection {
  config: TransportConfig;
  source: 'cli-flag' | 'environment' | 'default';
}

/**
 * HTTP server options
 */
export interface HttpServerOptions {
  port: number;
  host: string;
  cors: boolean;
  rateLimit: boolean;
  metrics: boolean;
  jwtSecret: string;
}

/**
 * Server startup result
 */
export interface ServerStartupResult {
  transport: TransportType;
  address?: string;
  port?: number;
  startTime: Date;
}

/**
 * MCP Session information
 */
export interface McpSession {
  id: string;
  userId: string;
  createdAt: Date;
  lastActivity: Date;
  permissions?: string[];
}

/**
 * SSE Connection state
 */
export interface SSEConnection {
  sessionId: string;
  reply: any; // FastifyReply with SSE support
  createdAt: Date;
  lastActivity: Date;
}

/**
 * Type guard for HTTP transport config
 */
export function isHttpTransport(
  config: TransportConfig
): config is HttpTransportConfig {
  return config.type === 'http';
}

/**
 * Type guard for stdio transport config
 */
export function isStdioTransport(
  config: TransportConfig
): config is StdioTransportConfig {
  return config.type === 'stdio';
}
