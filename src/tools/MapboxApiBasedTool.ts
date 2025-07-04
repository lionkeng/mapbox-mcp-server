import {
  McpServer,
  RegisteredTool
} from '@modelcontextprotocol/sdk/server/mcp';
import { z, ZodTypeAny } from 'zod';

export const OutputSchema = z.object({
  content: z.array(
    z.union([
      z.object({
        type: z.literal('text'),
        text: z.string()
      }),
      z.object({
        type: z.literal('image'),
        data: z.string(),
        mimeType: z.string()
      })
    ])
  ),
  is_error: z.boolean().default(false)
});

export abstract class MapboxApiBasedTool<InputSchema extends ZodTypeAny> {
  abstract readonly name: string;
  abstract readonly description: string;

  readonly inputSchema: InputSchema;
  protected server: McpServer | null = null;

  static get MAPBOX_ACCESS_TOKEN(): string | undefined {
    return process.env.MAPBOX_ACCESS_TOKEN;
  }
  static readonly MAPBOX_API_ENDPOINT =
    process.env.MAPBOX_API_ENDPOINT || 'https://api.mapbox.com/';

  constructor(params: { inputSchema: InputSchema }) {
    this.inputSchema = params.inputSchema;
  }

  /**
   * Validates if a string has the format of a JWT token (header.payload.signature)
   * Docs: https://docs.mapbox.com/api/accounts/tokens/#token-format
   * @param token The token string to validate
   * @returns boolean indicating if the token has valid JWT format
   */
  private isValidJwtFormat(token: string): boolean {
    // JWT consists of three parts separated by dots: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    // Check that all parts are non-empty
    return parts.every((part) => part.length > 0);
  }

  /**
   * Validates and runs the tool logic.
   */
  async run(rawInput: unknown): Promise<z.infer<typeof OutputSchema>> {
    try {
      if (!MapboxApiBasedTool.MAPBOX_ACCESS_TOKEN) {
        throw new Error('MAPBOX_ACCESS_TOKEN is not set');
      }

      const input = this.inputSchema.parse(rawInput);
      const result = await this.execute(input);

      // Check if result is already a content object (image or text)
      if (
        result &&
        typeof result === 'object' &&
        (result.type === 'image' || result.type === 'text')
      ) {
        return {
          content: [result],
          is_error: false
        };
      }

      // Otherwise return as text
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        is_error: false
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.log(
        'error',
        `${this.name}: Error during execution: ${errorMessage}`
      );

      const isVerboseErrors = process.env.VERBOSE_ERRORS === 'true';

      return {
        content: [
          {
            type: 'text',
            text: isVerboseErrors
              ? errorMessage
              : 'Internal error has occurred.'
          }
        ],
        is_error: true
      };
    }
  }

  /**
   * Tool logic to be implemented by subclasses.
   */
  protected abstract execute(_input: z.infer<InputSchema>): Promise<any>;

  /**
   * Installs the tool to the given MCP server.
   */
  installTo(server: McpServer): RegisteredTool {
    this.server = server;
    return server.tool(
      this.name,
      this.description,
      (this.inputSchema as unknown as z.ZodObject<any>).shape,
      this.run.bind(this)
    );
  }

  /**
   * Helper method to send logging messages
   * Gracefully handles HTTP mode where logging is not available
   */
  protected log(
    level: 'debug' | 'info' | 'warning' | 'error',
    data: any
  ): void {
    if (this.server) {
      try {
        // Check if the server has a connected transport
        // In HTTP mode, the transport doesn't support bidirectional communication
        const hasConnectedTransport =
          this.server.server &&
          typeof (this.server.server as any).send === 'function';

        if (hasConnectedTransport) {
          this.server.server.sendLoggingMessage({ level, data });
        }
        // Silently ignore if no connected transport (HTTP mode)
      } catch {
        // Silently ignore all logging errors in HTTP mode
        // This is expected when using HTTP transport instead of WebSocket
      }
    }
  }
}
