/**
 * Tool registry for managing MCP tools across different transports
 * Provides a unified interface for registering and executing tools
 */
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
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
 * Tool execution function type
 */
type ToolExecuteFunction = (
  input: Record<string, unknown>
) => Promise<CallToolResult>;

/**
 * Zod error issue type
 */
interface ZodErrorIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

/**
 * Internal tool info that extends MCP Tool with execution capability
 */
interface InternalToolInfo {
  tool: Tool;
  execute: ToolExecuteFunction;
  permissions: string[];
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
  private tools = new Map<string, InternalToolInfo>();
  private toolInstances = new Map<string, MapboxApiBasedTool<any>>();
  private toolExecutors = new Map<string, ToolExecuteFunction>();

  /**
   * Static mapping of tool names to their required permissions
   */
  private static readonly TOOL_PERMISSIONS: Record<string, string[]> = {
    // Tool names from error logs - using actual tool.name values
    forward_geocode_tool: ['mapbox:geocode'],
    reverse_geocode_tool: ['mapbox:geocode'],
    directions_tool: ['mapbox:directions'],
    isochrone_tool: ['mapbox:isochrone'],
    matrix_tool: ['mapbox:matrix'],
    poi_search_tool: ['mapbox:poi'],
    category_search_tool: ['mapbox:poi'],
    static_map_image_tool: ['mapbox:static-images'],
    version_tool: ['mapbox:info'],

    // Legacy class names for backward compatibility
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
  private registerToolInstance(toolInstance: MapboxApiBasedTool<any>): void {
    // Convert Zod schema to JSON Schema for MCP compliance
    const inputSchema = this.zodToJsonSchema(toolInstance.inputSchema);

    // Create MCP-compliant Tool object
    const tool: Tool = {
      name: toolInstance.name,
      description: toolInstance.description,
      inputSchema
    };

    // Create execute function that converts result to CallToolResult
    const execute: ToolExecuteFunction = async (
      input: Record<string, unknown>
    ) => {
      const result = await toolInstance.run(input);
      return this.convertToCallToolResult(result);
    };

    // Store tool info internally
    const toolInfo: InternalToolInfo = {
      tool,
      execute,
      permissions: this.getToolPermissions(toolInstance.name)
    };

    this.tools.set(toolInstance.name, toolInfo);
    this.toolInstances.set(toolInstance.name, toolInstance);
    this.toolExecutors.set(toolInstance.name, execute);
  }

  /**
   * Converts Zod schema to JSON Schema format for MCP compliance
   */
  private zodToJsonSchema(zodSchema: z.ZodTypeAny): {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  } {
    const jsonSchema = zodToJsonSchema(zodSchema, {
      $refStrategy: 'none'
    });

    // Ensure the schema has the required structure
    if (
      typeof jsonSchema === 'object' &&
      jsonSchema !== null &&
      'type' in jsonSchema
    ) {
      return jsonSchema as {
        type: 'object';
        properties?: Record<string, unknown>;
        required?: string[];
      };
    }

    // Fallback to basic structure
    return {
      type: 'object' as const,
      properties: {},
      required: []
    };
  }

  /**
   * Converts our internal result format to MCP CallToolResult
   */
  private convertToCallToolResult(result: any): CallToolResult {
    // Map is_error to isError (MCP standard)
    const callToolResult: CallToolResult = {
      content: result.content || [],
      _meta: {}
    };

    if (result.is_error !== undefined) {
      callToolResult.isError = result.is_error;
    }

    return callToolResult;
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
  listTools(): Array<Tool & { permissions?: string[] }> {
    return Array.from(this.tools.values()).map((toolInfo) => {
      const result: Tool & { permissions?: string[] } = {
        ...toolInfo.tool
      };

      if (toolInfo.permissions.length > 0) {
        result.permissions = toolInfo.permissions;
      }

      return result;
    });
  }

  /**
   * Gets a tool definition by name
   */
  getTool(name: string): Tool | undefined {
    const toolInfo = this.tools.get(name);
    return toolInfo?.tool;
  }

  /**
   * Executes a tool with the given input and context
   */
  async executeTool(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext = {}
  ): Promise<CallToolResult> {
    const perfLogger = new PerformanceLogger(
      'tool-registry',
      `execute-${name}`
    );

    try {
      const toolInfo = this.tools.get(name);
      if (!toolInfo) {
        throw new ValidationError(`Tool not found: ${name}`);
      }

      // Check permissions
      if (toolInfo.permissions.length > 0 && context.permissions) {
        this.checkPermissions(toolInfo.permissions, context.permissions);
      }

      logger.info('Executing tool', {
        name,
        userId: context.userId,
        requestId: context.requestId,
        correlationId: context.correlationId
      });

      // Execute the tool
      const result = await toolInfo.execute(input);

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

    for (const [name, toolInfo] of this.tools) {
      const category = toolInfo.permissions[0]?.split(':')[1] || 'unknown';
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
  validateToolInput(
    name: string,
    input: Record<string, unknown>
  ): Record<string, unknown> {
    const toolInstance = this.toolInstances.get(name);
    if (!toolInstance) {
      throw new ValidationError(`Tool not found: ${name}`);
    }

    try {
      // Use the tool instance's Zod schema for validation
      return toolInstance.inputSchema.parse(input);
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
