/**
 * High-performance HTTP server using Fastify
 * Optimized for MCP Streamable HTTP transport with JWT authentication
 */

import fastify, {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyError
} from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyJWTOptions } from '@fastify/jwt';
import type { FastifyCorsOptions } from '@fastify/cors';
import type { RateLimitOptions } from '@fastify/rate-limit';
import { getEnv } from '@/config/environment.js';
import { HttpTransportConfig } from '@/types/transport.js';
import { AuthenticationError } from '@/utils/errors.js';
import { createHttpLogger, serverLogger, authLogger } from '@/utils/logger.js';
import { registerCleanup, getShutdownStatus } from '@/utils/shutdown.js';

/**
 * JWT payload interface
 */
export interface JwtPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  permissions?: string[];
}

/**
 * Authenticated request interface
 */
export interface AuthenticatedRequest extends FastifyRequest {
  user: JwtPayload;
}

/**
 * HTTP server configuration
 */
export interface HttpServerConfig extends HttpTransportConfig {
  jwtSecret: string;
  trustProxy?: boolean;
  requestTimeout?: number;
  bodyLimit?: number;
}

/**
 * HTTP server statistics
 */
export interface ServerStats {
  uptime: number;
  connections: {
    active: number;
    total: number;
  };
  requests: {
    total: number;
    rate: number;
  };
  memory: ReturnType<typeof process.memoryUsage>;
  eventLoopLag: number;
}

/**
 * High-performance Fastify HTTP server
 */
export class HttpServer {
  private fastify: FastifyInstance | null = null;
  private config: HttpServerConfig;
  private startTime: Date | null = null;
  private requestCount = 0;
  private eventLoopLag = 0;

  constructor(config: HttpServerConfig) {
    this.config = config;
    this.measureEventLoopLag();
  }

  /**
   * Creates and configures the Fastify instance
   */
  private async createFastifyInstance(): Promise<FastifyInstance> {
    const env = getEnv();

    const app = fastify({
      logger: {
        level: env.LOG_LEVEL,
        serializers: {
          req: (req) => ({
            method: req.method,
            url: req.url,
            headers: req.headers
          }),
          res: (res) => ({
            statusCode: res.statusCode
          })
        }
      },
      keepAliveTimeout: env.KEEP_ALIVE_TIMEOUT,
      requestTimeout: this.config.requestTimeout || env.REQUEST_TIMEOUT,
      bodyLimit: this.config.bodyLimit || 1048576, // 1MB
      trustProxy: this.config.trustProxy || true,
      ignoreTrailingSlash: true,
      ignoreDuplicateSlashes: true
    });

    // Register error handler first
    await this.registerErrorHandler(app);

    // Register JWT authentication
    await this.registerJwtAuth(app);

    // Register security middleware
    await this.registerSecurityMiddleware(app);

    // Register CORS if enabled
    if (this.config.enableCors) {
      await this.registerCors(app);
    }

    // Register rate limiting
    await this.registerRateLimit(app);

    return app;
  }

  /**
   * Registers JWT authentication
   */
  private async registerJwtAuth(app: FastifyInstance): Promise<void> {
    const jwtOptions: FastifyJWTOptions = {
      secret: this.config.jwtSecret,
      sign: {
        expiresIn: '1h',
        iss: 'mapbox-mcp-server',
        aud: 'mapbox-mcp-server'
      },
      verify: {
        allowedIss: 'mapbox-mcp-server',
        allowedAud: 'mapbox-mcp-server'
      }
    };

    await app.register(fastifyJwt, jwtOptions);

    // JWT authentication decorator
    app.decorate(
      'authenticate',
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const token = await request.jwtVerify<JwtPayload>();
          (request as AuthenticatedRequest).user = token;
        } catch (error) {
          authLogger.warn('JWT authentication failed', {
            error: error instanceof Error ? error.message : error,
            ip: request.ip,
            userAgent: request.headers['user-agent']
          });

          throw new AuthenticationError('Invalid or expired token', 'jwt', {
            ip: request.ip
          });
        }
      }
    );
  }

  /**
   * Registers security middleware
   */
  private async registerSecurityMiddleware(
    app: FastifyInstance
  ): Promise<void> {
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:']
        }
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    });
  }

  /**
   * Registers CORS middleware
   */
  private async registerCors(app: FastifyInstance): Promise<void> {
    const corsOptions: FastifyCorsOptions = {
      origin: (
        origin: string | undefined,
        callback: (error: Error | null, allow: boolean) => void
      ) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        // For development, allow localhost
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }

        // In production, be more restrictive
        const env = getEnv();
        if (env.NODE_ENV === 'production') {
          // Only allow specific origins in production
          const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
          if (allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          return callback(new Error('CORS policy violation'), false);
        }

        // Allow all in development
        return callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    };

    await app.register(fastifyCors, corsOptions);
  }

  /**
   * Registers rate limiting
   */
  private async registerRateLimit(app: FastifyInstance): Promise<void> {
    const env = getEnv();

    const rateLimitOptions: RateLimitOptions = {
      max: env.RATE_LIMIT_MAX,
      timeWindow: env.RATE_LIMIT_WINDOW,
      skipOnError: true,
      keyGenerator: (request: FastifyRequest) => {
        // Rate limit by IP and user if authenticated
        const ip = request.ip;
        const user = (request as AuthenticatedRequest).user?.sub;
        return user ? `${ip}:${user}` : ip;
      },
      errorResponseBuilder: (request: FastifyRequest, context: any) => {
        return {
          error: 'Rate limit exceeded',
          message: `Too many requests from ${request.ip}`,
          retryAfter: Math.round(context.ttl / 1000)
        };
      }
    };

    await app.register(fastifyRateLimit, rateLimitOptions);
  }

  /**
   * Registers global error handler
   */
  private async registerErrorHandler(app: FastifyInstance): Promise<void> {
    app.setErrorHandler(
      (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
        const requestId = request.id;
        const correlationId = request.headers['x-correlation-id'] as string;

        // Log error with context
        serverLogger.error(error, {
          requestId,
          correlationId,
          method: request.method,
          url: request.url,
          ip: request.ip,
          userAgent: request.headers['user-agent']
        });

        // Handle authentication errors
        if (error instanceof AuthenticationError) {
          return reply.status(401).send({
            error: 'Authentication failed',
            message: error.message,
            code: error.code
          });
        }

        // Handle Fastify validation errors
        if (error.validation) {
          return reply.status(400).send({
            error: 'Validation failed',
            message: error.message,
            details: error.validation
          });
        }

        // Handle rate limit errors
        if (error.statusCode === 429) {
          const rateLimitError = error as FastifyError & {
            retryAfter?: number;
          };
          return reply.status(429).send({
            error: 'Rate limit exceeded',
            message: 'Too many requests',
            retryAfter: rateLimitError.retryAfter
          });
        }

        // Generic error response
        const env = getEnv();
        const isDevelopment = env.NODE_ENV === 'development';

        return reply.status(error.statusCode || 500).send({
          error: 'Internal server error',
          message: isDevelopment
            ? error.message
            : 'An unexpected error occurred',
          requestId,
          ...(isDevelopment && { stack: error.stack })
        });
      }
    );
  }

  /**
   * Registers health and metrics endpoints
   */
  private async registerHealthEndpoints(app: FastifyInstance): Promise<void> {
    // Health check endpoint
    app.get(
      '/health',
      async (_request: FastifyRequest, reply: FastifyReply) => {
        const shutdownStatus = getShutdownStatus();

        if (shutdownStatus.isShuttingDown) {
          return reply.status(503).send({
            status: 'shutting_down',
            timestamp: new Date().toISOString()
          });
        }

        return reply.send({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: this.getUptime(),
          version: process.env.npm_package_version || '0.2.0'
        });
      }
    );

    // Ready check endpoint
    app.get('/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
      const shutdownStatus = getShutdownStatus();

      if (shutdownStatus.isShuttingDown) {
        return reply.status(503).send({
          status: 'not_ready',
          reason: 'shutting_down',
          timestamp: new Date().toISOString()
        });
      }

      return reply.send({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    });

    // Metrics endpoint (if enabled)
    if (this.config.enableMetrics) {
      app.get(
        '/metrics',
        async (_request: FastifyRequest, reply: FastifyReply) => {
          const stats = this.getStats();
          return reply.send(stats);
        }
      );
    }
  }

  /**
   * Measures event loop lag
   */
  private measureEventLoopLag(): void {
    global.setInterval(() => {
      const start = process.hrtime.bigint();
      global.setImmediate(() => {
        this.eventLoopLag = Number(process.hrtime.bigint() - start) / 1e6;
      });
    }, 1000);
  }

  /**
   * Request counting middleware
   */
  private registerRequestCounter(app: FastifyInstance): void {
    app.addHook('onRequest', async (_request: FastifyRequest) => {
      this.requestCount++;
    });
  }

  /**
   * Initializes the Fastify instance without starting the server
   */
  async initialize(): Promise<FastifyInstance> {
    if (this.fastify) {
      return this.fastify;
    }

    // Create Fastify instance
    this.fastify = await this.createFastifyInstance();

    // Register request counter
    this.registerRequestCounter(this.fastify);

    // Register health endpoints
    await this.registerHealthEndpoints(this.fastify);

    return this.fastify;
  }

  /**
   * Starts the HTTP server
   */
  async start(): Promise<{ address: string; port: number }> {
    if (!this.fastify) {
      throw new Error('Server not initialized. Call initialize() first');
    }

    try {
      // Start server
      const address = await this.fastify.listen({
        port: this.config.port,
        host: this.config.host
      });

      this.startTime = new Date();

      // Get the actual port that was assigned (important when port is 0)
      const serverAddress = this.fastify.server.address();
      const actualPort =
        serverAddress &&
        typeof serverAddress === 'object' &&
        'port' in serverAddress
          ? serverAddress.port
          : this.config.port;

      // Register cleanup
      registerCleanup('http-server', async () => {
        await this.stop();
      });

      serverLogger.info('HTTP server started', {
        address,
        port: actualPort,
        host: this.config.host,
        cors: this.config.enableCors,
        metrics: this.config.enableMetrics,
        environment: getEnv().NODE_ENV
      });

      return {
        address,
        port: actualPort
      };
    } catch (error) {
      serverLogger.error('Failed to start HTTP server', { error });
      throw error;
    }
  }

  /**
   * Stops the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.fastify) {
      return;
    }

    try {
      await this.fastify.close();
      this.fastify = null;
      this.startTime = null;

      serverLogger.info('HTTP server stopped');
    } catch (error) {
      serverLogger.error('Error stopping HTTP server', { error });
      throw error;
    }
  }

  /**
   * Gets server uptime in seconds
   */
  private getUptime(): number {
    return this.startTime ? (Date.now() - this.startTime.getTime()) / 1000 : 0;
  }

  /**
   * Gets server statistics
   */
  getStats(): ServerStats {
    const uptime = this.getUptime();
    const requestRate = uptime > 0 ? this.requestCount / uptime : 0;

    // Safely access server connection info
    const server = this.fastify?.server as
      | { connections?: number; connectionsCheckingTimeout?: number }
      | undefined;

    return {
      uptime,
      connections: {
        active: server?.connections || 0,
        total: server?.connectionsCheckingTimeout || 0
      },
      requests: {
        total: this.requestCount,
        rate: requestRate
      },
      memory: process.memoryUsage(),
      eventLoopLag: this.eventLoopLag
    };
  }

  /**
   * Gets the Fastify instance
   */
  getFastify(): FastifyInstance | null {
    return this.fastify;
  }

  /**
   * Checks if server is running
   */
  isRunning(): boolean {
    return this.fastify !== null && this.startTime !== null;
  }
}
