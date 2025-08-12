/**
 * Unit tests for SSE router integration
 * Testing SSE endpoint routing for dual-channel streaming
 */

import { FastifyInstance } from 'fastify';
import { EventEmitter } from 'events';
import {
  SSERouter,
  createSSERouter,
  SSERouterConfig,
  SSEConnection,
  registerSSERoutes
} from '../../../server/sse-router';
import { createStreamingContext } from '../../../services/streaming-context';
import { createLlmEvent, createArtifactEvent } from '../../../types/streaming-events';

// Mock Fastify SSE implementation
class MockSSEConnection extends EventEmitter {
  private closed = false;
  private events: Array<{ event?: string; data: string }> = [];

  write(event: string, data?: string): void {
    if (this.closed) {
      throw new Error('Connection closed');
    }
    
    if (data) {
      this.events.push({ event, data });
    } else {
      this.events.push({ data: event });
    }
  }

  end(): void {
    this.closed = true;
    this.emit('close');
  }

  isClosed(): boolean {
    return this.closed;
  }

  getEvents(): Array<{ event?: string; data: string }> {
    return [...this.events];
  }
}

// Mock Fastify instance
const createMockFastify = () => {
  const connections = new Map<string, MockSSEConnection>();
  
  return {
    get: jest.fn(),
    post: jest.fn(),
    addHook: jest.fn(),
    decorateRequest: jest.fn(),
    register: jest.fn(),
    connections
  } as unknown as FastifyInstance;
};

describe('SSE Router', () => {
  let router: SSERouter;
  let fastify: FastifyInstance;
  let connection: MockSSEConnection;

  beforeEach(() => {
    fastify = createMockFastify();
    connection = new MockSSEConnection();
    
    const config: SSERouterConfig = {
      basePath: '/api/v1',
      enableCors: true,
      maxConnections: 100,
      heartbeatInterval: 30000
    };

    router = createSSERouter(fastify, config);
  });

  afterEach(() => {
    if (!connection.isClosed()) {
      connection.end();
    }
  });

  describe('Router Configuration', () => {
    it('should create router with default configuration', () => {
      const defaultRouter = createSSERouter(fastify);
      expect(defaultRouter).toBeDefined();
      expect(defaultRouter.getConfig().basePath).toBe('/streaming');
      expect(defaultRouter.getConfig().enableCors).toBe(false);
      expect(defaultRouter.getConfig().maxConnections).toBe(50);
    });

    it('should apply custom configuration', () => {
      const config: SSERouterConfig = {
        basePath: '/custom/streaming',
        enableCors: true,
        maxConnections: 200,
        heartbeatInterval: 60000
      };

      const customRouter = createSSERouter(fastify, config);
      const appliedConfig = customRouter.getConfig();
      
      expect(appliedConfig.basePath).toBe('/custom/streaming');
      expect(appliedConfig.enableCors).toBe(true);
      expect(appliedConfig.maxConnections).toBe(200);
      expect(appliedConfig.heartbeatInterval).toBe(60000);
      expect(appliedConfig.maxEventSize).toBe(65536); // Default value
    });

    it('should register routes with Fastify', async () => {
      await registerSSERoutes(fastify, {
        basePath: '/test',
        enableCors: true
      });

      expect(fastify.get).toHaveBeenCalled();
      expect(fastify.post).toHaveBeenCalled();
      expect(fastify.addHook).toHaveBeenCalled();
    });
  });

  describe('Connection Management', () => {
    it('should create new SSE connection', async () => {
      const contextId = 'ctx-123';
      const context = createStreamingContext();
      
      const sseConnection = await router.createConnection({
        contextId,
        context,
        connection
      });

      expect(sseConnection).toBeDefined();
      expect(sseConnection.contextId).toBe(contextId);
      expect(sseConnection.isActive()).toBe(true);
    });

    it('should track active connections', async () => {
      const context1 = createStreamingContext();
      const context2 = createStreamingContext();
      const conn1 = new MockSSEConnection();
      const conn2 = new MockSSEConnection();

      await router.createConnection({
        contextId: 'ctx-1',
        context: context1,
        connection: conn1
      });

      await router.createConnection({
        contextId: 'ctx-2',
        context: context2,
        connection: conn2
      });

      const activeConnections = router.getActiveConnections();
      expect(activeConnections).toHaveLength(2);
      expect(activeConnections.map(c => c.contextId)).toContain('ctx-1');
      expect(activeConnections.map(c => c.contextId)).toContain('ctx-2');

      // Clean up
      conn1.end();
      conn2.end();
    });

    it('should close connection', async () => {
      const context = createStreamingContext();
      const sseConnection = await router.createConnection({
        contextId: 'ctx-close',
        context,
        connection
      });

      expect(sseConnection.isActive()).toBe(true);
      
      await router.closeConnection('ctx-close');
      
      expect(sseConnection.isActive()).toBe(false);
      expect(connection.isClosed()).toBe(true);
    });

    it('should handle connection limit', async () => {
      const limitedRouter = createSSERouter(fastify, { maxConnections: 2 });
      const connections = [];

      // Create maximum allowed connections
      for (let i = 0; i < 2; i++) {
        const conn = new MockSSEConnection();
        const context = createStreamingContext();
        
        await limitedRouter.createConnection({
          contextId: `ctx-${i}`,
          context,
          connection: conn
        });
        
        connections.push(conn);
      }

      // Try to create one more connection (should fail)
      const extraConn = new MockSSEConnection();
      const extraContext = createStreamingContext();
      
      await expect(limitedRouter.createConnection({
        contextId: 'ctx-extra',
        context: extraContext,
        connection: extraConn
      })).rejects.toThrow('Maximum connections limit reached');

      // Clean up
      connections.forEach(c => c.end());
      extraConn.end();
    });

    it('should remove connection on client disconnect', async () => {
      const context = createStreamingContext();
      const sseConnection = await router.createConnection({
        contextId: 'ctx-disconnect',
        context,
        connection
      });

      expect(router.getActiveConnections()).toHaveLength(1);
      
      // Simulate client disconnect
      connection.end();
      
      // Give it a moment to process the disconnect
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(router.getActiveConnections()).toHaveLength(0);
      expect(sseConnection.isActive()).toBe(false);
    });
  });

  describe('Event Streaming', () => {
    it('should stream LLM events through SSE', async () => {
      const context = createStreamingContext();
      context.start();
      
      const sseConnection = await router.createConnection({
        contextId: 'ctx-stream',
        context,
        connection
      });

      const event = createLlmEvent({
        type: 'progress',
        pct: 50,
        message: 'Processing request'
      });

      context.emit(event);
      
      // Give it a moment to process the event
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const sentEvents = connection.getEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].event).toBe('llm_event');
      
      const data = JSON.parse(sentEvents[0].data);
      expect(data.type).toBe('progress');
      expect(data.pct).toBe(50);
    });

    it('should stream artifact events through SSE', async () => {
      const context = createStreamingContext();
      context.start();
      
      const sseConnection = await router.createConnection({
        contextId: 'ctx-artifact',
        context,
        connection
      });

      const event = createArtifactEvent({
        id: 'map-12345',
        uri: 'https://api.example.com/artifacts/map-12345',
        mime: 'image/png',
        bytes: 512000
      });

      context.emit(event);
      
      // Give it a moment to process the event
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const sentEvents = connection.getEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].event).toBe('artifact_event');
      
      const data = JSON.parse(sentEvents[0].data);
      expect(data.id).toBe('map-12345');
      expect(data.bytes).toBe(512000);
    });

    it('should handle event routing filters', async () => {
      const context = createStreamingContext();
      context.start();
      
      const sseConnection = await router.createConnection({
        contextId: 'ctx-filter',
        context,
        connection,
        filter: (event) => {
          // Only allow progress events >= 50%
          return event.kind === 'llm_event' && 
                 event.type === 'progress' && 
                 event.pct >= 50;
        }
      });

      // Send events that should be filtered out
      context.emit(createLlmEvent({ type: 'progress', pct: 25 }));
      context.emit(createLlmEvent({ type: 'error', message: 'Test error' }));
      
      // Send event that should pass filter
      context.emit(createLlmEvent({ type: 'progress', pct: 75 }));
      
      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const sentEvents = connection.getEvents();
      expect(sentEvents).toHaveLength(1);
      
      const data = JSON.parse(sentEvents[0].data);
      expect(data.type).toBe('progress');
      expect(data.pct).toBe(75);
    });

    it('should batch events when configured', async () => {
      const context = createStreamingContext();
      context.start();
      
      const sseConnection = await router.createConnection({
        contextId: 'ctx-batch',
        context,
        connection,
        batchSize: 3,
        batchTimeout: 100
      });

      // Send multiple events
      for (let i = 0; i < 5; i++) {
        context.emit(createLlmEvent({
          type: 'progress',
          pct: i * 20
        }));
      }
      
      // Wait for batch timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const sentEvents = connection.getEvents();
      expect(sentEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Heartbeat and Keep-Alive', () => {
    it('should send heartbeat events', async () => {
      const context = createStreamingContext();
      context.start();
      
      const sseConnection = await router.createConnection({
        contextId: 'ctx-heartbeat',
        context,
        connection,
        heartbeatInterval: 100
      });

      // Wait for heartbeat
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const sentEvents = connection.getEvents();
      const heartbeatEvents = sentEvents.filter(e => {
        try {
          const data = JSON.parse(e.data);
          return data.type === 'heartbeat';
        } catch {
          return false;
        }
      });
      
      expect(heartbeatEvents.length).toBeGreaterThan(0);
    });

    it('should stop heartbeat on connection close', async () => {
      const context = createStreamingContext();
      context.start();
      
      const sseConnection = await router.createConnection({
        contextId: 'ctx-heartbeat-stop',
        context,
        connection,
        heartbeatInterval: 50
      });

      // Close connection
      await router.closeConnection('ctx-heartbeat-stop');
      
      const eventCountBefore = connection.getEvents().length;
      
      // Wait and check no new events
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const eventCountAfter = connection.getEvents().length;
      expect(eventCountAfter).toBe(eventCountBefore);
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors gracefully', async () => {
      const context = createStreamingContext();
      context.start();
      
      const errorHandler = jest.fn();
      
      const sseConnection = await router.createConnection({
        contextId: 'ctx-error',
        context,
        connection,
        onError: errorHandler
      });

      // Force an error by closing connection and trying to write
      connection.end();
      
      const event = createLlmEvent({ type: 'progress', pct: 50 });
      context.emit(event);
      
      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should emit error events for invalid data', async () => {
      const context = createStreamingContext();
      context.start();
      
      const sseConnection = await router.createConnection({
        contextId: 'ctx-invalid',
        context,
        connection
      });

      // Try to emit invalid event
      const invalidEvent = { invalid: 'data' } as any;
      context.emit(invalidEvent);
      
      // Should emit error event
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const sentEvents = connection.getEvents();
      const errorEvent = sentEvents.find(e => {
        try {
          const data = JSON.parse(e.data);
          return data.type === 'error';
        } catch {
          return false;
        }
      });
      
      expect(errorEvent).toBeDefined();
    });

    it('should handle context cancellation', async () => {
      const context = createStreamingContext();
      context.start();
      
      const sseConnection = await router.createConnection({
        contextId: 'ctx-cancel',
        context,
        connection
      });

      context.cancel('User requested cancellation');
      
      // Should send cancel event and close connection
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const sentEvents = connection.getEvents();
      const cancelEvent = sentEvents.find(e => {
        try {
          const data = JSON.parse(e.data);
          return data.type === 'cancel';
        } catch {
          return false;
        }
      });
      
      expect(cancelEvent).toBeDefined();
      expect(sseConnection.isActive()).toBe(false);
    });
  });

  describe('Route Handlers', () => {
    it('should register GET route for SSE connection', async () => {
      await registerSSERoutes(fastify, {
        basePath: '/streaming'
      });

      expect(fastify.get).toHaveBeenCalledWith(
        '/streaming/events/:contextId',
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should register POST route for starting stream', async () => {
      await registerSSERoutes(fastify, {
        basePath: '/streaming'
      });

      expect(fastify.post).toHaveBeenCalledWith(
        '/streaming/start',
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle CORS preflight requests', async () => {
      await registerSSERoutes(fastify, {
        basePath: '/streaming',
        enableCors: true
      });

      // Should register OPTIONS handler for CORS
      expect(fastify.addHook).toHaveBeenCalledWith(
        'preHandler',
        expect.any(Function)
      );
    });

    it('should validate context ID format', async () => {
      await registerSSERoutes(fastify, {});

      // Should register validation schema
      expect(fastify.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          schema: expect.objectContaining({
            params: expect.any(Object)
          })
        }),
        expect.any(Function)
      );
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track connection statistics', async () => {
      const context1 = createStreamingContext();
      const context2 = createStreamingContext();
      const conn1 = new MockSSEConnection();
      const conn2 = new MockSSEConnection();

      await router.createConnection({
        contextId: 'stats-1',
        context: context1,
        connection: conn1
      });

      await router.createConnection({
        contextId: 'stats-2',
        context: context2,
        connection: conn2
      });

      const stats = router.getStatistics();
      
      expect(stats.activeConnections).toBe(2);
      expect(stats.totalConnections).toBe(2);
      expect(stats.eventsStreamed).toBeGreaterThanOrEqual(0);

      // Clean up
      conn1.end();
      conn2.end();
    });

    it('should track events streamed', async () => {
      const context = createStreamingContext();
      context.start();
      
      await router.createConnection({
        contextId: 'stats-events',
        context,
        connection
      });

      const initialStats = router.getStatistics();
      
      // Emit some events
      context.emit(createLlmEvent({ type: 'progress', pct: 25 }));
      context.emit(createLlmEvent({ type: 'progress', pct: 50 }));
      context.emit(createArtifactEvent({
        id: 'test',
        uri: 'http://test',
        mime: 'image/png',
        bytes: 1000
      }));

      await new Promise(resolve => setTimeout(resolve, 20));
      
      const finalStats = router.getStatistics();
      
      expect(finalStats.eventsStreamed).toBeGreaterThan(initialStats.eventsStreamed);
    });
  });
});