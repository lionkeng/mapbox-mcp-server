/**
 * MCP Streamable HTTP transport integration with Fastify
 * Provides the /mcp endpoint for MCP protocol communication
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification
} from '@modelcontextprotocol/sdk/types.js';
import { AuthenticatedRequest, JwtPayload } from './httpServer.js';
import { toolRegistry, ToolExecutionContext } from './toolRegistry.js';
import { createLogger, PerformanceLogger } from '@/utils/logger.js';
import { ValidationError } from '@/utils/errors.js';
import { z } from 'zod';
import crypto from 'node:crypto';

/**
 * Request handler function type
 */
type RequestHandler = (
  request: JSONRPCRequest,
  context: McpRequestContext
) => Promise<JSONRPCResponse>;

/**
 * Notification handler function type
 */
type NotificationHandler = (
  notification: JSONRPCNotification,
  context: McpRequestContext
) => Promise<void>;

/**
 * Tool call arguments interface
 */
interface ToolCallArguments {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Unknown request body interface for error handling
 */
interface UnknownRequestBody {
  id?: string | number | null;
  method?: string;
}

const logger = createLogger('mcp-http-transport');

/**
 * JSON-RPC request schema for validation
 */
const jsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string().optional(),
    params: z.record(z.unknown()).optional(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional()
      })
      .optional()
  })
  .refine(
    (data) => {
      // Must have either method (request/notification) or result/error (response)
      const hasMethod = data.method !== undefined;
      const hasResult = data.result !== undefined;
      const hasError = data.error !== undefined;

      return hasMethod || hasResult || hasError;
    },
    {
      message:
        "JSON-RPC message must have either 'method' (for requests/notifications) or 'result'/'error' (for responses)"
    }
  );

/**
 * JSON-RPC batch request schema
 */
const jsonRpcBatchSchema = z.array(jsonRpcRequestSchema).min(1);

/**
 * MCP HTTP transport configuration
 */
export interface McpHttpTransportConfig {
  enableStreaming?: boolean;
  maxRequestSize?: number;
  requestTimeout?: number;
  allowedOrigins?: string[];
  enforceLocalhost?: boolean;
}

/**
 * Request context for MCP operations
 */
export interface McpRequestContext {
  user: JwtPayload;
  requestId: string;
  correlationId?: string | undefined;
  startTime: bigint;
}

/**
 * Session information with proper typing
 */
interface SessionInfo {
  source: SSESource;
  createdAt: Date;
  lastActivity: Date;
  userId: string;
  lastEventId?: string;
  eventBuffer: Array<{ id: string; event?: string; data: string }>;
  heartbeatTimer?: NodeJS.Timeout;
  cleanupHandlers: Array<() => void>;
}

/**
 * Fastify instance with authentication middleware
 */
interface AuthenticatedFastifyInstance extends FastifyInstance {
  authenticate?: (
    request: FastifyRequest,
    reply: FastifyReply
  ) => Promise<void>;
}

/**
 * Custom Streamable HTTP transport for Fastify integration
 */
class FastifyStreamableTransport implements Transport {
  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private errorHandler?: (error: Error) => void;
  private closeHandler?: () => void;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (response: JSONRPCResponse) => void;
      reject: (error: Error) => void;
      sessionId?: string;
    }
  >();

  constructor(public config: McpHttpTransportConfig = {}) {}

  /**
   * Starts the transport (no-op for HTTP)
   */
  async start(): Promise<void> {
    logger.debug('MCP HTTP transport started');
  }

  /**
   * Closes the transport (no-op for HTTP)
   */
  async close(): Promise<void> {
    logger.debug('MCP HTTP transport closed');
  }

  /**
   * Sends a message to appropriate SSE sessions
   */
  async send(message: JSONRPCRequest | JSONRPCResponse): Promise<void> {
    // For responses, route to the session that made the request
    if (
      ('id' in message && message.id !== null && 'result' in message) ||
      'error' in message
    ) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        if (pending.sessionId) {
          this.sendToSession(pending.sessionId, message);
        }
        pending.resolve(message as JSONRPCResponse);
        this.pendingRequests.delete(message.id);
        return;
      }
    }

    // For requests/notifications from server, broadcast to all sessions
    if ('method' in message) {
      const sessionIds = Array.from(sessionStore.keys());
      const sendPromises = sessionIds.map((sessionId) =>
        this.sendToSession(sessionId, message)
      );

      const results = await Promise.all(sendPromises);
      const sentCount = results.filter((success) => success).length;

      if (sentCount === 0) {
        logger.warn('No active sessions to send message to', {
          method: (message as JSONRPCRequest).method,
          totalSessions: sessionIds.length
        });
      }
    }
  }

  /**
   * Sets request handler
   */
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
    logger.debug('Request handler registered');
  }

  /**
   * Sets notification handler
   */
  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
    logger.debug('Notification handler registered');
  }

  /**
   * Sets error handler
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
    logger.debug('Error handler registered');
  }

  /**
   * Sets close handler
   */
  onClose(handler: () => void): void {
    this.closeHandler = handler;
    logger.debug('Close handler registered');
  }

  /**
   * Handles HTTP request for MCP protocol
   */
  async handleHttpRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    mcpServer: McpServer
  ): Promise<void> {
    const perfLogger = new PerformanceLogger(
      'mcp-http-transport',
      'handleRequest'
    );
    const authenticatedRequest = request as AuthenticatedRequest;
    if (!authenticatedRequest.user) {
      throw new ValidationError('Request is not authenticated');
    }

    const context: McpRequestContext = {
      user: authenticatedRequest.user,
      requestId: request.id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
      startTime: process.hrtime.bigint()
    };

    try {
      // Validate Accept header
      const acceptHeader = request.headers.accept || '';
      const acceptsJson =
        acceptHeader.includes('application/json') ||
        acceptHeader === '*/*' ||
        !acceptHeader;
      const acceptsSSE = acceptHeader.includes('text/event-stream');

      if (!acceptsJson && !acceptsSSE) {
        throw new ValidationError(
          'Invalid Accept header. Must accept application/json or text/event-stream',
          undefined,
          { acceptHeader }
        );
      }

      // Validate JSON-RPC request
      const jsonRpcData = this.validateRequest(request.body);
      const isBatch = Array.isArray(jsonRpcData);
      const requests = isBatch ? jsonRpcData : [jsonRpcData];

      // Check if all messages are responses/notifications
      const allResponsesOrNotifications = requests.every((req) => {
        // A message is a request if it has a method property
        if (req.method !== undefined) return false;

        // A message is a response if it has exactly one of: result or error
        const hasResult = req.hasOwnProperty('result');
        const hasError = req.hasOwnProperty('error');

        // Must have exactly one of result or error for a response
        return (hasResult && !hasError) || (!hasResult && hasError);
      });

      if (allResponsesOrNotifications) {
        // For responses and notifications, return 202 Accepted with no body
        await reply.status(202).send();

        perfLogger.end('MCP response/notification accepted', {
          count: requests.length,
          batch: isBatch
        });
        return;
      }

      // Process each request
      const responses: JSONRPCResponse[] = [];
      const errors: Array<{ id: string | number | null; error: unknown }> = [];

      for (const jsonRpcMessage of requests) {
        try {
          // Skip responses (they should be handled differently)
          if (!jsonRpcMessage.method) {
            continue;
          }

          logger.info('Processing MCP request', {
            method: jsonRpcMessage.method,
            id: jsonRpcMessage.id,
            user: context.user.sub,
            requestId: context.requestId,
            correlationId: context.correlationId,
            batch: isBatch
          });

          // Check permissions if specified
          if (context.user.permissions) {
            this.checkPermissions(
              jsonRpcMessage.method,
              context.user.permissions
            );
          }

          // For requests, delegate to the appropriate handler
          let response: JSONRPCResponse;

          if (jsonRpcMessage.id !== null && jsonRpcMessage.id !== undefined) {
            // This is a request - use request handler if available
            if (this.requestHandler) {
              response = await this.requestHandler(
                jsonRpcMessage as JSONRPCRequest,
                context
              );
            } else {
              // Fallback to direct processing
              response = await this.processRequest(
                jsonRpcMessage as JSONRPCRequest,
                context,
                mcpServer
              );
            }
            responses.push(response);
          } else {
            // This is a notification - use notification handler if available
            if (this.notificationHandler) {
              await this.notificationHandler(
                { ...jsonRpcMessage, id: null } as JSONRPCNotification, // Ensure notification has null id
                context
              );
            } else {
              // Log notification since we can't process it
              logger.info('Received notification', {
                method: jsonRpcMessage.method,
                params: jsonRpcMessage.params
              });
            }
          }
        } catch (error) {
          // For requests with IDs, add error response
          if (jsonRpcMessage.id !== null && jsonRpcMessage.id !== undefined) {
            errors.push({
              id: jsonRpcMessage.id,
              error
            });
          }
          // For notifications, just log the error
          else {
            logger.error('Notification processing failed', {
              method: jsonRpcMessage.method,
              error: error instanceof Error ? error.message : error
            });
          }
        }
      }

      // Create error responses
      const errorResponses = errors.map(({ id, error }) =>
        this.createErrorResponse(id, error)
      );

      // Combine successful and error responses
      const allResponses = [...responses, ...errorResponses];

      // Send response based on Accept header and response count
      if (allResponses.length === 0) {
        // All were notifications, return 202 Accepted
        await reply.status(202).send();
      } else if (acceptsSSE && acceptsJson) {
        // Client accepts both, send as JSON for now (SSE will be for GET)
        if (isBatch) {
          await reply.send(allResponses);
        } else {
          await reply.send(allResponses[0]);
        }
      } else {
        // Send as JSON
        if (isBatch) {
          await reply.send(allResponses);
        } else {
          await reply.send(allResponses[0]);
        }
      }

      perfLogger.end('MCP request completed successfully', {
        requestCount: requests.length,
        responseCount: allResponses.length,
        batch: isBatch,
        acceptHeader
      });
    } catch (error) {
      logger.error('MCP request failed', {
        error: error instanceof Error ? error.message : error,
        requestId: context.requestId,
        user: context.user.sub
      });

      // Create JSON-RPC error response
      const unknownBody = request.body as UnknownRequestBody;
      const errorResponse = this.createErrorResponse(
        unknownBody?.id || null,
        error
      );

      await reply.status(200).send(errorResponse);

      perfLogger.error(
        error instanceof Error ? error : new Error(String(error)),
        {
          method: unknownBody?.method
        }
      );
    }
  }

  /**
   * Validates JSON-RPC request format
   */
  private validateRequest(body: unknown): JSONRPCRequest | JSONRPCRequest[] {
    try {
      // Try to parse as batch first
      if (Array.isArray(body)) {
        return jsonRpcBatchSchema.parse(body) as JSONRPCRequest[];
      }
      // Otherwise parse as single request
      return jsonRpcRequestSchema.parse(body) as JSONRPCRequest;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ');

        throw new ValidationError(
          `Invalid JSON-RPC request: ${errorMessage}`,
          error.errors
        );
      }
      throw error;
    }
  }

  /**
   * Checks if user has permission for the requested method
   */
  private checkPermissions(method: string, permissions: string[]): void {
    // For tools/call, permission checking is handled at the tool level
    // Other methods need method-level permission checking
    if (method === 'tools/call') {
      // Skip permission check here - it will be handled by the tool registry
      return;
    }

    // tools/list is a read-only operation that should be allowed without specific permissions
    // as it only lists available tools without executing them
    if (method === 'tools/list') {
      return;
    }

    // Extract permission from method name
    // e.g., "resources/read" -> "resources"
    const [category] = method.split('/');

    const requiredPermission = `mapbox:${category}`;

    if (
      !permissions.includes(requiredPermission) &&
      !permissions.includes('mapbox:*')
    ) {
      throw new ValidationError(
        `Insufficient permissions for method: ${method}`,
        undefined,
        { requiredPermission, userPermissions: permissions }
      );
    }
  }

  /**
   * Processes the JSON-RPC request through MCP server
   */
  private async processRequest(
    request: JSONRPCRequest,
    context: McpRequestContext,
    mcpServer: McpServer
  ): Promise<JSONRPCResponse> {
    // Handle different MCP methods
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request, context, mcpServer);

      case 'tools/list':
        return this.handleToolsList(request, context, mcpServer);

      case 'tools/call':
        return this.handleToolsCall(request, context, mcpServer);

      case 'resources/list':
        return this.handleResourcesList(request, context, mcpServer);

      case 'resources/read':
        return this.handleResourcesRead(request, context, mcpServer);

      default:
        throw new ValidationError(`Unknown method: ${request.method}`);
    }
  }

  /**
   * Handles initialize method
   */
  private async handleInitialize(
    request: JSONRPCRequest,
    _context: McpRequestContext,
    _mcpServer: McpServer
  ): Promise<JSONRPCResponse> {
    // Get server capabilities
    const capabilities = {
      tools: {},
      resources: {},
      prompts: {},
      logging: {}
    };

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities,
        serverInfo: {
          name: 'mapbox-mcp-server',
          version: process.env.npm_package_version || '0.2.0'
        }
      }
    };
  }

  /**
   * Handles tools/list method
   */
  private async handleToolsList(
    request: JSONRPCRequest,
    context: McpRequestContext,
    _mcpServer: McpServer
  ): Promise<JSONRPCResponse> {
    const tools = toolRegistry.listTools().map((tool) => {
      // Tool already has JSON Schema format inputSchema from toolRegistry
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      };
    });

    logger.debug('Listed tools', {
      count: tools.length,
      user: context.user.sub
    });

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools
      }
    };
  }

  /**
   * Handles tools/call method
   */
  private async handleToolsCall(
    request: JSONRPCRequest,
    context: McpRequestContext,
    _mcpServer: McpServer
  ): Promise<JSONRPCResponse> {
    if (!request.params) {
      throw new ValidationError('Tool call parameters are required');
    }
    const toolCallParams = request.params as unknown as ToolCallArguments;
    const { name, arguments: args } = toolCallParams;

    if (!name) {
      throw new ValidationError('Tool name is required');
    }

    // Check if tool exists
    if (!toolRegistry.hasTool(name)) {
      throw new ValidationError(`Tool not found: ${name}`);
    }

    // Create execution context
    const executionContext: ToolExecutionContext = {
      userId: context.user.sub,
      requestId: context.requestId,
      correlationId: context.correlationId || '',
      permissions: context.user.permissions || []
    };

    // Validate and execute tool
    const validatedInput = toolRegistry.validateToolInput(name, args);
    const result = await toolRegistry.executeTool(
      name,
      validatedInput,
      executionContext
    );

    logger.info('Tool executed successfully', {
      toolName: name,
      user: context.user.sub,
      requestId: context.requestId
    });

    return {
      jsonrpc: '2.0',
      id: request.id,
      result
    };
  }

  /**
   * Handles resources/list method
   */
  private async handleResourcesList(
    request: JSONRPCRequest,
    _context: McpRequestContext,
    _mcpServer: McpServer
  ): Promise<JSONRPCResponse> {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        resources: []
      }
    };
  }

  /**
   * Handles resources/read method
   */
  private async handleResourcesRead(
    request: JSONRPCRequest,
    _context: McpRequestContext,
    _mcpServer: McpServer
  ): Promise<JSONRPCResponse> {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        contents: []
      }
    };
  }

  /**
   * Creates JSON-RPC error response
   */
  private createErrorResponse(
    id: string | number | null,
    error: unknown
  ): JSONRPCResponse {
    let code: number;
    let message: string;
    let data: Record<string, unknown> | unknown[];

    if (error instanceof ValidationError) {
      code = -32602; // Invalid params
      message = error.message;
      data = error.validationErrors || {};
    } else if (error instanceof Error) {
      code = -32603; // Internal error
      message = error.message;
      data = { stack: error.stack };
    } else {
      code = -32603;
      message = 'Unknown error';
      data = { error: String(error) };
    }

    return {
      jsonrpc: '2.0' as const,
      id: id ?? 0,
      error: {
        code,
        message,
        data
      }
    } as unknown as JSONRPCResponse;
  }

  /**
   * Sends a message to a specific SSE session
   */
  async sendToSession(
    sessionId: string,
    message: JSONRPCRequest | JSONRPCResponse
  ): Promise<boolean> {
    try {
      return await withSessionLock(sessionId, () => {
        const session = sessionStore.get(sessionId);
        if (!session) {
          return false;
        }

        try {
          const eventId = crypto.randomUUID();
          const event = {
            id: eventId,
            data: JSON.stringify(message)
          };

          session.source.push(event);

          // Add to event buffer for resumption
          session.eventBuffer.push(event);

          // Trim buffer if too large
          if (
            session.eventBuffer.length > SESSION_CONFIG.MAX_EVENT_BUFFER_SIZE
          ) {
            session.eventBuffer = session.eventBuffer.slice(
              -SESSION_CONFIG.MAX_EVENT_BUFFER_SIZE
            );
          }

          session.lastActivity = new Date();
          return true;
        } catch (error) {
          logger.error('Failed to send SSE message', {
            sessionId,
            error: error instanceof Error ? error.message : error
          });
          throw error; // Let the caller decide whether to cleanup
        }
      });
    } catch (error) {
      // Cleanup session on error
      await cleanupSession(sessionId);
      return false;
    }
  }

  /**
   * Broadcasts a message to all SSE sessions for a user
   */
  async broadcastToUser(
    userId: string,
    message: JSONRPCRequest | JSONRPCResponse
  ): Promise<number> {
    const sendPromises: Promise<boolean>[] = [];
    const targetSessionIds: string[] = [];

    for (const [sessionId, session] of sessionStore.entries()) {
      if (session.userId === userId) {
        targetSessionIds.push(sessionId);
        sendPromises.push(this.sendToSession(sessionId, message));
      }
    }

    const results = await Promise.all(sendPromises);
    const sentCount = results.filter((success) => success).length;

    logger.debug('Broadcast message to user', {
      userId,
      targetSessions: targetSessionIds.length,
      successfulSends: sentCount
    });

    return sentCount;
  }

  /**
   * Ends an SSE stream for a session
   */
  async endStream(sessionId: string, reason?: string): Promise<boolean> {
    const session = sessionStore.get(sessionId);
    if (!session) {
      return false;
    }

    try {
      // Send end event
      session.source.push({
        event: 'end',
        data: JSON.stringify({
          jsonrpc: '2.0',
          method: 'connection/end',
          params: { sessionId, reason: reason || 'completed' }
        })
      });

      // Close the stream
      await cleanupSession(sessionId);
      return true;
    } catch (error) {
      logger.error('Failed to end SSE stream', {
        sessionId,
        error: error instanceof Error ? error.message : error
      });
      await cleanupSession(sessionId);
      return false;
    }
  }
}

/**
 * SSE Source type from fastify-sse-v2
 */
interface SSESource {
  push(message: { event?: string; data: string; id?: string }): void;
}

/**
 * Session store for managing SSE connections with thread safety
 */
const sessionStore = new Map<string, SessionInfo>();
const sessionStoreMutex = new Map<string, Promise<void>>();

/**
 * Session configuration
 */
const SESSION_CONFIG = {
  TTL_MS: 30 * 60 * 1000, // 30 minutes
  HEARTBEAT_INTERVAL_MS: 30 * 1000, // 30 seconds
  CLEANUP_INTERVAL_MS: 60 * 1000, // 1 minute
  MAX_EVENT_BUFFER_SIZE: 1000
};

/**
 * Cleanup timer for stale sessions
 */
let sessionCleanupTimer: NodeJS.Timeout | null = null;

/**
 * Starts session cleanup timer
 */
function startSessionCleanup(): void {
  if (!sessionCleanupTimer) {
    sessionCleanupTimer = setInterval(async () => {
      const now = Date.now();
      const staleSessionIds: string[] = [];

      // Collect stale session IDs
      for (const [sessionId, session] of sessionStore.entries()) {
        const age = now - session.lastActivity.getTime();
        if (age > SESSION_CONFIG.TTL_MS) {
          staleSessionIds.push(sessionId);
        }
      }

      // Clean up stale sessions in parallel
      if (staleSessionIds.length > 0) {
        logger.info('Cleaning up stale sessions', {
          count: staleSessionIds.length,
          sessionIds: staleSessionIds
        });

        await Promise.all(
          staleSessionIds.map((sessionId) =>
            cleanupSession(sessionId).catch((error) =>
              logger.error('Failed to cleanup session', { sessionId, error })
            )
          )
        );
      }
    }, SESSION_CONFIG.CLEANUP_INTERVAL_MS);
  }
}

/**
 * Stops session cleanup timer
 */
function stopSessionCleanup(): void {
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer);
    sessionCleanupTimer = null;
  }
}

/**
 * Safely access session store with mutex protection
 */
async function withSessionLock<T>(
  sessionId: string,
  operation: () => Promise<T> | T
): Promise<T> {
  // Wait for any existing operation on this session to complete
  if (sessionStoreMutex.has(sessionId)) {
    await sessionStoreMutex.get(sessionId);
  }

  // Create a new promise for this operation
  let resolve: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  sessionStoreMutex.set(sessionId, promise);

  try {
    const result = await operation();
    return result;
  } finally {
    // Release the lock
    sessionStoreMutex.delete(sessionId);
    resolve!();
  }
}

/**
 * Cleans up a session with mutex protection
 */
async function cleanupSession(sessionId: string): Promise<void> {
  await withSessionLock(sessionId, () => {
    const session = sessionStore.get(sessionId);
    if (session) {
      // Clear heartbeat timer
      if (session.heartbeatTimer) {
        clearInterval(session.heartbeatTimer);
      }

      // Run cleanup handlers
      session.cleanupHandlers.forEach((handler) => {
        try {
          handler();
        } catch (error) {
          logger.error('Error in cleanup handler', { sessionId, error });
        }
      });

      // Remove from store
      sessionStore.delete(sessionId);
    }
  });
}

/**
 * Registers MCP HTTP transport with Fastify
 */
export async function registerMcpTransport(
  app: AuthenticatedFastifyInstance,
  mcpServer: McpServer,
  config: McpHttpTransportConfig = {}
): Promise<FastifyStreamableTransport> {
  const transport = new FastifyStreamableTransport(config);

  // Connect the transport to the MCP server
  mcpServer.connect(transport);

  // Verify authentication middleware is available
  if (!app.authenticate) {
    throw new Error(
      'Authentication middleware not found. Ensure JWT authentication plugin is registered before calling registerMcpTransport.'
    );
  }

  // Register POST endpoint for MCP protocol
  app.post(
    '/mcp',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          oneOf: [
            {
              type: 'object',
              required: ['jsonrpc'],
              properties: {
                jsonrpc: { type: 'string', enum: ['2.0'] },
                id: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'null' }
                  ]
                },
                method: { type: 'string' },
                params: { type: 'object' },
                result: {},
                error: { type: 'object' }
              }
            },
            {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['jsonrpc'],
                properties: {
                  jsonrpc: { type: 'string', enum: ['2.0'] },
                  id: {
                    anyOf: [
                      { type: 'string' },
                      { type: 'number' },
                      { type: 'null' }
                    ]
                  },
                  method: { type: 'string' },
                  params: { type: 'object' },
                  result: {},
                  error: { type: 'object' }
                }
              }
            }
          ]
        }
      }
    },
    async (request, reply) => {
      await transport.handleHttpRequest(request, reply, mcpServer);
    }
  );

  // Register GET endpoint for SSE streams
  app.get(
    '/mcp',
    {
      preHandler: app.authenticate
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authenticatedRequest = request as AuthenticatedRequest;
      if (!authenticatedRequest.user) {
        return reply.status(401).send({ error: 'Authentication required' });
      }

      const context: McpRequestContext = {
        user: authenticatedRequest.user,
        requestId: request.id,
        correlationId: request.headers['x-correlation-id'] as
          | string
          | undefined,
        startTime: process.hrtime.bigint()
      };

      // Validate Origin header
      const origin = request.headers.origin;
      if (origin && transport.config.allowedOrigins) {
        if (!transport.config.allowedOrigins.includes(origin)) {
          return reply.status(403).send({
            error: 'Forbidden: Invalid Origin header'
          });
        }
      }

      // Get or create session ID
      const providedSessionId = request.headers['mcp-session-id'] as string;
      const sessionId =
        providedSessionId && /^[a-zA-Z0-9-_]+$/.test(providedSessionId)
          ? providedSessionId
          : crypto.randomUUID();

      // Get Last-Event-ID for resumption
      const lastEventId = request.headers['last-event-id'] as string;

      // Set custom headers before starting SSE
      reply.raw.setHeader('Mcp-Session-Id', sessionId);
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      // Set up SSE - this sends headers
      reply.sse(async (source: SSESource) => {
        // Create cleanup handlers array
        const cleanupHandlers: Array<() => void> = [];

        // Create heartbeat timer
        const heartbeatTimer = setInterval(() => {
          try {
            source.push({
              event: 'ping',
              data: JSON.stringify({ timestamp: Date.now() })
            });
          } catch (error) {
            logger.error('Heartbeat failed', { sessionId, error });
            cleanupSession(sessionId);
          }
        }, SESSION_CONFIG.HEARTBEAT_INTERVAL_MS);

        // Store session
        const sessionInfo: SessionInfo = {
          source,
          createdAt: new Date(),
          lastActivity: new Date(),
          userId: context.user.sub,
          lastEventId,
          eventBuffer: [],
          heartbeatTimer,
          cleanupHandlers
        };

        sessionStore.set(sessionId, sessionInfo);

        // Start cleanup timer if not already running
        startSessionCleanup();

        logger.info('SSE connection established', {
          sessionId,
          user: context.user.sub,
          requestId: context.requestId
        });

        // Send initial connection event
        source.push({
          event: 'open',
          data: JSON.stringify({
            jsonrpc: '2.0',
            method: 'connection/open',
            params: {
              sessionId,
              protocolVersion: '2024-11-05'
            }
          })
        });

        // Handle connection close
        const closeHandler = () => {
          logger.info('SSE connection closed', {
            sessionId,
            user: context.user.sub
          });
          // Run cleanup in background
          cleanupSession(sessionId).catch((error) =>
            logger.error('Error during connection cleanup', {
              sessionId,
              error
            })
          );
        };

        request.raw.on('close', closeHandler);
        cleanupHandlers.push(() =>
          request.raw.removeListener('close', closeHandler)
        );

        // If resuming, replay missed events
        if (lastEventId && sessionInfo.eventBuffer.length > 0) {
          const startIndex = sessionInfo.eventBuffer.findIndex(
            (e) => e.id === lastEventId
          );
          if (startIndex >= 0) {
            const eventsToReplay = sessionInfo.eventBuffer.slice(
              startIndex + 1
            );
            for (const event of eventsToReplay) {
              source.push(event);
            }
          }
        }

        // Keep the stream open until explicitly closed
        // The stream will be closed when:
        // 1. Client disconnects (closeHandler)
        // 2. Session is deleted via DELETE endpoint
        // 3. Session TTL expires (cleanup timer)
        // 4. Server sends end event for completed request streams
      });
    }
  );

  // Register DELETE endpoint for session termination
  app.delete(
    '/mcp',
    {
      preHandler: app.authenticate
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const sessionId = request.headers['mcp-session-id'] as string;

      if (!sessionId) {
        return reply.status(400).send({
          error: 'Missing Mcp-Session-Id header'
        });
      }

      const session = sessionStore.get(sessionId);
      if (session) {
        // Just remove from store, the SSE connection will handle closing
        sessionStore.delete(sessionId);

        const authenticatedRequest = request as AuthenticatedRequest;
        logger.info('Session terminated', {
          sessionId,
          user: authenticatedRequest.user?.sub || 'unknown'
        });
      }

      reply.status(204).send();
    }
  );

  logger.info('MCP HTTP transport registered', {
    endpoints: ['/mcp (POST)', '/mcp (GET)', '/mcp (DELETE)'],
    enableStreaming: config.enableStreaming
  });

  return transport;
}
