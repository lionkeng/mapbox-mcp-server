/**
 * Tool registry for managing MCP tools across different transports
 * Provides a unified interface for registering and executing tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MapboxApiBasedTool } from '../tools/MapboxApiBasedTool.js';
import { CategorySearchTool } from '../tools/category-search-tool/CategorySearchTool.js';
import { DirectionsTool } from '../tools/directions-tool/DirectionsTool.js';
import { ForwardGeocodeTool } from '../tools/forward-geocode-tool/ForwardGeocodeTool.js';
import { IsochroneTool } from '../tools/isochrone-tool/IsochroneTool.js';
import { MatrixTool } from '../tools/matrix-tool/MatrixTool.js';
import { PoiSearchTool } from '../tools/poi-search-tool/PoiSearchTool.js';
import { ReverseGeocodeTool } from '../tools/reverse-geocode-tool/ReverseGeocodeTool.js';
import { StaticMapImageTool } from '../tools/static-map-image-tool/StaticMapImageTool.js';
import { createLogger, PerformanceLogger } from '@/utils/logger.js';
import { ValidationError } from '@/utils/errors.js';

const logger = createLogger('tool-registry');

/**
 * Tool input schema type (Zod schema or JSON schema)
 */
type ToolInputSchema =
  | Record<string, unknown>
  | {
      parse: (input: unknown) => ToolInput;
    };

/**
 * Tool execution result
 */
interface ToolExecutionResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
  is_error?: boolean;
  [key: string]: unknown;
}

/**
 * Tool input type - generic object with unknown properties
 */
type ToolInput = Record<string, unknown>;

/**
 * Zod error issue type
 */
interface ZodErrorIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

/**
 * Tool definition for the registry
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute: (input: ToolInput) => Promise<ToolExecutionResult>;
  permissions?: string[];
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  userId?: string;
  requestId?: string;
  correlationId?: string;
  permissions?: string[];
}

/**
 * Tool registry for managing MCP tools
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private toolInstances = new Map<string, MapboxApiBasedTool<any>>();

  /**
   * Static mapping of tool names to their required permissions
   */
  private static readonly TOOL_PERMISSIONS: Record<string, string[]> = {
    MapboxGeocodingForward: ['mapbox:geocode'],
    MapboxGeocodingReverse: ['mapbox:geocode'],
    MapboxDirections: ['mapbox:directions'],
    MapboxIsochrone: ['mapbox:isochrone'],
    MapboxMatrix: ['mapbox:matrix'],
    MapboxPoiSearch: ['mapbox:poi'],
    MapboxCategorySearch: ['mapbox:poi'],
    MapboxStaticMap: ['mapbox:static-images']
  };

  constructor() {
    this.initializeTools();
  }

  /**
   * Initializes all available tools
   */
  private initializeTools(): void {
    const toolClasses = [
      MatrixTool,
      ReverseGeocodeTool,
      ForwardGeocodeTool,
      IsochroneTool,
      PoiSearchTool,
      CategorySearchTool,
      StaticMapImageTool,
      DirectionsTool
    ];

    for (const ToolClass of toolClasses) {
      try {
        const toolInstance = new ToolClass();
        this.registerToolInstance(toolInstance);

        logger.debug('Registered tool', {
          name: toolInstance.name,
          description: toolInstance.description
        });
      } catch (error) {
        logger.error('Failed to initialize tool', {
          toolClass: ToolClass.name,
          error: error instanceof Error ? error.message : error
        });
      }
    }

    logger.info('Tool registry initialized', {
      totalTools: this.tools.size,
      toolNames: Array.from(this.tools.keys())
    });
  }

  /**
   * Registers a tool instance
   */
  private registerToolInstance(tool: MapboxApiBasedTool<any>): void {
    const toolDefinition: ToolDefinition = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (input: ToolInput) => {
        return tool.run(input);
      },
      permissions: this.getToolPermissions(tool.name)
    };

    this.tools.set(tool.name, toolDefinition);
    this.toolInstances.set(tool.name, tool);
  }

  /**
   * Gets required permissions for a tool
   */
  private getToolPermissions(toolName: string): string[] {
    const permissions = ToolRegistry.TOOL_PERMISSIONS[toolName];
    if (!permissions) {
      logger.error('No permissions defined for tool', { toolName });
      throw new ValidationError(
        `No permissions defined for tool: ${toolName}`,
        undefined,
        {
          toolName,
          availableTools: Object.keys(ToolRegistry.TOOL_PERMISSIONS)
        }
      );
    }

    return permissions;
  }

  /**
   * Registers tools with an MCP server
   */
  async registerWithMcpServer(server: McpServer): Promise<void> {
    for (const [name, tool] of this.toolInstances) {
      try {
        tool.installTo(server);
        logger.debug('Installed tool to MCP server', { name });
      } catch (error) {
        logger.error('Failed to install tool to MCP server', {
          name,
          error: error instanceof Error ? error.message : error
        });
      }
    }

    logger.info('All tools registered with MCP server', {
      totalTools: this.toolInstances.size
    });
  }

  /**
   * Lists all available tools
   */
  listTools(): Array<{
    name: string;
    description: string;
    inputSchema: ToolInputSchema;
    permissions?: string[];
  }> {
    return Array.from(this.tools.values()).map((tool) => {
      const result: {
        name: string;
        description: string;
        inputSchema: ToolInputSchema;
        permissions?: string[];
      } = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      };

      if (tool.permissions) {
        result.permissions = tool.permissions;
      }

      return result;
    });
  }

  /**
   * Gets a tool definition by name
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Executes a tool with the given input and context
   */
  async executeTool(
    name: string,
    input: ToolInput,
    context: ToolExecutionContext = {}
  ): Promise<ToolExecutionResult> {
    const perfLogger = new PerformanceLogger(
      'tool-registry',
      `execute-${name}`
    );

    try {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new ValidationError(`Tool not found: ${name}`);
      }

      // Check permissions
      if (tool.permissions && context.permissions) {
        this.checkPermissions(tool.permissions, context.permissions);
      }

      logger.info('Executing tool', {
        name,
        userId: context.userId,
        requestId: context.requestId,
        correlationId: context.correlationId
      });

      // Execute the tool
      const result = await tool.execute(input);

      perfLogger.end('Tool execution completed', {
        name,
        resultSize: JSON.stringify(result).length
      });

      return result;
    } catch (error) {
      logger.error('Tool execution failed', {
        name,
        error: error instanceof Error ? error.message : error,
        userId: context.userId,
        requestId: context.requestId
      });

      perfLogger.error(
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Checks if user has required permissions
   */
  private checkPermissions(
    requiredPermissions: string[],
    userPermissions: string[]
  ): void {
    // Check if user has wildcard permission
    if (userPermissions.includes('mapbox:*')) {
      return;
    }

    // Check each required permission
    for (const required of requiredPermissions) {
      if (!userPermissions.includes(required)) {
        throw new ValidationError(
          `Insufficient permissions. Required: ${required}`,
          undefined,
          {
            requiredPermissions,
            userPermissions
          }
        );
      }
    }
  }

  /**
   * Gets tool statistics
   */
  getStats(): {
    totalTools: number;
    toolNames: string[];
    toolsByCategory: Record<string, string[]>;
  } {
    const toolNames = Array.from(this.tools.keys());
    const toolsByCategory: Record<string, string[]> = {};

    for (const [name, tool] of this.tools) {
      const category = tool.permissions?.[0]?.split(':')[1] || 'unknown';
      if (!toolsByCategory[category]) {
        toolsByCategory[category] = [];
      }
      toolsByCategory[category].push(name);
    }

    return {
      totalTools: this.tools.size,
      toolNames,
      toolsByCategory
    };
  }

  /**
   * Validates tool input against its schema
   */
  validateToolInput(name: string, input: ToolInput): ToolInput {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ValidationError(`Tool not found: ${name}`);
    }

    try {
      // If it's a Zod schema, use parse method
      if (
        typeof tool.inputSchema === 'object' &&
        tool.inputSchema !== null &&
        'parse' in tool.inputSchema
      ) {
        const zodSchema = tool.inputSchema as {
          parse: (input: unknown) => ToolInput;
        };
        return zodSchema.parse(input);
      } else {
        // For non-Zod schemas, just return the input as-is (basic validation)
        return input;
      }
    } catch (error) {
      if (error instanceof Error && 'issues' in error) {
        // Zod validation error
        const zodError = error as { issues: ZodErrorIssue[] };
        const errorMessage = zodError.issues
          .map(
            (issue: ZodErrorIssue) =>
              `${issue.path.join('.')}: ${issue.message}`
          )
          .join(', ');

        throw new ValidationError(
          `Invalid input for tool ${name}: ${errorMessage}`,
          zodError.issues
        );
      }
      throw error;
    }
  }

  /**
   * Checks if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Gets the count of registered tools
   */
  getToolCount(): number {
    return this.tools.size;
  }
}

/**
 * Global tool registry instance
 */
export const toolRegistry = new ToolRegistry();
