/**
 * Unit tests for streaming context
 * Testing state management, event buffering, and routing
 */

import {
  StreamingContext,
  StreamingState,
  StreamingOptions,
  createStreamingContext,
  EventListener,
  EventFilter
} from '../../../services/streaming-context';
import {
  createLlmEvent,
  createArtifactEvent,
  LlmEvent,
  ArtifactEvent,
  StreamingEvent
} from '../../../types/streaming-events';

describe('Streaming Context', () => {
  let context: StreamingContext;

  beforeEach(() => {
    context = createStreamingContext();
  });

  afterEach(() => {
    if (context.getState() === 'active') {
      context.cancel();
    }
  });

  describe('State Management', () => {
    it('should initialize with pending state', () => {
      expect(context.getState()).toBe('pending');
      expect(context.isActive()).toBe(false);
      expect(context.isCompleted()).toBe(false);
      expect(context.isCancelled()).toBe(false);
    });

    it('should transition to active state on start', () => {
      context.start();
      expect(context.getState()).toBe('active');
      expect(context.isActive()).toBe(true);
    });

    it('should transition to completed state on complete', () => {
      context.start();
      context.complete();
      expect(context.getState()).toBe('completed');
      expect(context.isCompleted()).toBe(true);
      expect(context.isActive()).toBe(false);
    });

    it('should transition to cancelled state on cancel', () => {
      context.start();
      context.cancel('User cancelled');
      expect(context.getState()).toBe('cancelled');
      expect(context.isCancelled()).toBe(true);
      expect(context.getCancelReason()).toBe('User cancelled');
    });

    it('should not allow state changes after completion', () => {
      context.start();
      context.complete();
      
      expect(() => context.start()).toThrow('Cannot start: stream is already completed');
      expect(() => context.cancel()).toThrow('Cannot cancel: stream is already completed');
    });

    it('should not allow state changes after cancellation', () => {
      context.start();
      context.cancel();
      
      expect(() => context.start()).toThrow('Cannot start: stream is already cancelled');
      expect(() => context.complete()).toThrow('Cannot complete: stream is already cancelled');
    });

    it('should track timing information', () => {
      const beforeStart = Date.now();
      context.start();
      const afterStart = Date.now();
      
      const startTime = context.getStartTime();
      expect(startTime).toBeGreaterThanOrEqual(beforeStart);
      expect(startTime).toBeLessThanOrEqual(afterStart);
      
      context.complete();
      const duration = context.getDuration();
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Event Emission', () => {
    beforeEach(() => {
      context.start();
    });

    it('should emit LLM events', () => {
      const event = createLlmEvent({
        type: 'progress',
        pct: 50
      });

      const emitted = context.emitLlmEvent(event);
      expect(emitted).toBe(true);
      
      const buffer = context.getEventBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0]).toEqual(event);
    });

    it('should emit artifact events', () => {
      const event = createArtifactEvent({
        id: 'artifact-1',
        uri: 'https://example.com/artifact',
        mime: 'image/png',
        bytes: 1024
      });

      const emitted = context.emitArtifactEvent(event);
      expect(emitted).toBe(true);
      
      const buffer = context.getEventBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0]).toEqual(event);
    });

    it('should emit generic streaming events', () => {
      const llmEvent = createLlmEvent({ type: 'heartbeat' });
      const artifactEvent = createArtifactEvent({
        id: 'test',
        uri: 'http://test',
        mime: 'text/plain',
        bytes: 100
      });

      context.emitEvent(llmEvent);
      context.emitEvent(artifactEvent);

      const buffer = context.getEventBuffer();
      expect(buffer).toHaveLength(2);
      expect(buffer[0]).toEqual(llmEvent);
      expect(buffer[1]).toEqual(artifactEvent);
    });

    it('should not emit events when not active', () => {
      context.complete();
      
      const event = createLlmEvent({ type: 'progress', pct: 100 });
      const emitted = context.emitLlmEvent(event);
      
      expect(emitted).toBe(false);
      expect(context.getEventBuffer()).toHaveLength(0);
    });

    it('should track event counts by type', () => {
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 25 }));
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 50 }));
      context.emitLlmEvent(createLlmEvent({ type: 'error', message: 'Test error' }));
      context.emitArtifactEvent(createArtifactEvent({
        id: 'test',
        uri: 'http://test',
        mime: 'image/png',
        bytes: 1000
      }));

      const stats = context.getStats();
      expect(stats.totalEvents).toBe(4);
      expect(stats.llmEvents).toBe(3);
      expect(stats.artifactEvents).toBe(1);
      expect(stats.eventsByType['progress']).toBe(2);
      expect(stats.eventsByType['error']).toBe(1);
      expect(stats.eventsByType['artifact']).toBe(1);
    });
  });

  describe('Event Buffering', () => {
    it('should buffer events with default size', () => {
      context = createStreamingContext();
      context.start();

      for (let i = 0; i < 150; i++) {
        context.emitLlmEvent({ 
          type: 'progress', 
          pct: i 
        });
      }

      const buffer = context.getEventBuffer();
      expect(buffer).toHaveLength(100); // Default max buffer size
      
      // Should keep the most recent events (FIFO eviction)
      const firstEvent = buffer[0] as LlmEvent;
      expect(firstEvent.type).toBe('progress');
      expect((firstEvent as any).pct).toBe(50); // Events 0-49 were evicted
    });

    it('should respect custom buffer size', () => {
      context = createStreamingContext({ maxBufferSize: 10 });
      context.start();

      for (let i = 0; i < 20; i++) {
        context.emitLlmEvent({ 
          type: 'progress', 
          pct: i 
        });
      }

      const buffer = context.getEventBuffer();
      expect(buffer).toHaveLength(10);
      
      // Should keep the most recent 10 events
      const firstEvent = buffer[0] as LlmEvent;
      expect((firstEvent as any).pct).toBe(10);
    });

    it('should allow disabling buffer size limit', () => {
      context = createStreamingContext({ maxBufferSize: 0 }); // 0 means unlimited
      context.start();

      for (let i = 0; i < 200; i++) {
        context.emitLlmEvent({ 
          type: 'progress', 
          pct: i 
        });
      }

      const buffer = context.getEventBuffer();
      expect(buffer).toHaveLength(200);
    });

    it('should clear buffer on reset', () => {
      context.start();
      
      context.emitLlmEvent({ type: 'progress', pct: 50 });
      context.emitLlmEvent({ type: 'progress', pct: 100 });
      
      expect(context.getEventBuffer()).toHaveLength(2);
      
      context.clearBuffer();
      expect(context.getEventBuffer()).toHaveLength(0);
    });

    it('should get paginated events from buffer', () => {
      context.start();
      
      for (let i = 0; i < 25; i++) {
        context.emitLlmEvent({ 
          type: 'progress', 
          pct: i * 4 
        });
      }

      const page1 = context.getEvents({ offset: 0, limit: 10 });
      expect(page1).toHaveLength(10);
      
      const page2 = context.getEvents({ offset: 10, limit: 10 });
      expect(page2).toHaveLength(10);
      
      const page3 = context.getEvents({ offset: 20, limit: 10 });
      expect(page3).toHaveLength(5);
    });
  });

  describe('Event Subscription', () => {
    it('should notify listeners on event emission', () => {
      const listener = jest.fn();
      context.subscribe(listener);
      context.start();

      const event = createLlmEvent({ type: 'progress', pct: 50 });
      context.emit(event);

      expect(listener).toHaveBeenCalledWith(event, context);
    });

    it('should support multiple listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      
      context.subscribe(listener1);
      context.subscribe(listener2);
      context.start();

      const event = createLlmEvent({ type: 'progress', pct: 50 });
      context.emit(event);

      expect(listener1).toHaveBeenCalledWith(event, context);
      expect(listener2).toHaveBeenCalledWith(event, context);
    });

    it('should allow unsubscribing', () => {
      const listener = jest.fn();
      const unsubscribe = context.subscribe(listener);
      context.start();

      const event1 = createLlmEvent({ type: 'progress', pct: 25 });
      context.emit(event1);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      const event2 = createLlmEvent({ type: 'progress', pct: 50 });
      context.emit(event2);
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should handle listener errors gracefully', () => {
      const goodListener = jest.fn();
      const badListener = jest.fn(() => {
        throw new Error('Listener error');
      });

      context.subscribe(badListener);
      context.subscribe(goodListener);
      context.start();

      const event = createLlmEvent({ type: 'progress', pct: 50 });
      
      // Should not throw
      expect(() => context.emit(event)).not.toThrow();
      
      // Good listener should still be called
      expect(goodListener).toHaveBeenCalledWith(event, context);
    });
  });

  describe('Event Filtering', () => {
    it('should filter events by type', () => {
      context.start();
      
      const progressEvents: LlmEvent[] = [];
      const filter: EventFilter = (event) => {
        return event.kind === 'llm_event' && event.type === 'progress';
      };

      context.subscribe((event) => {
        if (filter(event)) {
          progressEvents.push(event as LlmEvent);
        }
      });

      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 25 }));
      context.emitLlmEvent(createLlmEvent({ type: 'error', message: 'Error' }));
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 50 }));
      context.emitArtifactEvent(createArtifactEvent({
        id: 'test',
        uri: 'http://test',
        mime: 'image/png',
        bytes: 100
      }));

      expect(progressEvents).toHaveLength(2);
      expect(progressEvents[0].type).toBe('progress');
      expect(progressEvents[1].type).toBe('progress');
    });

    it('should get filtered events from buffer', () => {
      context.start();
      
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 25 }));
      context.emitLlmEvent(createLlmEvent({ type: 'error', message: 'Error' }));
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 50 }));
      context.emitArtifactEvent(createArtifactEvent({
        id: 'test',
        uri: 'http://test',
        mime: 'image/png',
        bytes: 100
      }));

      const artifactEvents = context.getEvents({
        filter: (event) => event.kind === 'artifact_event'
      });

      expect(artifactEvents).toHaveLength(1);
      expect(artifactEvents[0].kind).toBe('artifact_event');

      const progressEvents = context.getEvents({
        filter: (event) => event.kind === 'llm_event' && event.type === 'progress'
      });

      expect(progressEvents).toHaveLength(2);
    });
  });

  describe('Options and Configuration', () => {
    it('should apply custom options', () => {
      const options: StreamingOptions = {
        maxBufferSize: 50,
        enableMetrics: true,
        flushOnComplete: true
      };

      context = createStreamingContext(options);
      const appliedOptions = context.getOptions();
      
      expect(appliedOptions.maxBufferSize).toBe(50);
      expect(appliedOptions.enableMetrics).toBe(true);
      expect(appliedOptions.flushOnComplete).toBe(true);
      expect(appliedOptions.cancelOnError).toBe(false); // Default value
    });

    it('should use default options when not specified', () => {
      context = createStreamingContext();
      const options = context.getOptions();
      
      expect(options.maxBufferSize).toBe(100);
      expect(options.enableMetrics).toBe(false);
      expect(options.flushOnComplete).toBe(false);
    });

    it('should flush buffer on complete if configured', () => {
      context = createStreamingContext({ flushOnComplete: true });
      context.start();
      
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 100 }));
      expect(context.getEventBuffer()).toHaveLength(1);
      
      context.complete();
      expect(context.getEventBuffer()).toHaveLength(0);
    });
  });

  describe('Metrics and Statistics', () => {
    it('should track basic metrics', () => {
      context = createStreamingContext({ enableMetrics: true });
      context.start();

      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 25 }));
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 50 }));
      context.emitArtifactEvent(createArtifactEvent({
        id: 'map',
        uri: 'http://example.com/map',
        mime: 'image/png',
        bytes: 50000
      }));

      const metrics = context.getMetrics();
      expect(metrics.eventsEmitted).toBe(3);
      expect(metrics.bytesProcessed).toBeGreaterThan(0);
      expect(metrics.eventsPerSecond).toBeGreaterThanOrEqual(0);
    });

    it('should calculate events per second', async () => {
      context = createStreamingContext({ enableMetrics: true });
      context.start();

      // Emit events over time
      for (let i = 0; i < 10; i++) {
        context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: i * 10 }));
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const metrics = context.getMetrics();
      expect(metrics.eventsEmitted).toBe(10);
      expect(metrics.eventsPerSecond).toBeGreaterThan(0);
      expect(metrics.duration).toBeGreaterThanOrEqual(90); // At least 90ms
    });

    it('should not track metrics when disabled', () => {
      context = createStreamingContext({ enableMetrics: false });
      context.start();

      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 50 }));
      
      const metrics = context.getMetrics();
      expect(metrics).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in event emission', () => {
      context.start();
      
      const errorHandler = jest.fn();
      context.onError(errorHandler);

      // Force an error by passing invalid event
      const invalidEvent = { invalid: 'event' } as any;
      const emitted = context.emit(invalidEvent);
      
      expect(emitted).toBe(false);
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should emit error events', () => {
      context.start();
      
      const error = new Error('Test error');
      context.emitError('TEST_ERROR', error.message, error);
      
      const buffer = context.getEventBuffer();
      expect(buffer).toHaveLength(1);
      
      const errorEvent = buffer[0] as LlmEvent;
      expect(errorEvent.type).toBe('error');
      expect(errorEvent.code).toBe('TEST_ERROR');
      expect(errorEvent.message).toBe('Test error');
    });

    it('should auto-cancel on fatal errors if configured', () => {
      context = createStreamingContext({ cancelOnError: true });
      context.start();
      
      const error = new Error('Fatal error');
      context.emitError('FATAL', error.message, error, true);
      
      expect(context.isCancelled()).toBe(true);
      expect(context.getCancelReason()).toContain('Fatal error');
    });
  });

  describe('Utility Methods', () => {
    it('should generate unique context ID', () => {
      const context1 = createStreamingContext();
      const context2 = createStreamingContext();
      
      expect(context1.getId()).toBeDefined();
      expect(context2.getId()).toBeDefined();
      expect(context1.getId()).not.toBe(context2.getId());
    });

    it('should convert to JSON representation', () => {
      context.start();
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 50 }));
      
      const json = context.toJSON();
      
      expect(json.id).toBe(context.getId());
      expect(json.state).toBe('active');
      expect(json.stats.totalEvents).toBe(1);
      expect(json.events).toHaveLength(1);
    });

    it('should check if has events of specific type', () => {
      context.start();
      
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 50 }));
      context.emitLlmEvent(createLlmEvent({ type: 'error', message: 'Error' }));
      
      expect(context.hasEventType('progress')).toBe(true);
      expect(context.hasEventType('error')).toBe(true);
      expect(context.hasEventType('heartbeat')).toBe(false);
    });

    it('should get last event of specific type', () => {
      context.start();
      
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 25 }));
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 50 }));
      context.emitLlmEvent(createLlmEvent({ type: 'error', message: 'Error' }));
      context.emitLlmEvent(createLlmEvent({ type: 'progress', pct: 75 }));
      
      const lastProgress = context.getLastEventOfType('progress') as LlmEvent;
      expect(lastProgress).toBeDefined();
      expect(lastProgress.type).toBe('progress');
      expect((lastProgress as any).pct).toBe(75);
      
      const lastError = context.getLastEventOfType('error') as LlmEvent;
      expect(lastError).toBeDefined();
      expect(lastError.type).toBe('error');
    });
  });
});