/**
 * Unit tests for streaming transport extension
 * Testing SSE support and streaming capabilities in HTTP transport
 */

import {
  StreamingTransport,
  StreamingCapabilities,
  StreamingRequest,
  StreamingResponse,
  createStreamingTransport,
  isStreamingSupported,
  StreamingMode
} from '../../../transport/streaming-transport';
import { createStreamingContext } from '../../../services/streaming-context';
import { createLlmEvent, createArtifactEvent } from '../../../types/streaming-events';

// Mock SSE implementation for testing
class MockSSEStream {
  private events: Array<{ event?: string; data: string }> = [];
  private closed = false;

  send(data: string, event?: string): void {
    if (this.closed) {
      throw new Error('Stream is closed');
    }
    this.events.push({ event, data });
  }

  close(): void {
    this.closed = true;
  }

  isClosed(): boolean {
    return this.closed;
  }

  getEvents(): Array<{ event?: string; data: string }> {
    return [...this.events];
  }
}

describe('Streaming Transport Extension', () => {
  let transport: StreamingTransport;
  let sseStream: MockSSEStream;

  beforeEach(() => {
    sseStream = new MockSSEStream();
    transport = createStreamingTransport({
      baseTransport: 'http',
      enableStreaming: true,
      sseStream
    });
  });

  afterEach(() => {
    if (!sseStream.isClosed()) {
      sseStream.close();
    }
  });

  describe('Capabilities', () => {
    it('should report streaming capabilities', () => {
      const capabilities = transport.getCapabilities();
      
      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.supportsDualChannel).toBe(true);
      expect(capabilities.maxEventSize).toBeGreaterThan(0);
      expect(capabilities.supportedModes).toContain('sse');
    });

    it('should check if streaming is supported', () => {
      expect(isStreamingSupported(transport)).toBe(true);
    });

    it('should handle non-streaming transport', () => {
      const nonStreamingTransport = createStreamingTransport({
        baseTransport: 'http',
        enableStreaming: false
      });
      
      expect(isStreamingSupported(nonStreamingTransport)).toBe(false);
    });
  });

  describe('Streaming Request Handling', () => {
    it('should create streaming request with context', () => {
      const context = createStreamingContext();
      const request: StreamingRequest = {
        method: 'tools/execute',
        params: {
          tool: 'directions_tool',
          arguments: { origin: 'A', destination: 'B' }
        },
        streaming: {
          enabled: true,
          mode: 'sse',
          context
        }
      };

      const prepared = transport.prepareStreamingRequest(request);
      
      expect(prepared.headers).toHaveProperty('Accept', 'text/event-stream');
      expect(prepared.headers).toHaveProperty('X-Streaming-Mode', 'sse');
      expect(prepared.streaming).toBeDefined();
      expect(prepared.streaming?.context).toBe(context);
    });

    it('should handle request without streaming', () => {
      const request: StreamingRequest = {
        method: 'tools/list',
        params: {}
      };

      const prepared = transport.prepareStreamingRequest(request);
      
      expect(prepared.headers).not.toHaveProperty('Accept', 'text/event-stream');
      expect(prepared.streaming).toBeUndefined();
    });

    it('should validate streaming mode', () => {
      const request: StreamingRequest = {
        method: 'tools/execute',
        params: {},
        streaming: {
          enabled: true,
          mode: 'invalid' as StreamingMode
        }
      };

      expect(() => transport.prepareStreamingRequest(request))
        .toThrow('Unsupported streaming mode: invalid');
    });
  });

  describe('SSE Stream Management', () => {
    it('should open SSE stream for streaming response', async () => {
      const context = createStreamingContext();
      context.start();

      const response: StreamingResponse = {
        streaming: true,
        context,
        channel: 'sse'
      };

      await transport.openStream(response);
      
      expect(transport.isStreamOpen()).toBe(true);
      expect(sseStream.isClosed()).toBe(false);
    });

    it('should send LLM events through SSE', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse'
      });

      const event = createLlmEvent({
        type: 'progress',
        pct: 50
      });

      await transport.sendEvent(event);
      
      const sentEvents = sseStream.getEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].event).toBe('llm_event');
      
      const data = JSON.parse(sentEvents[0].data);
      expect(data.type).toBe('progress');
      expect(data.pct).toBe(50);
    });

    it('should send artifact events through SSE', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse'
      });

      const event = createArtifactEvent({
        id: 'artifact-123',
        uri: 'https://example.com/artifact',
        mime: 'image/png',
        bytes: 1024
      });

      await transport.sendEvent(event);
      
      const sentEvents = sseStream.getEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].event).toBe('artifact_event');
      
      const data = JSON.parse(sentEvents[0].data);
      expect(data.id).toBe('artifact-123');
      expect(data.bytes).toBe(1024);
    });

    it('should batch multiple events', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse',
        batchSize: 3
      });

      // Send 5 events
      for (let i = 0; i < 5; i++) {
        await transport.sendEvent(createLlmEvent({
          type: 'progress',
          pct: i * 20
        }));
      }

      // Should batch events
      await transport.flush();
      
      const sentEvents = sseStream.getEvents();
      expect(sentEvents.length).toBeGreaterThan(0);
    });

    it('should close stream properly', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse'
      });

      expect(transport.isStreamOpen()).toBe(true);
      
      await transport.closeStream();
      
      expect(transport.isStreamOpen()).toBe(false);
      expect(sseStream.isClosed()).toBe(true);
    });

    it('should handle stream errors', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse'
      });

      // Force close the SSE stream to simulate error
      sseStream.close();

      const event = createLlmEvent({ type: 'progress', pct: 50 });
      
      await expect(transport.sendEvent(event))
        .rejects.toThrow('Stream is closed');
    });
  });

  describe('Event Routing', () => {
    it('should route events based on type', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse',
        routing: {
          llmEvents: true,
          artifactEvents: false
        }
      });

      const llmEvent = createLlmEvent({ type: 'progress', pct: 50 });
      const artifactEvent = createArtifactEvent({
        id: 'test',
        uri: 'http://test',
        mime: 'image/png',
        bytes: 100
      });

      await transport.sendEvent(llmEvent);
      await transport.sendEvent(artifactEvent);
      
      const sentEvents = sseStream.getEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].event).toBe('llm_event');
    });

    it('should apply event filters', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse',
        filter: (event) => {
          if (event.kind === 'llm_event' && event.type === 'progress') {
            return event.pct >= 50;
          }
          return true;
        }
      });

      await transport.sendEvent(createLlmEvent({ type: 'progress', pct: 25 }));
      await transport.sendEvent(createLlmEvent({ type: 'progress', pct: 50 }));
      await transport.sendEvent(createLlmEvent({ type: 'progress', pct: 75 }));
      
      const sentEvents = sseStream.getEvents();
      expect(sentEvents).toHaveLength(2);
    });
  });

  describe('Heartbeat and Keep-Alive', () => {
    it('should send heartbeat events', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse',
        heartbeatInterval: 100
      });

      // Wait for heartbeat
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const sentEvents = sseStream.getEvents();
      const heartbeatEvents = sentEvents.filter(e => {
        const data = JSON.parse(e.data);
        return data.type === 'heartbeat';
      });
      
      expect(heartbeatEvents.length).toBeGreaterThan(0);
      
      // Clean up
      await transport.closeStream();
    });

    it('should stop heartbeat on stream close', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse',
        heartbeatInterval: 50
      });

      await transport.closeStream();
      
      const eventCountBefore = sseStream.getEvents().length;
      await new Promise(resolve => setTimeout(resolve, 100));
      const eventCountAfter = sseStream.getEvents().length;
      
      expect(eventCountAfter).toBe(eventCountBefore);
    });
  });

  describe('Error Handling', () => {
    it('should emit error events on failures', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse'
      });

      const error = new Error('Test error');
      await transport.sendError('TEST_ERROR', error.message);
      
      const sentEvents = sseStream.getEvents();
      expect(sentEvents).toHaveLength(1);
      
      const data = JSON.parse(sentEvents[0].data);
      expect(data.type).toBe('error');
      expect(data.code).toBe('TEST_ERROR');
      expect(data.message).toBe('Test error');
    });

    it('should handle connection drops', async () => {
      const context = createStreamingContext();
      context.start();

      const onDisconnect = jest.fn();
      
      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse',
        onDisconnect
      });

      // Simulate connection drop
      sseStream.close();
      await transport.handleDisconnect();
      
      expect(onDisconnect).toHaveBeenCalled();
      expect(transport.isStreamOpen()).toBe(false);
    });
  });

  describe('Integration with Streaming Context', () => {
    it('should sync with context state', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse'
      });

      // Subscribe to context events
      const listener = jest.fn();
      context.subscribe(listener);

      const event = createLlmEvent({ type: 'progress', pct: 50 });
      context.emit(event);

      // Event should be sent through transport
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const sentEvents = sseStream.getEvents();
      expect(sentEvents.length).toBeGreaterThan(0);
      
      await transport.closeStream();
    });

    it('should handle context completion', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse'
      });

      context.complete();
      
      // Should send final event and close stream
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const sentEvents = sseStream.getEvents();
      const finalEvent = sentEvents.find(e => {
        const data = JSON.parse(e.data);
        return data.type === 'final_result' || data.type === 'status';
      });
      
      expect(finalEvent).toBeDefined();
    });

    it('should handle context cancellation', async () => {
      const context = createStreamingContext();
      context.start();

      await transport.openStream({
        streaming: true,
        context,
        channel: 'sse'
      });

      context.cancel('User cancelled');
      
      // Should send cancel event and close stream
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const sentEvents = sseStream.getEvents();
      const cancelEvent = sentEvents.find(e => {
        const data = JSON.parse(e.data);
        return data.type === 'cancel';
      });
      
      expect(cancelEvent).toBeDefined();
    });
  });
});