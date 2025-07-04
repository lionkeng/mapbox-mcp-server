import pino, { Logger, LoggerOptions } from 'pino';
import { getEnv } from '@/config/environment.js';

/**
 * High-performance structured logger using Pino
 * Optimized for both development and production environments
 */

/**
 * Development-friendly log formatting
 */
const developmentTransport = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'HH:MM:ss Z',
    ignore: 'pid,hostname',
    messageFormat: '{level}: {msg}',
    errorLikeObjectKeys: ['err', 'error']
  }
};

/**
 * Gets production log configuration with lazy env access
 */
function getProductionConfig(): LoggerOptions {
  const env = getEnv();
  return {
    level: env.LOG_LEVEL,
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: 'mapbox-mcp-server'
      })
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'access_token',
        'jwt_secret',
        'mapbox_token'
      ],
      remove: true
    }
  };
}

/**
 * Gets development log configuration with lazy env access
 */
function getDevelopmentConfig(): LoggerOptions {
  const env = getEnv();
  return {
    level: env.LOG_LEVEL,
    transport: developmentTransport,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'access_token',
        'jwt_secret',
        'mapbox_token'
      ],
      remove: true
    }
  };
}

/**
 * Lazy logger initialization to avoid startup crashes
 */
let _logger: Logger | null = null;

/**
 * Gets the main logger instance with lazy initialization
 */
function getLogger(): Logger {
  if (!_logger) {
    try {
      const env = getEnv();
      _logger = pino(
        env.NODE_ENV === 'development'
          ? getDevelopmentConfig()
          : getProductionConfig()
      );
    } catch (error) {
      // Fallback to console if environment validation fails
      console.error(
        'Failed to initialize logger, falling back to console:',
        error
      );
      _logger = pino({
        level: 'info'
      });
    }
  }
  return _logger;
}

/**
 * Main logger instance with lazy initialization
 */
export const logger: Logger = new Proxy({} as Logger, {
  get(target, prop) {
    return getLogger()[prop as keyof Logger];
  }
});

/**
 * Logger interface for different components
 */
export interface ComponentLogger {
  trace: (msg: string, extra?: object) => void;
  debug: (msg: string, extra?: object) => void;
  info: (msg: string, extra?: object) => void;
  warn: (msg: string, extra?: object) => void;
  error: (msg: string | Error, extra?: object) => void;
  fatal: (msg: string | Error, extra?: object) => void;
}

// Logger cache for component loggers
const loggerCache = new Map<string, ComponentLogger>();

/**
 * Creates a child logger for a specific component with caching
 */
export function createLogger(component: string): ComponentLogger {
  // Return cached logger if available
  if (loggerCache.has(component)) {
    return loggerCache.get(component)!;
  }

  const childLogger = logger.child({ component });

  const componentLogger: ComponentLogger = {
    trace: (msg: string, extra?: object) => childLogger.trace(extra, msg),
    debug: (msg: string, extra?: object) => childLogger.debug(extra, msg),
    info: (msg: string, extra?: object) => childLogger.info(extra, msg),
    warn: (msg: string, extra?: object) => childLogger.warn(extra, msg),
    error: (msg: string | Error, extra?: object) => {
      if (msg instanceof Error) {
        childLogger.error({ err: msg, ...extra }, msg.message);
      } else {
        childLogger.error(extra, msg);
      }
    },
    fatal: (msg: string | Error, extra?: object) => {
      if (msg instanceof Error) {
        childLogger.fatal({ err: msg, ...extra }, msg.message);
      } else {
        childLogger.fatal(extra, msg);
      }
    }
  };

  // Cache the logger
  loggerCache.set(component, componentLogger);

  return componentLogger;
}

/**
 * HTTP request logger for Fastify integration
 */
export function createHttpLogger(): Logger {
  return logger.child({
    component: 'http'
  });
}

/**
 * Performance logger for measuring operation timing
 */
export class PerformanceLogger {
  private logger: ComponentLogger;
  private startTime: bigint;

  constructor(component: string, operation: string) {
    this.logger = createLogger(component);
    this.startTime = process.hrtime.bigint();
    this.logger.debug(`Starting ${operation}`);
  }

  /**
   * Logs the duration since the logger was created
   */
  end(message: string, extra?: object): void {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - this.startTime) / 1_000_000; // Convert to milliseconds

    this.logger.info(message, {
      ...extra,
      duration_ms: Math.round(duration * 100) / 100 // Round to 2 decimal places
    });
  }

  /**
   * Logs an error and the duration
   */
  error(error: string | Error, extra?: object): void {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - this.startTime) / 1_000_000;

    this.logger.error(error, {
      ...extra,
      duration_ms: Math.round(duration * 100) / 100
    });
  }
}

/**
 * Request correlation ID generator
 * Useful for tracing requests across services
 */
export function generateCorrelationId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Request logger middleware factory
 */
export function createRequestLogger(correlationId: string) {
  return createLogger('request').info('Request started', { correlationId });
}

/**
 * Lazy logger getters for common components
 * These are created on first access to avoid startup overhead
 */

let _toolLogger: ComponentLogger | null = null;
export const toolLogger = new Proxy({} as ComponentLogger, {
  get(target, prop) {
    if (!_toolLogger) _toolLogger = createLogger('mcp-tool');
    return _toolLogger[prop as keyof ComponentLogger];
  }
});

let _transportLogger: ComponentLogger | null = null;
export const transportLogger = new Proxy({} as ComponentLogger, {
  get(target, prop) {
    if (!_transportLogger) _transportLogger = createLogger('transport');
    return _transportLogger[prop as keyof ComponentLogger];
  }
});

let _serverLogger: ComponentLogger | null = null;
export const serverLogger = new Proxy({} as ComponentLogger, {
  get(target, prop) {
    if (!_serverLogger) _serverLogger = createLogger('server');
    return _serverLogger[prop as keyof ComponentLogger];
  }
});

let _authLogger: ComponentLogger | null = null;
export const authLogger = new Proxy({} as ComponentLogger, {
  get(target, prop) {
    if (!_authLogger) _authLogger = createLogger('auth');
    return _authLogger[prop as keyof ComponentLogger];
  }
});

let _mapboxLogger: ComponentLogger | null = null;
export const mapboxLogger = new Proxy({} as ComponentLogger, {
  get(target, prop) {
    if (!_mapboxLogger) _mapboxLogger = createLogger('mapbox-api');
    return _mapboxLogger[prop as keyof ComponentLogger];
  }
});

let _configLogger: ComponentLogger | null = null;
export const configLogger = new Proxy({} as ComponentLogger, {
  get(target, prop) {
    if (!_configLogger) _configLogger = createLogger('config');
    return _configLogger[prop as keyof ComponentLogger];
  }
});

/**
 * Log application startup information
 */
export function logStartup(config: {
  transport: string;
  port?: number;
  host?: string;
  logLevel: string;
}): void {
  serverLogger.info('Starting Mapbox MCP Server', {
    version: process.env.npm_package_version || '0.2.0',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    transport: config.transport,
    port: config.port,
    host: config.host,
    logLevel: config.logLevel,
    memoryUsage: process.memoryUsage()
  });
}

/**
 * Log graceful shutdown
 */
export function logShutdown(reason: string): void {
  serverLogger.info('Shutting down Mapbox MCP Server', {
    reason,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
}

/**
 * Log performance metrics
 */
export function logMetrics(metrics: {
  eventLoopLag: number;
  memoryUsage: NodeJS.MemoryUsage;
  activeConnections?: number;
  requestsPerSecond?: number;
}): void {
  serverLogger.info('Performance metrics', {
    eventLoopLag_ms: Math.round(metrics.eventLoopLag * 100) / 100,
    memoryUsage: {
      rss_mb: Math.round((metrics.memoryUsage.rss / 1024 / 1024) * 100) / 100,
      heapUsed_mb:
        Math.round((metrics.memoryUsage.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotal_mb:
        Math.round((metrics.memoryUsage.heapTotal / 1024 / 1024) * 100) / 100,
      external_mb:
        Math.round((metrics.memoryUsage.external / 1024 / 1024) * 100) / 100
    },
    activeConnections: metrics.activeConnections,
    requestsPerSecond: metrics.requestsPerSecond
  });
}

/**
 * Enhanced error logging with context
 */
export function logError(
  error: Error,
  context: {
    component: string;
    operation?: string;
    userId?: string;
    correlationId?: string;
    additionalInfo?: Record<string, unknown>;
  }
): void {
  const errorLogger = createLogger(context.component);

  errorLogger.error(error, {
    operation: context.operation,
    userId: context.userId,
    correlationId: context.correlationId,
    stack: error.stack,
    ...context.additionalInfo
  });
}

/**
 * Flush logs before application exit
 */
export async function flushLogs(): Promise<void> {
  return new Promise((resolve) => {
    logger.flush((err) => {
      if (err) {
        console.error('Error flushing logs:', err);
      }
      resolve();
    });
  });
}
