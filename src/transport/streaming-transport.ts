/**
 * Streaming transport extension for dual-channel streaming support
 * Provides SSE capabilities for HTTP transport
 */

import {
  StreamingContext,
  EventListener
} from '../services/streaming-context.js';
import {
  StreamingEvent,
  LlmEvent,
  ArtifactEvent,
  createLlmEvent,
  isLlmEvent,
  isArtifactEvent
} from '../types/streaming-events.js';

/**
 * Streaming mode enumeration
 */
export type StreamingMode = 'sse' | 'websocket' | 'long-polling';

/**
 * Streaming capabilities
 */
export interface StreamingCapabilities {
  supportsStreaming: boolean;
  supportsDualChannel: boolean;
  maxEventSize: number;
  supportedModes: StreamingMode[];
}

/**
 * Streaming configuration for a request
 */
export interface StreamingConfig {
  enabled: boolean;
  mode?: StreamingMode;
  context?: StreamingContext;
}

/**
 * Streaming request interface
 */
export interface StreamingRequest {
  method: string;
  params: Record<string, unknown>;
  streaming?: StreamingConfig;
}

/**
 * Prepared streaming request with headers
 */
export interface PreparedStreamingRequest {
  method: string;
  params: Record<string, unknown>;
  headers: Record<string, string>;
  streaming?: StreamingConfig;
}

/**
 * Streaming response interface
 */
export interface StreamingResponse {
  streaming: boolean;
  context: StreamingContext;
  channel: string;
  batchSize?: number;
  routing?: {
    llmEvents?: boolean;
    artifactEvents?: boolean;
  };
  filter?: (event: StreamingEvent) => boolean;
  heartbeatInterval?: number;
  onDisconnect?: () => void;
}

/**
 * SSE stream interface (abstraction for testing)
 */
export interface SSEStream {
  send(data: string, event?: string): void;
  close(): void;
  isClosed(): boolean;
}

/**
 * Transport configuration
 */
export interface TransportConfig {
  baseTransport: string;
  enableStreaming: boolean;
  sseStream?: SSEStream;
}

/**
 * Streaming transport implementation
 */
export class StreamingTransport {
  private readonly config: TransportConfig;
  private sseStream?: SSEStream;
  private streamOpen = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private heartbeatCheckTimer?: NodeJS.Timeout; // New: separate timer for fallback checks
  private eventQueue: StreamingEvent[] = [];
  private batchSize = 1;
  private routing = {
    llmEvents: true,
    artifactEvents: true
  };
  private filter?: (event: StreamingEvent) => boolean;
  private contextListener?: () => void;
  private currentContext?: StreamingContext;
  private onDisconnectHandler?: () => void;
  private stateChangeListener?: (state: string) => void;
  private backpressureDetected = false;
  private lastFlushTime = Date.now();
  private consecutiveFailures = 0;
  private batchTimer?: NodeJS.Timeout;

  constructor(config: TransportConfig) {
    this.config = config;
    this.sseStream = config.sseStream;
  }

  /**
   * Gets streaming capabilities
   */
  getCapabilities(): StreamingCapabilities {
    if (!this.config.enableStreaming) {
      return {
        supportsStreaming: false,
        supportsDualChannel: false,
        maxEventSize: 0,
        supportedModes: []
      };
    }

    return {
      supportsStreaming: true,
      supportsDualChannel: true,
      maxEventSize: 65536, // 64KB per event
      supportedModes: ['sse'] // Currently only SSE is implemented
    };
  }

  /**
   * Prepares a streaming request
   */
  prepareStreamingRequest(request: StreamingRequest): PreparedStreamingRequest {
    const headers: Record<string, string> = {};
    
    if (request.streaming?.enabled) {
      const mode = request.streaming.mode || 'sse';
      
      if (!this.getCapabilities().supportedModes.includes(mode)) {
        throw new Error(`Unsupported streaming mode: ${mode}`);
      }
      
      if (mode === 'sse') {
        headers['Accept'] = 'text/event-stream';
        headers['X-Streaming-Mode'] = 'sse';
      }
    }

    return {
      method: request.method,
      params: request.params,
      headers,
      streaming: request.streaming
    };
  }

  /**
   * Opens a streaming connection
   */
  async openStream(response: StreamingResponse): Promise<void> {
    if (this.streamOpen) {
      throw new Error('Stream is already open');
    }

    if (!this.sseStream) {
      throw new Error('SSE stream not configured');
    }

    this.streamOpen = true;
    this.currentContext = response.context;
    this.batchSize = response.batchSize || 1;
    this.routing = response.routing || { llmEvents: true, artifactEvents: true };
    this.filter = response.filter;
    this.onDisconnectHandler = response.onDisconnect;

    // Subscribe to context events
    if (response.context) {
      this.contextListener = response.context.subscribe((event) => {
        this.handleContextEvent(event);
      });

      // Watch for context state changes
      this.watchContextState(response.context, response.onDisconnect);
    }

    // Start heartbeat if configured
    if (response.heartbeatInterval) {
      this.startHeartbeat(response.heartbeatInterval);
    }
  }

  /**
   * Sends an event through the stream with backpressure handling
   */
  async sendEvent(event: StreamingEvent): Promise<void> {
    if (!this.streamOpen || !this.sseStream) {
      throw new Error('Stream is not open');
    }

    if (this.sseStream.isClosed()) {
      throw new Error('Stream is closed');
    }

    try {
      // Apply routing rules
      if (!this.shouldRouteEvent(event)) {
        return;
      }

      // Apply filter
      if (this.filter && !this.filter(event)) {
        return;
      }

      // Backpressure detection - if queue is growing too large, drop events
      const maxQueueSize = this.batchSize * 10;
      if (this.eventQueue.length >= maxQueueSize) {
        this.backpressureDetected = true;
        
        // Drop oldest non-critical events to make room
        this.eventQueue = this.eventQueue.filter((e, index) => {
          // Keep last 20% of events and all error/cancel events
          const keepThreshold = Math.floor(this.eventQueue.length * 0.8);
          return index >= keepThreshold || 
                 (isLlmEvent(e) && (e.type === 'error' || e.type === 'cancel'));
        });
        
        console.warn(`Streaming Transport: Backpressure detected, dropped ${maxQueueSize - this.eventQueue.length} events`);
      } else if (this.backpressureDetected && this.eventQueue.length < maxQueueSize / 2) {
        // Recovery from backpressure
        this.backpressureDetected = false;
        console.info('Streaming Transport: Backpressure recovered');
      }

      // Add to queue for batching
      this.eventQueue.push(event);

      // Smart batching with adaptive flushing
      if (this.batchSize > 1) {
        this.scheduleBatchFlush();
      } else {
        // Immediate flush for batch size 1
        await this.flushQueue();
      }
    } catch (error) {
      this.handleStreamError(error as Error);
      throw error;
    }
  }

  /**
   * Sends an error event
   */
  async sendError(code: string, message: string): Promise<void> {
    const errorEvent = createLlmEvent({
      type: 'error',
      code,
      message
    });

    await this.sendEvent(errorEvent);
  }

  /**
   * Flushes the event queue
   */
  async flush(): Promise<void> {
    await this.flushQueue();
  }

  /**
   * Closes the stream with proper cleanup
   */
  async closeStream(): Promise<void> {
    if (!this.streamOpen) {
      return;
    }

    this.streamOpen = false; // Set early to prevent new operations

    // Stop all timers immediately to prevent accumulation
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.heartbeatCheckTimer) {
      clearInterval(this.heartbeatCheckTimer);
      this.heartbeatCheckTimer = undefined;
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    // Unsubscribe from context events properly
    if (this.contextListener) {
      this.contextListener();
      this.contextListener = undefined;
    }

    // Remove state change listener if it exists
    if (this.stateChangeListener && this.currentContext) {
      this.currentContext.off('stateChange', this.stateChangeListener);
      this.stateChangeListener = undefined;
    }

    // Flush any remaining events
    await this.flushQueue();

    // Close SSE stream
    if (this.sseStream && !this.sseStream.isClosed()) {
      this.sseStream.close();
    }

    // Clear all references
    this.currentContext = undefined;
    this.onDisconnectHandler = undefined;
  }

  /**
   * Checks if stream is open
   */
  isStreamOpen(): boolean {
    return this.streamOpen;
  }

  /**
   * Handles disconnection with proper cleanup
   */
  async handleDisconnect(): Promise<void> {
    const wasOpen = this.streamOpen;
    this.streamOpen = false;
    
    // Clear all timers to prevent memory leaks
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    
    if (this.heartbeatCheckTimer) {
      clearInterval(this.heartbeatCheckTimer);
      this.heartbeatCheckTimer = undefined;
    }
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    
    // Clean up event listeners
    if (this.stateChangeListener && this.currentContext) {
      this.currentContext.off('stateChange', this.stateChangeListener);
      this.stateChangeListener = undefined;
    }
    
    // Notify disconnect handler if stream was open
    if (wasOpen && this.onDisconnectHandler) {
      this.onDisconnectHandler();
    }
  }

  /**
   * Checks if event should be routed
   */
  private shouldRouteEvent(event: StreamingEvent): boolean {
    if (isLlmEvent(event)) {
      return this.routing.llmEvents !== false;
    }
    if (isArtifactEvent(event)) {
      return this.routing.artifactEvents !== false;
    }
    return true;
  }

  /**
   * Handles events from context
   */
  private handleContextEvent(event: StreamingEvent): void {
    // Send event through stream asynchronously
    this.sendEvent(event).catch(error => {
      console.error('Failed to send context event:', error);
    });
  }

  /**
   * Watches context state changes using event-driven approach
   */
  private watchContextState(context: StreamingContext, onDisconnect?: () => void): void {
    // Event-driven state management - immediate response to changes
    const stateChangeListener = async (state: string) => {
      if (!this.streamOpen || this.sseStream?.isClosed()) {
        return;
      }

      if (state === 'completed') {
        // Send both final_result and status events
        const finalResultEvent = createLlmEvent({
          type: 'final_result',
          message: 'Stream completed'
        });
        await this.sendEvent(finalResultEvent);
        
        const statusEvent = createLlmEvent({
          type: 'status',
          status: 'completed',
          message: 'Stream completed successfully'
        });
        await this.sendEvent(statusEvent);
        
        await this.closeStream();
      } else if (state === 'cancelled') {
        // Send cancel event
        const cancelEvent = createLlmEvent({
          type: 'cancel',
          reason: context.getCancelReason()
        });
        await this.sendEvent(cancelEvent);
        
        await this.closeStream();
        if (onDisconnect) {
          onDisconnect();
        }
      }
    };

    // Subscribe to state changes and store listener reference for cleanup
    this.stateChangeListener = stateChangeListener;
    context.on('stateChange', this.stateChangeListener);

    // Fallback heartbeat check (much less frequent - only for safety)
    this.heartbeatCheckTimer = setInterval(() => {
      if (!this.streamOpen || this.sseStream?.isClosed()) {
        if (this.heartbeatCheckTimer) {
          clearInterval(this.heartbeatCheckTimer);
          this.heartbeatCheckTimer = undefined;
        }
        if (this.stateChangeListener) {
          context.off('stateChange', this.stateChangeListener);
          this.stateChangeListener = undefined;
        }
      }
    }, 5000); // 5 seconds instead of 100ms - 50x reduction in timer calls
  }

  /**
   * Starts heartbeat timer
   */
  private startHeartbeat(interval: number): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.streamOpen && !this.sseStream?.isClosed()) {
        const heartbeat = createLlmEvent({ type: 'heartbeat' });
        this.sendEvent(heartbeat).catch(() => {
          // Ignore heartbeat errors
        });
      }
    }, interval);
  }

  /**
   * Schedules batch flush with adaptive batching and backpressure handling
   */
  private scheduleBatchFlush(): void {
    const queueSize = this.eventQueue.length;
    
    // Adaptive batching based on queue size and connection health
    let flushTimeout = 100; // Default batch timeout
    
    if (queueSize > this.batchSize * 2) {
      // High load - reduce timeout for faster flushing
      flushTimeout = Math.max(10, flushTimeout / 4);
    } else if (queueSize > this.batchSize) {
      // Medium load - slightly reduce timeout
      flushTimeout = Math.max(25, flushTimeout / 2);
    }
    
    // Backpressure detection - if queue is growing too fast, flush immediately
    if (queueSize >= this.batchSize * 5) {
      // Emergency flush for backpressure relief
      setImmediate(() => {
        this.flushQueue().catch(error => {
          this.handleStreamError(error);
        });
      });
      return;
    }
    
    if (queueSize >= this.batchSize) {
      // Normal batch full flush
      this.flushQueue().catch(error => {
        this.handleStreamError(error);
      });
    } else if (!this.batchTimer) {
      // Schedule timeout flush with adaptive timing
      this.batchTimer = setTimeout(() => {
        this.batchTimer = undefined;
        this.flushQueue().catch(error => {
          this.handleStreamError(error);
        });
      }, flushTimeout);
    }
  }

  /**
   * Flushes the event queue with non-blocking serialization and error handling
   */
  private async flushQueue(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }

    if (!this.sseStream || this.sseStream.isClosed()) {
      this.eventQueue = [];
      return;
    }

    const eventsToFlush = [...this.eventQueue];
    this.eventQueue = [];

    // Process events in batches to avoid blocking event loop
    const processBatchSize = 10;
    for (let i = 0; i < eventsToFlush.length; i += processBatchSize) {
      if (!this.streamOpen || this.sseStream?.isClosed()) {
        break;
      }

      const batch = eventsToFlush.slice(i, i + processBatchSize);
      
      // Use setImmediate to yield control between batches
      await new Promise<void>((resolve) => {
        setImmediate(() => {
          for (const event of batch) {
            if (!this.streamOpen || this.sseStream?.isClosed()) {
              break;
            }

            try {
              const eventType = isLlmEvent(event) ? 'llm_event' : 'artifact_event';
              
              // Perform JSON serialization in this non-blocking context
              const data = JSON.stringify(event);
              
              this.sseStream!.send(data, eventType);
              
              // Track successful flush
              this.lastFlushTime = Date.now();
              this.consecutiveFailures = 0; // Reset on success
            } catch (error) {
              this.handleStreamError(error as Error);
              break;
            }
          }
          resolve();
        });
      });
    }
  }

  /**
   * Handles streaming errors with circuit breaker pattern
   */
  private handleStreamError(error: Error): void {
    this.consecutiveFailures++;
    
    console.error(`Streaming Transport Error (${this.consecutiveFailures} consecutive):`, error.message);
    
    // Circuit breaker pattern - close stream after too many failures
    if (this.consecutiveFailures >= 5) {
      console.error('Streaming Transport: Too many consecutive failures, closing stream');
      this.closeStream().catch(() => {
        // Ignore cleanup errors
      });
      return;
    }
    
    // Try to send error event if stream is still active
    if (this.streamOpen && this.sseStream && !this.sseStream.isClosed()) {
      try {
        const errorEvent = createLlmEvent({
          type: 'error',
          code: 'STREAM_ERROR',
          message: error.message,
          details: {
            consecutiveFailures: this.consecutiveFailures,
            backpressureDetected: this.backpressureDetected
          }
        });
        
        const data = JSON.stringify(errorEvent);
        this.sseStream.send(data, 'llm_event');
        
        // Reset failure counter on successful error event send
        this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
      } catch {
        // Failed to send error event, close stream
        console.error('Streaming Transport: Failed to send error event, closing stream');
        this.closeStream().catch(() => {
          // Ignore cleanup errors
        });
      }
    }
  }
}

/**
 * Creates a streaming transport
 */
export function createStreamingTransport(config: TransportConfig): StreamingTransport {
  return new StreamingTransport(config);
}

/**
 * Checks if transport supports streaming
 */
export function isStreamingSupported(transport: StreamingTransport): boolean {
  return transport.getCapabilities().supportsStreaming;
}