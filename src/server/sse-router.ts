/**
 * SSE Router for dual-channel streaming support
 * Integrates streaming transport with Fastify HTTP server
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { AuthService, AuthConfig, StreamingScopes } from '../services/auth.js';
import {
  StreamingContext,
  EventListener
} from '../services/streaming-context.js';
import {
  StreamingEvent,
  isLlmEvent,
  isArtifactEvent,
  createLlmEvent
} from '../types/streaming-events.js';

/**
 * SSE Router configuration
 */
export interface SSERouterConfig {
  basePath?: string;
  enableCors?: boolean;
  maxConnections?: number;
  heartbeatInterval?: number;
  maxEventSize?: number;
  auth?: AuthConfig;
}

/**
 * SSE connection configuration
 */
export interface SSEConnectionConfig {
  contextId: string;
  context: StreamingContext;
  connection: SSEStream;
  filter?: (event: StreamingEvent) => boolean;
  batchSize?: number;
  batchTimeout?: number;
  heartbeatInterval?: number;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/**
 * SSE Stream interface
 */
export interface SSEStream {
  write(event: string, data?: string): void;
  end(): void;
  isClosed(): boolean;
  on?(event: 'close' | 'error', listener: (error?: Error) => void): void;
}

/**
 * SSE Connection wrapper
 */
export class SSEConnection {
  private active = true;
  private heartbeatTimer?: NodeJS.Timeout;
  private batchTimer?: NodeJS.Timeout;
  private eventQueue: StreamingEvent[] = [];
  private contextListener?: () => void;
  private eventsSent = 0;
  private backpressureDetected = false;
  private lastFlushTime = Date.now();
  private consecutiveFailures = 0;
  private stateChangeListener?: (state: string) => void;

  constructor(
    public readonly contextId: string,
    private readonly context: StreamingContext,
    private readonly stream: SSEStream,
    private readonly config: Omit<SSEConnectionConfig, 'contextId' | 'context' | 'connection'> = {}
  ) {
    this.setupEventListening();
    this.startHeartbeat();
    this.setupStreamHandlers();
  }

  /**
   * Checks if connection is active
   */
  isActive(): boolean {
    return this.active && !this.stream.isClosed();
  }

  /**
   * Closes the connection
   */
  async close(): Promise<void> {
    if (!this.active) {
      return;
    }

    this.active = false;

    // Stop timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    // Flush any pending events
    await this.flushEventQueue();

    // Unsubscribe from context
    if (this.contextListener) {
      this.contextListener();
      this.contextListener = undefined;
    }

    // Clean up state change listener
    const stateChangeListener = this.stateChangeListener;
    if (stateChangeListener) {
      this.context.off('stateChange', stateChangeListener);
      this.stateChangeListener = undefined;
    }

    // Close stream
    if (!this.stream.isClosed()) {
      this.stream.end();
    }

    if (this.config.onClose) {
      this.config.onClose();
    }
  }

  /**
   * Gets events sent count
   */
  getEventsSent(): number {
    return this.eventsSent;
  }

  /**
   * Sets up event listening from context
   */
  private setupEventListening(): void {
    this.contextListener = this.context.subscribe((event) => {
      this.handleEvent(event);
    });

    // Watch for context state changes
    this.watchContextState();
  }

  /**
   * Handles incoming events with backpressure detection
   */
  private handleEvent(event: StreamingEvent): void {
    if (!this.isActive()) {
      return;
    }

    try {
      // Backpressure detection - if queue is growing too large, drop events
      const maxQueueSize = (this.config.batchSize || 1) * 10;
      if (this.eventQueue.length >= maxQueueSize) {
        this.backpressureDetected = true;
        
        // Drop oldest non-critical events to make room
        this.eventQueue = this.eventQueue.filter((e, index) => {
          // Keep last 20% of events and all error/cancel events
          const keepThreshold = Math.floor(this.eventQueue.length * 0.8);
          return index >= keepThreshold || 
                 (isLlmEvent(e) && (e.type === 'error' || e.type === 'cancel'));
        });
        
        console.warn(`SSE Connection ${this.contextId}: Backpressure detected, dropped ${maxQueueSize - this.eventQueue.length} events`);
      } else if (this.backpressureDetected && this.eventQueue.length < maxQueueSize / 2) {
        // Recovery from backpressure
        this.backpressureDetected = false;
        console.info(`SSE Connection ${this.contextId}: Backpressure recovered`);
      }

      // Apply filter if configured
      if (this.config.filter && !this.config.filter(event)) {
        return;
      }

      // Add to queue
      this.eventQueue.push(event);

      // Batch or send immediately
      if (this.config.batchSize && this.config.batchSize > 1) {
        this.scheduleBatchFlush();
      } else {
        this.flushEventQueue().catch(error => {
          this.handleError(error);
        });
      }
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Schedules batch flush with adaptive batching and backpressure handling
   */
  private scheduleBatchFlush(): void {
    const queueSize = this.eventQueue.length;
    const batchSize = this.config.batchSize || 1;
    
    // Adaptive batching based on queue size and connection health
    let flushTimeout = this.config.batchTimeout || 100;
    
    if (queueSize > batchSize * 2) {
      // High load - reduce timeout for faster flushing
      flushTimeout = Math.max(10, flushTimeout / 4);
    } else if (queueSize > batchSize) {
      // Medium load - slightly reduce timeout
      flushTimeout = Math.max(25, flushTimeout / 2);
    }
    
    // Backpressure detection - if queue is growing too fast, flush immediately
    if (queueSize >= batchSize * 5) {
      // Emergency flush for backpressure relief
      setImmediate(() => {
        this.flushEventQueue().catch(error => {
          this.handleError(error);
        });
      });
      return;
    }
    
    if (queueSize >= batchSize) {
      // Normal batch full flush
      this.flushEventQueue().catch(error => {
        this.handleError(error);
      });
    } else if (!this.batchTimer) {
      // Schedule timeout flush with adaptive timing
      this.batchTimer = setTimeout(() => {
        this.batchTimer = undefined;
        this.flushEventQueue().catch(error => {
          this.handleError(error);
        });
      }, flushTimeout);
    }
  }

  /**
   * Flushes event queue with non-blocking serialization
   */
  private async flushEventQueue(): Promise<void> {
    if (this.eventQueue.length === 0 || !this.isActive()) {
      return;
    }

    const events = [...this.eventQueue];
    this.eventQueue = [];

    // Process events in batches to avoid blocking event loop
    const batchSize = 10;
    for (let i = 0; i < events.length; i += batchSize) {
      if (!this.isActive()) {
        break;
      }

      const batch = events.slice(i, i + batchSize);
      
      // Use setImmediate to yield control between batches
      await new Promise<void>((resolve) => {
        setImmediate(() => {
          for (const event of batch) {
            if (!this.isActive()) {
              break;
            }

            try {
              const eventType = isLlmEvent(event) ? 'llm_event' : 'artifact_event';
              
              // Perform JSON serialization in this non-blocking context
              const data = JSON.stringify(event);
              
              this.stream.write(data, eventType);
              this.eventsSent++;
              
              // Track successful flush
              this.lastFlushTime = Date.now();
              this.consecutiveFailures = 0; // Reset on success
            } catch (error) {
              this.handleError(error as Error);
              break;
            }
          }
          resolve();
        });
      });
    }
  }

  /**
   * Starts heartbeat
   */
  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval || 30000;
    
    this.heartbeatTimer = setInterval(() => {
      if (this.isActive()) {
        const heartbeat = createLlmEvent({ type: 'heartbeat' });
        this.handleEvent(heartbeat);
      }
    }, interval);
  }

  /**
   * Sets up stream event handlers
   */
  private setupStreamHandlers(): void {
    if (this.stream.on) {
      this.stream.on('close', () => {
        this.close();
      });

      this.stream.on('error', (error) => {
        this.handleError(error);
      });
    }
  }

  /**
   * Watches context state changes using event-driven approach
   */
  private watchContextState(): void {
    // Event-driven state management
    const stateChangeListener = (state: string) => {
      if (!this.isActive()) {
        return;
      }

      if (state === 'completed') {
        const statusEvent = createLlmEvent({
          type: 'status',
          status: 'completed',
          message: 'Stream completed'
        });
        this.handleEvent(statusEvent);
        this.close();
      } else if (state === 'cancelled') {
        const cancelEvent = createLlmEvent({
          type: 'cancel',
          reason: this.context.getCancelReason()
        });
        this.handleEvent(cancelEvent);
        this.close();
      }
    };

    // Subscribe to state changes and store listener reference for cleanup
    this.stateChangeListener = stateChangeListener;
    this.context.on('stateChange', this.stateChangeListener);
  }

  /**
   * Handles errors with improved tracking and recovery
   */
  private handleError(error: Error): void {
    this.consecutiveFailures++;
    
    if (this.config.onError) {
      this.config.onError(error);
    }

    // Circuit breaker pattern - close connection after too many failures
    if (this.consecutiveFailures >= 5) {
      console.error(`SSE Connection ${this.contextId}: Too many consecutive failures (${this.consecutiveFailures}), closing connection`);
      this.close();
      return;
    }

    // Emit error event if connection is still active
    if (this.isActive()) {
      try {
        const errorEvent = createLlmEvent({
          type: 'error',
          code: 'SSE_ERROR',
          message: error.message,
          details: {
            consecutiveFailures: this.consecutiveFailures,
            backpressureDetected: this.backpressureDetected
          }
        });
        
        const data = JSON.stringify(errorEvent);
        this.stream.write(data, 'llm_event');
        this.eventsSent++;
        
        // Reset failure counter on successful error event send
        this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
      } catch {
        // Failed to send error event, close connection
        console.error(`SSE Connection ${this.contextId}: Failed to send error event, closing connection`);
        this.close();
      }
    }
  }
}

/**
 * SSE Router statistics
 */
export interface SSEStatistics {
  activeConnections: number;
  totalConnections: number;
  eventsStreamed: number;
  uptime: number;
}

/**
 * Default SSE router configuration
 */
const DEFAULT_CONFIG: Required<SSERouterConfig> = {
  basePath: '/streaming',
  enableCors: false,
  maxConnections: 50,
  heartbeatInterval: 30000,
  maxEventSize: 65536,
  auth: {
    enabled: false,
    jwtSecret: undefined,
    requiredScopes: [],
    tokenHeader: 'authorization',
    allowAnonymous: true
  }
};

/**
 * SSE Router implementation
 */
export class SSERouter {
  private readonly config: Required<SSERouterConfig>;
  private readonly authService: AuthService;
  private readonly connections = new Map<string, SSEConnection>();
  private totalConnections = 0;
  private totalEventsStreamed = 0;
  private readonly startTime = Date.now();

  constructor(
    private readonly fastify: FastifyInstance,
    config: SSERouterConfig = {}
  ) {
    this.config = { 
      ...DEFAULT_CONFIG, 
      ...config,
      auth: { ...DEFAULT_CONFIG.auth, ...config.auth }
    };
    this.authService = new AuthService(this.config.auth);
  }

  /**
   * Gets router configuration
   */
  getConfig(): Required<SSERouterConfig> {
    return { ...this.config };
  }

  /**
   * Authenticates a request using the auth service
   */
  private async authenticateRequest(request: FastifyRequest) {
    const authHeader = request.headers[this.config.auth.tokenHeader || 'authorization'] as string;
    const token = this.authService.extractTokenFromHeader(authHeader);
    
    const authResult = await this.authService.authenticateToken(token || '');
    
    // Validate required scopes
    this.authService.validateScopes(authResult.scopes, this.config.auth.requiredScopes || []);
    
    return authResult;
  }

  /**
   * Creates a new SSE connection
   */
  async createConnection(config: SSEConnectionConfig): Promise<SSEConnection> {
    if (this.connections.size >= this.config.maxConnections) {
      throw new Error('Maximum connections limit reached');
    }

    if (this.connections.has(config.contextId)) {
      throw new Error(`Connection already exists for context: ${config.contextId}`);
    }

    const connection = new SSEConnection(
      config.contextId,
      config.context,
      config.connection,
      {
        filter: config.filter,
        batchSize: config.batchSize,
        batchTimeout: config.batchTimeout,
        heartbeatInterval: config.heartbeatInterval || this.config.heartbeatInterval,
        onError: config.onError,
        onClose: () => {
          this.connections.delete(config.contextId);
          if (config.onClose) {
            config.onClose();
          }
        }
      }
    );

    this.connections.set(config.contextId, connection);
    this.totalConnections++;

    return connection;
  }

  /**
   * Closes a connection by context ID
   */
  async closeConnection(contextId: string): Promise<void> {
    const connection = this.connections.get(contextId);
    if (connection) {
      await connection.close();
    }
  }

  /**
   * Gets active connections
   */
  getActiveConnections(): SSEConnection[] {
    return Array.from(this.connections.values()).filter(conn => conn.isActive());
  }

  /**
   * Gets connection by context ID
   */
  getConnection(contextId: string): SSEConnection | undefined {
    return this.connections.get(contextId);
  }

  /**
   * Gets router statistics
   */
  getStatistics(): SSEStatistics {
    this.updateStatistics();
    
    return {
      activeConnections: this.connections.size,
      totalConnections: this.totalConnections,
      eventsStreamed: this.totalEventsStreamed,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Updates statistics from connections
   */
  private updateStatistics(): void {
    let totalEvents = 0;
    for (const connection of this.connections.values()) {
      totalEvents += connection.getEventsSent();
    }
    this.totalEventsStreamed = totalEvents;
  }
}

/**
 * Creates an SSE router
 */
export function createSSERouter(
  fastify: FastifyInstance,
  config?: SSERouterConfig
): SSERouter {
  return new SSERouter(fastify, config);
}

/**
 * Registers SSE routes with Fastify
 */
export async function registerSSERoutes(
  fastify: FastifyInstance,
  config: SSERouterConfig = {}
): Promise<void> {
  const router = createSSERouter(fastify, config);
  const basePath = config.basePath || '/streaming';

  // Add CORS support if enabled
  if (config.enableCors) {
    fastify.addHook('preHandler', async (request, reply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (request.method === 'OPTIONS') {
        reply.status(200).send();
      }
    });
  }

  // SSE endpoint for receiving events
  fastify.get(`${basePath}/events/:contextId`, {
    schema: {
      params: {
        type: 'object',
        properties: {
          contextId: {
            type: 'string',
            pattern: '^[a-zA-Z0-9-_]{1,50}$'
          }
        },
        required: ['contextId']
      },
      headers: router.config.auth.enabled ? {
        type: 'object',
        properties: {
          authorization: { type: 'string' }
        },
        required: ['authorization']
      } : {}
    }
  }, async (request: FastifyRequest<{
    Params: { contextId: string };
  }>, reply: FastifyReply) => {
    // Authenticate request
    try {
      const auth = await router.authenticateRequest(request);
      
      // Check streaming read permission
      if (!router.authService.hasScope(auth.scopes, StreamingScopes.READ)) {
        reply.status(403).send({ error: 'Insufficient permissions for streaming' });
        return;
      }
    } catch (error) {
      reply.status(401).send({ error: (error as Error).message });
      return;
    }

    const { contextId } = request.params;
    
    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    });

    // Create SSE stream wrapper
    const sseStream: SSEStream = {
      write(data: string, event?: string): void {
        if (event) {
          reply.raw.write(`event: ${event}\\n`);
        }
        reply.raw.write(`data: ${data}\\n\\n`);
      },
      end(): void {
        reply.raw.end();
      },
      isClosed(): boolean {
        return reply.raw.destroyed;
      },
      on(eventName: 'close' | 'error', listener: (error?: Error) => void): void {
        reply.raw.on(eventName, (errorArg?: unknown) => {
          listener(errorArg instanceof Error ? errorArg : undefined);
        });
      }
    };

    // Handle client disconnect
    request.raw.on('close', () => {
      router.closeConnection(contextId);
    });

    // Send initial connection event
    sseStream.write(JSON.stringify({
      kind: 'llm_event',
      type: 'status',
      status: 'connected',
      message: 'SSE connection established'
    }), 'llm_event');
  });

  // Endpoint to start streaming for a context
  fastify.post(`${basePath}/start`, {
    schema: {
      body: {
        type: 'object',
        properties: {
          contextId: { type: 'string' },
          filter: { type: 'object' },
          batchSize: { type: 'number', minimum: 1, maximum: 100 },
          heartbeatInterval: { type: 'number', minimum: 1000 }
        },
        required: ['contextId']
      },
      headers: router.config.auth.enabled ? {
        type: 'object',
        properties: {
          authorization: { type: 'string' }
        },
        required: ['authorization']
      } : {}
    }
  }, async (request: FastifyRequest<{
    Body: {
      contextId: string;
      filter?: Record<string, unknown>;
      batchSize?: number;
      heartbeatInterval?: number;
    };
  }>, reply: FastifyReply) => {
    // Authenticate request
    try {
      const auth = await router.authenticateRequest(request);
      
      // Check streaming write permission for starting streams
      if (!router.authService.hasScope(auth.scopes, StreamingScopes.WRITE)) {
        reply.status(403).send({ error: 'Insufficient permissions to start streaming' });
        return;
      }
    } catch (error) {
      reply.status(401).send({ error: (error as Error).message });
      return;
    }
    const { contextId, batchSize, heartbeatInterval } = request.body;
    
    const connection = router.getConnection(contextId);
    if (!connection) {
      reply.status(404).send({ error: 'Context not found' });
      return;
    }

    reply.status(200).send({
      contextId,
      status: 'streaming_started',
      endpoint: `${basePath}/events/${contextId}`
    });
  });

  // Statistics endpoint
  fastify.get(`${basePath}/stats`, {
    schema: {
      headers: router.config.auth.enabled ? {
        type: 'object',
        properties: {
          authorization: { type: 'string' }
        },
        required: ['authorization']
      } : {}
    }
  }, async (request, reply) => {
    // Authenticate request for stats
    try {
      const auth = await router.authenticateRequest(request);
      
      // Check admin permission for stats
      if (!router.authService.hasScope(auth.scopes, StreamingScopes.ADMIN)) {
        reply.status(403).send({ error: 'Insufficient permissions to view statistics' });
        return;
      }
    } catch (error) {
      reply.status(401).send({ error: (error as Error).message });
      return;
    }

    const stats = router.getStatistics();
    reply.status(200).send(stats);
  });

  // Store router instance for access from handlers
  fastify.decorate('sseRouter', router);
}