import { parseArgs } from 'node:util';
import { getEnv } from '@/config/environment.js';
import { configLogger } from '@/utils/logger.js';
import {
  TransportConfig,
  StdioTransportConfig,
  HttpTransportConfig
} from '@/types/transport.js';

/**
 * CLI argument configuration
 */
interface CliArgs {
  http: boolean;
  port: string;
  host: string;
  help: boolean;
  version: boolean;
  metrics: boolean;
  cors: boolean;
}

/**
 * CLI parsing result types
 */
export type CliAction = 'help' | 'version' | 'run';

export interface CliResult {
  action: CliAction;
  data?: string;
  config?: TransportConfig;
  exitCode?: number;
}

/**
 * Available CLI options with descriptions
 */
function getCliOptions() {
  const env = getEnv();
  return {
    http: {
      type: 'boolean' as const,
      default: false,
      description: 'Use HTTP transport instead of stdio'
    },
    port: {
      type: 'string' as const,
      default: env.PORT.toString(),
      description: 'Port to listen on for HTTP transport'
    },
    host: {
      type: 'string' as const,
      default: env.HOST,
      description: 'Host to bind to for HTTP transport'
    },
    help: {
      type: 'boolean' as const,
      default: false,
      description: 'Show help information'
    },
    version: {
      type: 'boolean' as const,
      default: false,
      description: 'Show version information'
    },
    metrics: {
      type: 'boolean' as const,
      default: false,
      description: 'Enable metrics endpoint for HTTP transport'
    },
    cors: {
      type: 'boolean' as const,
      default: true,
      description: 'Enable CORS for HTTP transport'
    }
  } satisfies Record<
    string,
    { type: 'boolean' | 'string'; default: any; description: string }
  >;
}

/**
 * Help text for CLI usage
 */
function getHelpText(): string {
  const options = getCliOptions();
  return `
Mapbox MCP Server

USAGE:
  mcp-server [OPTIONS]

OPTIONS:
  --http          ${options.http.description}
  --port <PORT>   ${options.port.description} (default: ${options.port.default})
  --host <HOST>   ${options.host.description} (default: ${options.host.default})
  --metrics       ${options.metrics.description}
  --cors          ${options.cors.description}
  --help          ${options.help.description}
  --version       ${options.version.description}

ENVIRONMENT VARIABLES:
  MCP_TRANSPORT          Transport type: 'stdio' or 'http' (default: stdio)
  PORT                   Port for HTTP transport (default: 8080)
  HOST                   Host for HTTP transport (default: 0.0.0.0)
  MAPBOX_ACCESS_TOKEN    Mapbox access token (required)
  JWT_SECRET             JWT secret for HTTP authentication (required for HTTP)
  LOG_LEVEL              Log level: trace, debug, info, warn, error (default: info)

EXAMPLES:
  # Start with stdio transport (default)
  mcp-server

  # Start with HTTP transport
  mcp-server --http

  # Start with HTTP transport on custom port
  mcp-server --http --port 3000

  # Start with HTTP transport and metrics
  mcp-server --http --metrics

  # Use environment variable
  MCP_TRANSPORT=http mcp-server
`;
}

/**
 * Version information
 */
function getVersionInfo(): string {
  const version = process.env.npm_package_version || '0.2.0';
  const nodeVersion = process.version;
  const platform = `${process.platform}-${process.arch}`;

  return `Mapbox MCP Server v${version}\nNode.js ${nodeVersion}\nPlatform: ${platform}`;
}

/**
 * Parses command line arguments safely
 */
function parseCliArgs(): CliArgs | { error: string } {
  try {
    const options = getCliOptions();
    const { values } = parseArgs({
      options: {
        http: { type: 'boolean', default: options.http.default },
        port: { type: 'string', default: options.port.default },
        host: { type: 'string', default: options.host.default },
        help: { type: 'boolean', default: options.help.default },
        version: { type: 'boolean', default: options.version.default },
        metrics: { type: 'boolean', default: options.metrics.default },
        cors: { type: 'boolean', default: options.cors.default }
      },
      allowPositionals: false,
      strict: true
    });

    return values as CliArgs;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    configLogger.error('Invalid command line arguments', {
      error: errorMessage
    });
    return {
      error: `Invalid command line arguments: ${errorMessage}\nUse --help for usage information.`
    };
  }
}

/**
 * Validates port number
 */
function validatePort(portStr: string): number {
  const port = parseInt(portStr, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port number: ${portStr}. Must be between 1 and 65535.`
    );
  }

  return port;
}

/**
 * Validates host address
 */
function validateHost(host: string): string {
  // Basic validation - could be expanded
  if (!host || host.trim().length === 0) {
    throw new Error('Host cannot be empty');
  }

  // Allow IPv4, IPv6, and hostnames
  const trimmedHost = host.trim();
  if (trimmedHost.includes(' ')) {
    throw new Error(`Invalid host: ${host}. Host cannot contain spaces.`);
  }

  return trimmedHost;
}

/**
 * Parses CLI arguments and returns the appropriate action
 */
export function parseTransportConfig(): CliResult {
  const parseResult = parseCliArgs();

  // Handle parsing errors
  if ('error' in parseResult) {
    return {
      action: 'run',
      exitCode: 1,
      data: parseResult.error
    };
  }

  const args = parseResult;

  // Handle help and version flags
  if (args.help) {
    return {
      action: 'help',
      data: getHelpText(),
      exitCode: 0
    };
  }

  if (args.version) {
    return {
      action: 'version',
      data: getVersionInfo(),
      exitCode: 0
    };
  }

  // Build transport configuration
  try {
    const config = buildTransportConfig(args);
    return {
      action: 'run',
      config,
      exitCode: 0
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      action: 'run',
      exitCode: 1,
      data: `Configuration error: ${errorMessage}\nUse --help for usage information.`
    };
  }
}

/**
 * Builds transport configuration from parsed CLI arguments
 */
function buildTransportConfig(args: CliArgs): TransportConfig {
  const env = getEnv();

  // Determine transport type
  let transportType: 'stdio' | 'http';

  if (args.http) {
    transportType = 'http';
  } else if (env.MCP_TRANSPORT === 'http') {
    transportType = 'http';
  } else {
    transportType = 'stdio';
  }

  configLogger.info('Transport selection', {
    type: transportType,
    source: args.http
      ? 'cli-flag'
      : env.MCP_TRANSPORT === 'http'
        ? 'environment'
        : 'default'
  });

  // For stdio transport, return minimal config
  if (transportType === 'stdio') {
    const stdioConfig: StdioTransportConfig = {
      type: 'stdio'
    };
    return stdioConfig;
  }

  // For HTTP transport, validate and return full config
  const port = validatePort(args.port);
  const host = validateHost(args.host);

  const config: HttpTransportConfig = {
    type: 'http',
    port,
    host,
    enableMetrics: args.metrics,
    enableCors: args.cors
  };

  configLogger.info('HTTP transport configuration', {
    port,
    host,
    enableMetrics: args.metrics,
    enableCors: args.cors
  });

  return config;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use parseTransportConfig() instead
 */
export function selectTransport(): TransportConfig {
  const result = parseTransportConfig();

  if (result.action === 'help' || result.action === 'version') {
    console.log(result.data);
    process.exit(result.exitCode || 0);
  }

  if (result.exitCode !== 0) {
    console.error(result.data);
    process.exit(result.exitCode);
  }

  if (!result.config) {
    throw new Error('No transport configuration returned');
  }

  return result.config;
}

/**
 * Validates that all required dependencies are available for the selected transport
 */
export function validateTransportDependencies(
  config: TransportConfig
): void | never {
  const env = getEnv();

  const errors: string[] = [];

  if (config.type === 'http') {
    // Validate HTTP-specific requirements
    if (!env.JWT_SECRET) {
      errors.push(
        'JWT_SECRET environment variable is required when using HTTP transport.'
      );
      errors.push('Generate a secure secret with: openssl rand -base64 32');
    } else if (env.JWT_SECRET.length < 32) {
      errors.push(
        `JWT_SECRET must be at least 32 characters long for security (current: ${env.JWT_SECRET.length}).`
      );
      errors.push('Generate a secure secret with: openssl rand -base64 32');
    }
  }

  // Validate common requirements
  if (!env.MAPBOX_ACCESS_TOKEN) {
    errors.push('MAPBOX_ACCESS_TOKEN environment variable is required.');
    errors.push(
      'Get your token from: https://account.mapbox.com/access-tokens/'
    );
  }

  if (errors.length > 0) {
    const errorMessage = errors.join('\n');
    configLogger.error('Transport dependencies validation failed', {
      transportType: config.type,
      errors
    });
    throw new Error(errorMessage);
  }

  configLogger.info('Transport dependencies validated successfully', {
    transportType: config.type
  });
}

/**
 * Logs the final transport configuration
 */
export function logTransportConfig(config: TransportConfig): void {
  const baseInfo = {
    transportType: config.type,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  };

  if (config.type === 'http') {
    configLogger.info('Starting HTTP transport', {
      ...baseInfo,
      host: config.host,
      port: config.port,
      metrics: config.enableMetrics,
      cors: config.enableCors
    });
  } else {
    configLogger.info('Starting stdio transport', baseInfo);
  }
}

/**
 * Complete transport selection and validation pipeline
 * Returns a result that can be handled without process.exit calls
 */
export function configureTransport():
  | { success: true; config: TransportConfig }
  | { success: false; error: string; exitCode: number } {
  try {
    const result = parseTransportConfig();

    if (result.action === 'help' || result.action === 'version') {
      return {
        success: false,
        error: result.data || '',
        exitCode: result.exitCode || 0
      };
    }

    if (result.exitCode !== 0 || !result.config) {
      return {
        success: false,
        error: result.data || 'Unknown configuration error',
        exitCode: result.exitCode || 1
      };
    }

    validateTransportDependencies(result.config);
    logTransportConfig(result.config);

    return {
      success: true,
      config: result.config
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
      exitCode: 1
    };
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use configureTransport() instead
 */
export function configureTransportLegacy(): TransportConfig {
  const result = configureTransport();

  if (!result.success) {
    console.error(result.error);
    process.exit(result.exitCode);
  }

  return result.config;
}
