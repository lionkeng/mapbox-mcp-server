/**
 * MCP Streamable HTTP transport integration with Fastify
 * Provides the /messages endpoint for MCP protocol communication
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  JSONRPCRequest,
  JSONRPCResponse
} from '@modelcontextprotocol/sdk/types.js';
import { AuthenticatedRequest, JwtPayload } from './httpServer.js';
import { toolRegistry, ToolExecutionContext } from './toolRegistry.js';
import { createLogger, PerformanceLogger } from '@/utils/logger.js';
import { ValidationError } from '@/utils/errors.js';
import { z } from 'zod';

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
  notification: JSONRPCRequest,
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
const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.string(),
  params: z.record(z.unknown()).optional()
});

/**
 * MCP HTTP transport configuration
 */
export interface McpHttpTransportConfig {
  enableStreaming?: boolean;
  maxRequestSize?: number;
  requestTimeout?: number;
}

/**
 * Request context for MCP operations
 */
export interface McpRequestContext {
  user: JwtPayload;
  requestId: string;
  correlationId?: string;
  startTime: bigint;
}

/**
 * Custom Streamable HTTP transport for Fastify integration
 */
class FastifyStreamableTransport implements Transport {
  constructor(_config: McpHttpTransportConfig = {}) {}

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
   * Sends a message (not used in server-side HTTP transport)
   */
  async send(_message: JSONRPCRequest | JSONRPCResponse): Promise<void> {
    throw new Error('Send not supported in HTTP server transport');
  }

  /**
   * Sets request handler
   */
  onRequest(_handler: RequestHandler): void {
    // This will be called by the MCP server to register request handlers
    logger.debug('Request handler registered');
  }

  /**
   * Sets notification handler
   */
  onNotification(_handler: NotificationHandler): void {
    logger.debug('Notification handler registered');
  }

  /**
   * Sets error handler
   */
  onError(_handler: (error: Error) => void): void {
    logger.debug('Error handler registered');
  }

  /**
   * Sets close handler
   */
  onClose(_handler: () => void): void {
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
    const context: McpRequestContext = {
      user: (request as AuthenticatedRequest).user,
      requestId: request.id,
      correlationId: request.headers['x-correlation-id'] as string,
      startTime: process.hrtime.bigint()
    };

    try {
      // Validate JSON-RPC request
      const jsonRpcRequest = this.validateRequest(request.body);

      logger.info('Processing MCP request', {
        method: jsonRpcRequest.method,
        id: jsonRpcRequest.id,
        user: context.user.sub,
        requestId: context.requestId,
        correlationId: context.correlationId
      });

      // Check permissions if specified
      if (context.user.permissions) {
        this.checkPermissions(jsonRpcRequest.method, context.user.permissions);
      }

      // Process the request through MCP server
      const response = await this.processRequest(
        jsonRpcRequest,
        context,
        mcpServer
      );

      // Send response
      await reply.send(response);

      perfLogger.end('MCP request completed successfully', {
        method: jsonRpcRequest.method,
        responseSize: JSON.stringify(response).length
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
  private validateRequest(body: unknown): JSONRPCRequest {
    try {
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
    const tools = toolRegistry.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));

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
      jsonrpc: '2.0',
      id: id ?? 0,
      error: {
        code,
        message,
        data
      }
    } as unknown as JSONRPCResponse;
  }
}

/**
 * Registers MCP HTTP transport with Fastify
 */
export async function registerMcpTransport(
  app: FastifyInstance,
  mcpServer: McpServer,
  config: McpHttpTransportConfig = {}
): Promise<FastifyStreamableTransport> {
  const transport = new FastifyStreamableTransport(config);

  // Register the /messages endpoint
  app.post(
    '/messages',
    {
      preHandler: (app as any).authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['jsonrpc', 'method'],
          properties: {
            jsonrpc: { type: 'string', enum: ['2.0'] },
            id: {
              oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }]
            },
            method: { type: 'string' },
            params: { type: 'object' }
          }
        }
      }
    },
    async (request, reply) => {
      await transport.handleHttpRequest(request, reply, mcpServer);
    }
  );

  logger.info('MCP HTTP transport registered', {
    endpoint: '/messages',
    enableStreaming: config.enableStreaming
  });

  return transport;
}

/**
 * Creates a new MCP server instance with tools registered
 */
export async function createMcpServer(): Promise<McpServer> {
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
        logging: {}
      }
    }
  );

  // Register all tools from the registry
  await toolRegistry.registerWithMcpServer(server);

  logger.info('MCP server created with tools', {
    toolCount: toolRegistry.getToolCount()
  });

  return server;
}
