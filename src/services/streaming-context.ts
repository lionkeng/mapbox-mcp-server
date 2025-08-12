/**
 * Streaming context for managing dual-channel event streams
 * Handles state management, event buffering, and routing
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  LlmEvent,
  ArtifactEvent,
  StreamingEvent,
  createLlmEvent,
  createArtifactEvent,
  isLlmEvent,
  isArtifactEvent,
  getEventType,
  EventSequenceManager
} from '../types/streaming-events.js';

/**
 * Streaming state enumeration
 */
export type StreamingState = 'pending' | 'active' | 'completed' | 'cancelled';

/**
 * Event listener function type
 */
export type EventListener = (event: StreamingEvent, context: StreamingContext) => void;

/**
 * Event filter function type
 */
export type EventFilter = (event: StreamingEvent) => boolean;

/**
 * Error handler function type
 */
export type ErrorHandler = (error: Error, context: StreamingContext) => void;

/**
 * Streaming options configuration
 */
export interface StreamingOptions {
  maxBufferSize?: number;      // Max events to buffer (0 = unlimited)
  enableMetrics?: boolean;      // Track performance metrics
  flushOnComplete?: boolean;    // Clear buffer when stream completes
  cancelOnError?: boolean;      // Auto-cancel on fatal errors
}

/**
 * Streaming statistics
 */
export interface StreamingStats {
  totalEvents: number;
  llmEvents: number;
  artifactEvents: number;
  eventsByType: Record<string, number>;
}

/**
 * Streaming metrics (when enabled)
 */
export interface StreamingMetrics {
  eventsEmitted: number;
  bytesProcessed: number;
  eventsPerSecond: number;
  duration: number;
}

/**
 * Pagination options for getting events
 */
export interface PaginationOptions {
  offset?: number;
  limit?: number;
  filter?: EventFilter;
}

/**
 * Default streaming options
 */
const DEFAULT_OPTIONS: Required<StreamingOptions> = {
  maxBufferSize: 100,
  enableMetrics: false,
  flushOnComplete: false,
  cancelOnError: false
};

/**
 * Streaming context implementation with event-driven architecture
 */
export class StreamingContext extends EventEmitter {
  private readonly id: string;
  private state: StreamingState = 'pending';
  private readonly options: Required<StreamingOptions>;
  private readonly sequenceManager: EventSequenceManager;
  
  // Event management
  private eventBuffer: StreamingEvent[] = [];
  private listeners: Set<EventListener> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  
  // Statistics
  private stats: StreamingStats = {
    totalEvents: 0,
    llmEvents: 0,
    artifactEvents: 0,
    eventsByType: {}
  };
  
  // Timing
  private startTime?: number;
  private endTime?: number;
  private cancelReason?: string;
  
  // Metrics (when enabled)
  private metrics?: {
    bytesProcessed: number;
    firstEventTime?: number;
    lastEventTime?: number;
  };

  constructor(options: StreamingOptions = {}) {
    super();
    this.id = randomUUID();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.sequenceManager = new EventSequenceManager();
    
    if (this.options.enableMetrics) {
      this.metrics = {
        bytesProcessed: 0
      };
    }
  }

  /**
   * Gets the context ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Gets the current state
   */
  getState(): StreamingState {
    return this.state;
  }

  /**
   * Gets the options
   */
  getOptions(): Required<StreamingOptions> {
    return { ...this.options };
  }

  /**
   * Checks if the stream is active
   */
  isActive(): boolean {
    return this.state === 'active';
  }

  /**
   * Checks if the stream is completed
   */
  isCompleted(): boolean {
    return this.state === 'completed';
  }

  /**
   * Checks if the stream is cancelled
   */
  isCancelled(): boolean {
    return this.state === 'cancelled';
  }

  /**
   * Gets the start time
   */
  getStartTime(): number | undefined {
    return this.startTime;
  }

  /**
   * Gets the duration in milliseconds
   */
  getDuration(): number | undefined {
    if (!this.startTime) return undefined;
    const endTime = this.endTime || Date.now();
    return endTime - this.startTime;
  }

  /**
   * Gets the cancellation reason
   */
  getCancelReason(): string | undefined {
    return this.cancelReason;
  }

  /**
   * Starts the streaming context
   */
  start(): void {
    if (this.state !== 'pending') {
      throw new Error(`Cannot start: stream is already ${this.state}`);
    }
    
    this.state = 'active';
    this.startTime = Date.now();
    
    if (this.metrics) {
      this.metrics.firstEventTime = undefined;
      this.metrics.lastEventTime = undefined;
    }
    
    // Emit state change for reactive listeners
    this.emit('stateChange', this.state, this);
  }

  /**
   * Completes the streaming context
   */
  complete(): void {
    if (this.state === 'completed') {
      return; // Already completed
    }
    
    if (this.state === 'cancelled') {
      throw new Error('Cannot complete: stream is already cancelled');
    }
    
    this.state = 'completed';
    this.endTime = Date.now();
    
    if (this.options.flushOnComplete) {
      this.clearBuffer();
    }
    
    // Emit state change for reactive listeners
    this.emit('stateChange', this.state, this);
    this.emit('completed', this);
  }

  /**
   * Cancels the streaming context
   */
  cancel(reason?: string): void {
    if (this.state === 'cancelled') {
      return; // Already cancelled
    }
    
    if (this.state === 'completed') {
      throw new Error('Cannot cancel: stream is already completed');
    }
    
    this.state = 'cancelled';
    this.endTime = Date.now();
    this.cancelReason = reason;
    
    // Emit state change for reactive listeners
    this.emit('stateChange', this.state, this);
    this.emit('cancelled', { reason }, this);
  }

  /**
   * Emits an LLM event
   */
  emitLlmEvent(event: Omit<LlmEvent, 'kind'>): boolean {
    if (!this.isActive()) {
      return false;
    }
    
    try {
      // Create event with sequence and timestamp but skip validation for internal use
      const fullEvent = createLlmEvent(event, this.sequenceManager, { maxEventSize: 1048576 });
      return this.emitEvent(fullEvent);
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }

  /**
   * Emits an artifact event
   */
  emitArtifactEvent(event: Omit<ArtifactEvent, 'kind'>): boolean {
    if (!this.isActive()) {
      return false;
    }
    
    try {
      // Create event with lenient validation for internal use
      const fullEvent = createArtifactEvent(event, { maxArtifactSize: 52428800 });
      return this.emitEvent(fullEvent);
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }

  /**
   * Emits a generic streaming event (alias for emit)
   */
  emitEvent(event: StreamingEvent): boolean {
    return this.emit(event);
  }

  /**
   * Emits a generic streaming event
   */
  emit(event: StreamingEvent): boolean {
    if (!this.isActive()) {
      return false;
    }
    
    try {
      // Validate event structure
      if (!event || typeof event !== 'object' || !('kind' in event)) {
        throw new Error('Invalid event structure');
      }
      
      // Add to buffer
      this.addToBuffer(event);
      
      // Update statistics
      this.updateStats(event);
      
      // Update metrics
      if (this.metrics) {
        this.updateMetrics(event);
      }
      
      // Emit via EventEmitter for reactive listeners
      this.emit('event', event, this);
      
      // Also notify legacy listeners for backwards compatibility
      this.notifyListeners(event);
      
      return true;
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }

  /**
   * Emits an error event
   */
  emitError(code: string, message: string, details?: unknown, fatal = false): void {
    const errorEvent = createLlmEvent({
      type: 'error',
      code,
      message,
      details
    }, this.sequenceManager);
    
    this.emitEvent(errorEvent);
    
    if (fatal && this.options.cancelOnError) {
      this.cancel(`Fatal error: ${message}`);
    }
  }

  /**
   * Gets the event buffer
   */
  getEventBuffer(): ReadonlyArray<StreamingEvent> {
    return [...this.eventBuffer];
  }

  /**
   * Gets events with pagination and filtering
   */
  getEvents(options: PaginationOptions = {}): StreamingEvent[] {
    const { offset = 0, limit, filter } = options;
    
    let events = [...this.eventBuffer];
    
    if (filter) {
      events = events.filter(filter);
    }
    
    if (limit !== undefined) {
      events = events.slice(offset, offset + limit);
    } else if (offset > 0) {
      events = events.slice(offset);
    }
    
    return events;
  }

  /**
   * Clears the event buffer
   */
  clearBuffer(): void {
    this.eventBuffer = [];
  }

  /**
   * Gets streaming statistics
   */
  getStats(): StreamingStats {
    return {
      ...this.stats,
      eventsByType: { ...this.stats.eventsByType }
    };
  }

  /**
   * Gets streaming metrics (if enabled)
   */
  getMetrics(): StreamingMetrics | null {
    if (!this.options.enableMetrics || !this.metrics) {
      return null;
    }
    
    const duration = this.getDuration() || 0;
    const eventsPerSecond = duration > 0 
      ? (this.stats.totalEvents / duration) * 1000 
      : 0;
    
    return {
      eventsEmitted: this.stats.totalEvents,
      bytesProcessed: this.metrics.bytesProcessed,
      eventsPerSecond,
      duration
    };
  }

  /**
   * Subscribes to events (legacy interface for backward compatibility)
   */
  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribes to specific event types using EventEmitter pattern
   */
  on(event: 'event', listener: (event: StreamingEvent, context: StreamingContext) => void): this;
  on(event: 'stateChange', listener: (state: StreamingState, context: StreamingContext) => void): this;
  on(event: 'completed', listener: (context: StreamingContext) => void): this;
  on(event: 'cancelled', listener: (data: { reason?: string }, context: StreamingContext) => void): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  /**
   * Registers an error handler
   */
  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  /**
   * Checks if has events of a specific type
   */
  hasEventType(type: string): boolean {
    return this.eventBuffer.some(event => {
      if (isLlmEvent(event)) {
        return event.type === type;
      }
      return type === 'artifact';
    });
  }

  /**
   * Gets the last event of a specific type
   */
  getLastEventOfType(type: string): StreamingEvent | undefined {
    for (let i = this.eventBuffer.length - 1; i >= 0; i--) {
      const event = this.eventBuffer[i];
      if (isLlmEvent(event) && event.type === type) {
        return event;
      }
      if (type === 'artifact' && isArtifactEvent(event)) {
        return event;
      }
    }
    return undefined;
  }

  /**
   * Converts to JSON representation
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      state: this.state,
      stats: this.getStats(),
      events: this.eventBuffer,
      startTime: this.startTime,
      duration: this.getDuration(),
      cancelReason: this.cancelReason
    };
  }

  /**
   * Adds event to buffer with size management
   */
  private addToBuffer(event: StreamingEvent): void {
    this.eventBuffer.push(event);
    
    // Apply buffer size limit if configured
    if (this.options.maxBufferSize > 0 && 
        this.eventBuffer.length > this.options.maxBufferSize) {
      // FIFO eviction - remove oldest events
      const evictCount = this.eventBuffer.length - this.options.maxBufferSize;
      this.eventBuffer.splice(0, evictCount);
    }
  }

  /**
   * Updates statistics
   */
  private updateStats(event: StreamingEvent): void {
    this.stats.totalEvents++;
    
    if (isLlmEvent(event)) {
      this.stats.llmEvents++;
      const type = event.type;
      this.stats.eventsByType[type] = (this.stats.eventsByType[type] || 0) + 1;
    } else if (isArtifactEvent(event)) {
      this.stats.artifactEvents++;
      this.stats.eventsByType['artifact'] = (this.stats.eventsByType['artifact'] || 0) + 1;
    }
  }

  /**
   * Updates metrics asynchronously to avoid blocking event loop
   */
  private updateMetrics(event: StreamingEvent): void {
    if (!this.metrics) return;
    
    const now = Date.now();
    
    if (!this.metrics.firstEventTime) {
      this.metrics.firstEventTime = now;
    }
    this.metrics.lastEventTime = now;
    
    // Schedule async byte calculation to avoid blocking
    setImmediate(() => {
      if (!this.metrics) return;
      
      // Estimate bytes without expensive JSON.stringify in hot path
      // Use approximation based on event structure
      let estimatedBytes = 0;
      
      if (isLlmEvent(event)) {
        // Base LLM event size estimation
        estimatedBytes = 150; // Base overhead for kind, type, seq, timestamp
        
        // Add field-specific estimates
        if (event.type === 'progress') {
          estimatedBytes += 50;
        } else if (event.type === 'route_segment') {
          estimatedBytes += 500 + (event.steps?.length || 0) * 100;
        } else if (event.type === 'poi_batch') {
          estimatedBytes += 200 + (event.items?.length || 0) * 150;
        } else if (event.type === 'error') {
          estimatedBytes += (event.message?.length || 0) * 2 + 100;
        }
        
      } else if (isArtifactEvent(event)) {
        // Artifact events are typically smaller JSON footprint
        estimatedBytes = 200 + (event.uri?.length || 0) * 2;
      }
      
      this.metrics.bytesProcessed += estimatedBytes;
    });
  }

  /**
   * Notifies all listeners
   */
  private notifyListeners(event: StreamingEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event, this);
      } catch (error) {
        // Silently catch listener errors to prevent disruption
        console.error('Listener error:', error);
      }
    }
  }

  /**
   * Handles errors
   */
  private handleError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error, this);
      } catch {
        // Silently catch handler errors
      }
    }
  }
}

/**
 * Factory function to create a streaming context
 */
export function createStreamingContext(options?: StreamingOptions): StreamingContext {
  return new StreamingContext(options);
}