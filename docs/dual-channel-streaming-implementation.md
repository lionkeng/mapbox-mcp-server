# Dual-Channel Streaming Implementation Plan

## Executive Summary

This document outlines the complete implementation plan for adding dual-channel streaming support to the Mapbox MCP Server, enabling separation of LLM-consumable events (`llm_event`) from large binary artifacts (`artifact_event`).

## Architecture Overview

The dual-channel streaming architecture introduces:

- **LLM Event Channel**: Small, structured updates for AI model context (progress, partial results, summaries)
- **Artifact Event Channel**: Large binary/data artifacts for UI rendering (images, GeoJSON, vectors)

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)

#### 1.1 Event Type Definitions

Create new type definitions for streaming events:

```typescript
// File: src/types/streaming-events.ts

export type LlmEventType =
  | 'progress' // Progress percentage updates
  | 'partial_result' // Intermediate results (bbox, coarse polyline)
  | 'route_segment' // Individual route segments with steps
  | 'poi_batch' // Batches of POI results
  | 'final_result' // Final computation result
  | 'error' // Error events
  | 'status' // Connection/tool state updates
  | 'metadata' // Tool execution metadata
  | 'cancel' // Cancellation acknowledgment
  | 'heartbeat'; // Keep-alive signals

export interface LlmEvent {
  kind: 'llm_event';
  type: LlmEventType;
  seq?: number;
  timestamp?: string;
  [key: string]: any; // Event-specific payload
}

export interface ArtifactEvent {
  kind: 'artifact_event';
  id: string;
  uri: string;
  mime: string;
  bytes: number;
  sha256?: string;
  expires_at?: string;
  metadata?: Record<string, any>;
}

export type StreamingEvent = LlmEvent | ArtifactEvent;
```

#### 1.2 Artifact Storage Interface

Define the storage abstraction layer:

```typescript
// File: src/services/artifact-storage.ts

export interface ArtifactMetadata {
  mime: string;
  tool: string;
  userId?: string;
  requestId?: string;
  tags?: Record<string, string>;
}

export interface StoredArtifact {
  id: string;
  data: Buffer;
  metadata: ArtifactMetadata;
  createdAt: Date;
  expiresAt?: Date;
}

export interface ArtifactStorage {
  // Store artifact and return its ID
  store(data: Buffer, metadata: ArtifactMetadata): Promise<string>;

  // Get signed URL for artifact access
  getSignedUrl(artifactId: string, ttl?: number): Promise<string>;

  // Retrieve artifact data
  get(artifactId: string): Promise<StoredArtifact | null>;

  // Delete artifact
  delete(artifactId: string): Promise<void>;

  // Cleanup expired artifacts
  cleanupExpired(): Promise<number>;
}
```

### Phase 2: Transport Layer Extensions (Week 1-2)

#### 2.1 Enhanced Streaming Transport

Extend the existing transport to support dual channels:

```typescript
// File: src/server/streaming-transport.ts

import { EventEmitter } from 'events';
import {
  LlmEvent,
  ArtifactEvent,
  StreamingEvent
} from '../types/streaming-events.js';

export class StreamingContext extends EventEmitter {
  private eventSequence = 0;
  private llmEventBuffer: LlmEvent[] = [];
  private artifactEventBuffer: ArtifactEvent[] = [];

  constructor(
    private sessionId: string,
    private toolName: string,
    private maxBufferSize = 1000
  ) {
    super();
  }

  async emitLlmEvent(event: Omit<LlmEvent, 'kind' | 'seq'>): Promise<void> {
    const fullEvent: LlmEvent = {
      kind: 'llm_event',
      seq: this.eventSequence++,
      timestamp: new Date().toISOString(),
      ...event
    };

    this.bufferEvent(fullEvent);
    this.emit('llm_event', fullEvent);
  }

  async emitArtifactEvent(event: Omit<ArtifactEvent, 'kind'>): Promise<void> {
    const fullEvent: ArtifactEvent = {
      kind: 'artifact_event',
      ...event
    };

    this.bufferArtifact(fullEvent);
    this.emit('artifact_event', fullEvent);
  }

  private bufferEvent(event: LlmEvent): void {
    this.llmEventBuffer.push(event);
    if (this.llmEventBuffer.length > this.maxBufferSize) {
      this.llmEventBuffer.shift(); // FIFO eviction
    }
  }

  private bufferArtifact(event: ArtifactEvent): void {
    this.artifactEventBuffer.push(event);
    if (this.artifactEventBuffer.length > this.maxBufferSize / 10) {
      this.artifactEventBuffer.shift(); // Keep fewer artifacts
    }
  }

  getBufferedEvents(afterSeq?: number): LlmEvent[] {
    if (afterSeq === undefined) return [...this.llmEventBuffer];
    return this.llmEventBuffer.filter((e) => e.seq! > afterSeq);
  }

  getBufferedArtifacts(): ArtifactEvent[] {
    return [...this.artifactEventBuffer];
  }
}
```

#### 2.2 Modified MCP HTTP Transport

Update the transport to handle streaming:

```typescript
// Modifications to src/server/mcpHttpTransport.ts

interface EnhancedSessionInfo extends SessionInfo {
  streamingContexts: Map<string, StreamingContext>;
  dualChannelEnabled: boolean;
  artifactChannelId?: string;
}

// Add to FastifyStreamableTransport class:

private async handleStreamingToolCall(
  toolName: string,
  input: Record<string, unknown>,
  session: EnhancedSessionInfo
): Promise<void> {
  const context = new StreamingContext(session.id, toolName);
  session.streamingContexts.set(toolName, context);

  // Subscribe to events
  context.on('llm_event', (event) => {
    this.sendLlmEvent(session, event);
  });

  context.on('artifact_event', (event) => {
    this.sendArtifactEvent(session, event);
  });

  // Execute streaming tool
  const tool = this.toolRegistry.getStreamingTool(toolName);
  if (tool) {
    for await (const event of tool.executeStreaming(input, context)) {
      // Events are emitted through context
    }
  }
}

private async sendLlmEvent(session: EnhancedSessionInfo, event: LlmEvent): Promise<void> {
  const sseMessage = {
    event: 'llm_event',
    data: JSON.stringify(event),
    id: crypto.randomUUID()
  };

  session.source.push(sseMessage);
}

private async sendArtifactEvent(session: EnhancedSessionInfo, event: ArtifactEvent): Promise<void> {
  if (session.dualChannelEnabled && session.artifactChannelId) {
    // Send to separate artifact channel if configured
    const artifactSession = sessionStore.get(session.artifactChannelId);
    if (artifactSession) {
      artifactSession.source.push({
        event: 'artifact_event',
        data: JSON.stringify(event),
        id: crypto.randomUUID()
      });
    }
  } else {
    // Fallback: include reference in main channel
    session.source.push({
      event: 'artifact_reference',
      data: JSON.stringify({ id: event.id, uri: event.uri }),
      id: crypto.randomUUID()
    });
  }
}
```

### Phase 3: Artifact Storage Implementation (Week 2)

#### 3.1 Proxy Storage Implementation

Local/proxy storage for development and simple deployments:

```typescript
// File: src/services/proxy-artifact-storage.ts

import crypto from 'crypto';
import {
  ArtifactStorage,
  ArtifactMetadata,
  StoredArtifact
} from './artifact-storage.js';

export class ProxyArtifactStorage implements ArtifactStorage {
  private artifacts = new Map<string, StoredArtifact>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private baseUrl: string,
    private ttlSeconds = 3600
  ) {
    // Periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60000); // Every minute
  }

  async store(data: Buffer, metadata: ArtifactMetadata): Promise<string> {
    const id = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update(data).digest('hex');

    const artifact: StoredArtifact = {
      id,
      data,
      metadata: { ...metadata, sha256: hash },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000)
    };

    this.artifacts.set(id, artifact);
    return id;
  }

  async getSignedUrl(
    artifactId: string,
    ttl = this.ttlSeconds
  ): Promise<string> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) throw new Error(`Artifact ${artifactId} not found`);

    // Generate signed token for URL
    const token = crypto
      .createHmac('sha256', process.env.JWT_SECRET!)
      .update(`${artifactId}:${Date.now() + ttl * 1000}`)
      .digest('hex');

    return `${this.baseUrl}/artifacts/${artifactId}?token=${token}`;
  }

  async get(artifactId: string): Promise<StoredArtifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;

    // Check expiration
    if (artifact.expiresAt && artifact.expiresAt < new Date()) {
      this.artifacts.delete(artifactId);
      return null;
    }

    return artifact;
  }

  async delete(artifactId: string): Promise<void> {
    this.artifacts.delete(artifactId);
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date();
    let deleted = 0;

    for (const [id, artifact] of this.artifacts.entries()) {
      if (artifact.expiresAt && artifact.expiresAt < now) {
        this.artifacts.delete(id);
        deleted++;
      }
    }

    return deleted;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.artifacts.clear();
  }
}
```

#### 3.2 S3 Storage Implementation

Cloud storage for production deployments:

```typescript
// File: src/services/s3-artifact-storage.ts

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class S3ArtifactStorage implements ArtifactStorage {
  private s3: S3Client;

  constructor(
    private bucket: string,
    private region: string,
    private ttlSeconds = 3600
  ) {
    this.s3 = new S3Client({ region });
  }

  async store(data: Buffer, metadata: ArtifactMetadata): Promise<string> {
    const id = crypto.randomUUID();
    const key = `artifacts/${new Date().toISOString().split('T')[0]}/${id}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: metadata.mime,
        Metadata: {
          tool: metadata.tool,
          userId: metadata.userId || '',
          requestId: metadata.requestId || ''
        },
        Expires: new Date(Date.now() + this.ttlSeconds * 1000)
      })
    );

    return key;
  }

  async getSignedUrl(
    artifactId: string,
    ttl = this.ttlSeconds
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: artifactId
    });

    return getSignedUrl(this.s3, command, { expiresIn: ttl });
  }

  async get(artifactId: string): Promise<StoredArtifact | null> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: artifactId
        })
      );

      const data = await response.Body!.transformToByteArray();

      return {
        id: artifactId,
        data: Buffer.from(data),
        metadata: {
          mime: response.ContentType || 'application/octet-stream',
          tool: response.Metadata?.tool || '',
          userId: response.Metadata?.userId,
          requestId: response.Metadata?.requestId
        },
        createdAt: response.LastModified || new Date()
      };
    } catch (error) {
      return null;
    }
  }

  async delete(artifactId: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: artifactId
      })
    );
  }

  async cleanupExpired(): Promise<number> {
    // S3 lifecycle policies handle expiration
    return 0;
  }
}
```

### Phase 4: Tool Streaming Support (Week 2-3)

#### 4.1 Enhanced Base Tool Class

Update the base tool to support streaming:

```typescript
// Modifications to src/tools/MapboxApiBasedTool.ts

export abstract class MapboxApiBasedTool<InputSchema extends ZodTypeAny> {
  // Existing properties...

  protected streamingEnabled = false;

  // New streaming execution method
  async *executeStreaming(
    input: z.infer<InputSchema>,
    context: StreamingContext,
    accessToken: string
  ): AsyncGenerator<StreamingEvent> {
    // Default implementation: convert regular execution to streaming
    try {
      await context.emitLlmEvent({ type: 'progress', pct: 0 });

      const result = await this.execute(input, accessToken);

      // Check if result contains image data
      if (result?.type === 'image' && result.data) {
        // Store as artifact instead of inline
        const storage = getArtifactStorage();
        const buffer = Buffer.from(result.data, 'base64');
        const artifactId = await storage.store(buffer, {
          mime: result.mimeType,
          tool: this.name
        });

        await context.emitArtifactEvent({
          id: artifactId,
          uri: await storage.getSignedUrl(artifactId),
          mime: result.mimeType,
          bytes: buffer.byteLength
        });

        // Send summary as LLM event
        await context.emitLlmEvent({
          type: 'final_result',
          message: `Generated ${result.mimeType} image (${buffer.byteLength} bytes)`
        });
      } else {
        // Regular text result
        await context.emitLlmEvent({
          type: 'final_result',
          content: result
        });
      }

      await context.emitLlmEvent({ type: 'progress', pct: 100 });
    } catch (error) {
      await context.emitLlmEvent({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  // Check if tool supports streaming
  supportsStreaming(): boolean {
    return this.streamingEnabled;
  }
}
```

#### 4.2 DirectionsTool Streaming Implementation

Implement progressive route streaming:

```typescript
// Modifications to src/tools/directions-tool/DirectionsTool.ts

export class DirectionsTool extends MapboxApiBasedTool<
  typeof DirectionsInputSchema
> {
  protected streamingEnabled = true;

  async *executeStreaming(
    input: z.infer<typeof DirectionsInputSchema>,
    context: StreamingContext,
    accessToken: string
  ): AsyncGenerator<StreamingEvent> {
    // Initial progress
    await context.emitLlmEvent({
      type: 'progress',
      pct: 0,
      message: 'Fetching directions...'
    });

    // Build and execute request
    const url = this.buildDirectionsUrl(input, accessToken);
    const response = await fetch(url);

    if (!response.ok) {
      await context.emitLlmEvent({
        type: 'error',
        message: `API error: ${response.status} ${response.statusText}`
      });
      return;
    }

    const data = await response.json();
    await context.emitLlmEvent({ type: 'progress', pct: 30 });

    // Process route data
    const route = data.routes[0];

    // 1. Send partial result with overview
    await context.emitLlmEvent({
      type: 'partial_result',
      camera: {
        center: route.legs[0].steps[0].maneuver.location,
        zoom: 12
      },
      bbox: route.bbox,
      polyline: route.geometry,
      distance_km: (route.distance / 1000).toFixed(2),
      duration_min: Math.round(route.duration / 60)
    });

    await context.emitLlmEvent({ type: 'progress', pct: 50 });

    // 2. Stream route segments
    for (const [legIndex, leg] of route.legs.entries()) {
      await context.emitLlmEvent({
        type: 'route_segment',
        seq: legIndex,
        polyline: leg.geometry || '',
        steps: leg.steps.map((step) => ({
          instruction: step.maneuver.instruction,
          distance: step.distance,
          duration: step.duration,
          mode: step.mode
        })),
        eta: leg.duration,
        distance: leg.distance,
        summary: leg.summary
      });

      // Update progress
      const segmentProgress = 50 + ((legIndex + 1) / route.legs.length) * 30;
      await context.emitLlmEvent({
        type: 'progress',
        pct: Math.round(segmentProgress)
      });
    }

    // 3. Generate and store static map as artifact
    if (input.geometries !== 'none') {
      const mapBuffer = await this.generateRouteMap(route, input);
      const storage = getArtifactStorage();
      const mapId = await storage.store(mapBuffer, {
        mime: 'image/png',
        tool: this.name
      });

      await context.emitArtifactEvent({
        id: `route-map-${mapId}`,
        uri: await storage.getSignedUrl(mapId),
        mime: 'image/png',
        bytes: mapBuffer.byteLength,
        metadata: {
          bbox: route.bbox,
          profile: input.routing_profile
        }
      });
    }

    // 4. Store full GeoJSON as artifact if requested
    if (input.geometries === 'geojson') {
      const geojsonBuffer = Buffer.from(
        JSON.stringify({
          type: 'Feature',
          properties: {
            distance: route.distance,
            duration: route.duration,
            profile: input.routing_profile
          },
          geometry: route.geometry
        })
      );

      const geojsonId = await storage.store(geojsonBuffer, {
        mime: 'application/geo+json',
        tool: this.name
      });

      await context.emitArtifactEvent({
        id: `route-geojson-${geojsonId}`,
        uri: await storage.getSignedUrl(geojsonId),
        mime: 'application/geo+json',
        bytes: geojsonBuffer.byteLength
      });
    }

    await context.emitLlmEvent({ type: 'progress', pct: 90 });

    // 5. Send final summary
    await context.emitLlmEvent({
      type: 'final_result',
      distance_m: route.distance,
      eta_s: route.duration,
      profile: input.routing_profile,
      waypoints: route.waypoints.map((wp) => ({
        name: wp.name,
        location: wp.location
      })),
      summary: `Route found: ${(route.distance / 1000).toFixed(1)}km, ${Math.round(route.duration / 60)} minutes`
    });

    await context.emitLlmEvent({ type: 'progress', pct: 100 });
  }

  private async generateRouteMap(route: any, input: any): Promise<Buffer> {
    // Generate static map with route overlay
    const overlays = [
      {
        type: 'path',
        strokeColor: '3bb2d0',
        strokeWidth: 4,
        strokeOpacity: 0.8,
        encodedPolyline: route.geometry
      }
    ];

    // Use StaticMapImageTool internally
    const mapTool = new StaticMapImageTool();
    const mapResult = await mapTool.execute(
      {
        center: {
          longitude: route.legs[0].steps[0].maneuver.location[0],
          latitude: route.legs[0].steps[0].maneuver.location[1]
        },
        zoom: 12,
        size: { width: 800, height: 600 },
        style: 'mapbox/streets-v12',
        overlays
      },
      this.accessToken
    );

    return Buffer.from(mapResult.data, 'base64');
  }
}
```

#### 4.3 POI Search Streaming

Implement batched POI streaming:

```typescript
// Modifications to src/tools/poi-search-tool/PoiSearchTool.ts

export class PoiSearchTool extends MapboxApiBasedTool<
  typeof PoiSearchInputSchema
> {
  protected streamingEnabled = true;

  async *executeStreaming(
    input: z.infer<typeof PoiSearchInputSchema>,
    context: StreamingContext,
    accessToken: string
  ): AsyncGenerator<StreamingEvent> {
    await context.emitLlmEvent({
      type: 'progress',
      pct: 0,
      message: `Searching for "${input.query}"...`
    });

    // Execute search
    const url = this.buildSearchUrl(input, accessToken);
    const response = await fetch(url);
    const data = await response.json();

    await context.emitLlmEvent({ type: 'progress', pct: 30 });

    // Process POIs in batches
    const features = data.features || [];
    const batchSize = 10;
    const totalBatches = Math.ceil(features.length / batchSize);

    for (let i = 0; i < features.length; i += batchSize) {
      const batch = features.slice(i, i + batchSize);
      const batchIndex = Math.floor(i / batchSize);

      await context.emitLlmEvent({
        type: 'poi_batch',
        seq: batchIndex,
        items: batch.map((poi) => ({
          id: poi.id,
          name: poi.properties.name,
          coord: poi.geometry.coordinates,
          address: poi.properties.address,
          category: poi.properties.poi_category,
          distance: poi.properties.distance
        })),
        total: features.length,
        hasMore: batchIndex < totalBatches - 1
      });

      // Update progress
      const batchProgress = 30 + ((batchIndex + 1) / totalBatches) * 50;
      await context.emitLlmEvent({
        type: 'progress',
        pct: Math.round(batchProgress)
      });
    }

    // Store full GeoJSON as artifact
    const geojsonBuffer = Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features
      })
    );

    const storage = getArtifactStorage();
    const geojsonId = await storage.store(geojsonBuffer, {
      mime: 'application/geo+json',
      tool: this.name
    });

    await context.emitArtifactEvent({
      id: `pois-${geojsonId}`,
      uri: await storage.getSignedUrl(geojsonId),
      mime: 'application/geo+json',
      bytes: geojsonBuffer.byteLength,
      metadata: {
        query: input.query,
        count: features.length
      }
    });

    // Generate overview map if POIs found
    if (features.length > 0) {
      const mapBuffer = await this.generatePOIMap(features, input);
      const mapId = await storage.store(mapBuffer, {
        mime: 'image/png',
        tool: this.name
      });

      await context.emitArtifactEvent({
        id: `poi-map-${mapId}`,
        uri: await storage.getSignedUrl(mapId),
        mime: 'image/png',
        bytes: mapBuffer.byteLength
      });
    }

    await context.emitLlmEvent({ type: 'progress', pct: 90 });

    // Final summary
    await context.emitLlmEvent({
      type: 'final_result',
      query: input.query,
      total_results: features.length,
      center: input.center,
      radius: input.radius,
      summary: `Found ${features.length} results for "${input.query}"`
    });

    await context.emitLlmEvent({ type: 'progress', pct: 100 });
  }
}
```

### Phase 5: HTTP Endpoints (Week 3)

#### 5.1 Artifact Delivery Endpoint

Add artifact serving endpoint:

```typescript
// Additions to src/server/httpServer.ts

// Register artifact endpoint
app.get(
  '/artifacts/:id',
  {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        }
      }
    }
  },
  async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };

    // Validate token if provided
    if (token) {
      try {
        const payload = jwt.verify(token, env.JWT_SECRET) as any;
        if (payload.artifactId !== id || payload.exp < Date.now() / 1000) {
          return reply.status(403).send({ error: 'Invalid or expired token' });
        }
      } catch {
        return reply.status(403).send({ error: 'Invalid token' });
      }
    } else {
      // Require authentication for non-token access
      await app.authenticate(request, reply);
    }

    // Retrieve artifact
    const storage = getArtifactStorage();
    const artifact = await storage.get(id);

    if (!artifact) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    // Set appropriate headers
    reply
      .header('Content-Type', artifact.metadata.mime)
      .header('Content-Length', artifact.data.byteLength)
      .header('Cache-Control', 'public, max-age=3600')
      .header('ETag', `"${artifact.metadata.sha256}"`)
      .send(artifact.data);
  }
);
```

#### 5.2 Dual-Channel SSE Endpoints

Add separate SSE endpoints for each channel:

```typescript
// Additions to src/server/mcpHttpTransport.ts

// LLM events channel
app.get(
  '/mcp/llm-events',
  {
    preHandler: app.authenticate
  },
  async (request, reply) => {
    const sessionId =
      (request.headers['mcp-session-id'] as string) || crypto.randomUUID();

    reply.sse(async (source) => {
      const session: EnhancedSessionInfo = {
        source,
        sessionId,
        dualChannelEnabled: true,
        streamingContexts: new Map()
        // ... other session properties
      };

      sessionStore.set(sessionId, session);

      // Send only LLM events to this channel
      session.eventFilter = (event) => event.kind === 'llm_event';
    });
  }
);

// Artifact events channel
app.get(
  '/mcp/artifact-events',
  {
    preHandler: app.authenticate
  },
  async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string;
    const mainSessionId = request.headers['mcp-main-session-id'] as string;

    if (!mainSessionId) {
      return reply.status(400).send({ error: 'Main session ID required' });
    }

    reply.sse(async (source) => {
      const session = {
        source,
        sessionId,
        mainSessionId,
        eventFilter: (event) => event.kind === 'artifact_event'
      };

      // Link to main session
      const mainSession = sessionStore.get(mainSessionId);
      if (mainSession) {
        mainSession.artifactChannelId = sessionId;
      }

      artifactSessionStore.set(sessionId, session);
    });
  }
);
```

### Phase 6: Configuration (Week 4)

#### 6.1 Configuration Schema

Define configuration options:

```typescript
// File: src/config/streaming-config.ts

export interface StreamingConfig {
  // Feature flags
  dualChannelEnabled: boolean;
  backwardCompatible: boolean;

  // Storage configuration
  artifactStorage: {
    type: 'proxy' | 's3' | 'gcs';
    ttlSeconds: number;
    maxSizeMB: number;

    // Proxy storage options
    proxy?: {
      maxMemoryMB: number;
      persistToDisk: boolean;
      diskPath?: string;
    };

    // S3 storage options
    s3?: {
      bucket: string;
      region: string;
      prefix: string;
    };

    // GCS storage options
    gcs?: {
      bucket: string;
      projectId: string;
      prefix: string;
    };
  };

  // Event configuration
  events: {
    bufferSize: number;
    heartbeatIntervalMs: number;
    reconnectWindowMs: number;
  };

  // Channel configuration
  channels: {
    separateArtifactChannel: boolean;
    includeArtifactsInMain: boolean;
    compressionEnabled: boolean;
  };
}

// Default configuration
export const defaultStreamingConfig: StreamingConfig = {
  dualChannelEnabled: false,
  backwardCompatible: true,

  artifactStorage: {
    type: 'proxy',
    ttlSeconds: 3600,
    maxSizeMB: 100,
    proxy: {
      maxMemoryMB: 500,
      persistToDisk: false
    }
  },

  events: {
    bufferSize: 1000,
    heartbeatIntervalMs: 30000,
    reconnectWindowMs: 60000
  },

  channels: {
    separateArtifactChannel: false,
    includeArtifactsInMain: false,
    compressionEnabled: false
  }
};
```

#### 6.2 Environment Variables

Support environment-based configuration:

```bash
# Dual-channel streaming configuration
DUAL_CHANNEL_ENABLED=true
DUAL_CHANNEL_BACKWARD_COMPATIBLE=true

# Artifact storage
ARTIFACT_STORAGE_TYPE=proxy # proxy, s3, gcs
ARTIFACT_TTL_SECONDS=3600
ARTIFACT_MAX_SIZE_MB=100

# Proxy storage
ARTIFACT_PROXY_MAX_MEMORY_MB=500
ARTIFACT_PROXY_PERSIST_DISK=false
ARTIFACT_PROXY_DISK_PATH=/tmp/artifacts

# S3 storage
ARTIFACT_S3_BUCKET=mapbox-artifacts
ARTIFACT_S3_REGION=us-east-1
ARTIFACT_S3_PREFIX=mcp-server

# Event configuration
EVENT_BUFFER_SIZE=1000
EVENT_HEARTBEAT_INTERVAL_MS=30000
EVENT_RECONNECT_WINDOW_MS=60000

# Channel configuration
CHANNEL_SEPARATE_ARTIFACTS=false
CHANNEL_INCLUDE_ARTIFACTS_MAIN=false
CHANNEL_COMPRESSION_ENABLED=false
```

### Phase 7: Testing (Week 5)

#### 7.1 Unit Tests

Test individual components:

```typescript
// File: src/__tests__/streaming/streaming-context.test.ts

describe('StreamingContext', () => {
  it('should emit LLM events with sequence numbers', async () => {
    const context = new StreamingContext('session-1', 'test-tool');
    const events: LlmEvent[] = [];

    context.on('llm_event', (event) => events.push(event));

    await context.emitLlmEvent({ type: 'progress', pct: 0 });
    await context.emitLlmEvent({ type: 'progress', pct: 50 });

    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(0);
    expect(events[1].seq).toBe(1);
  });

  it('should buffer events with FIFO eviction', async () => {
    const context = new StreamingContext('session-1', 'test-tool', 3);

    for (let i = 0; i < 5; i++) {
      await context.emitLlmEvent({ type: 'progress', pct: i * 20 });
    }

    const buffered = context.getBufferedEvents();
    expect(buffered).toHaveLength(3);
    expect(buffered[0].seq).toBe(2); // First two evicted
  });
});
```

#### 7.2 Integration Tests

Test tool streaming:

```typescript
// File: src/__tests__/streaming/directions-streaming.test.ts

describe('DirectionsTool Streaming', () => {
  it('should stream route segments progressively', async () => {
    const tool = new DirectionsTool();
    const context = new StreamingContext('session-1', 'directions_tool');
    const events: StreamingEvent[] = [];

    context.on('llm_event', (e) => events.push(e));
    context.on('artifact_event', (e) => events.push(e));

    const input = {
      coordinates: [
        [-122.4, 37.8],
        [-122.5, 37.7]
      ],
      routing_profile: 'driving-traffic'
    };

    for await (const _ of tool.executeStreaming(input, context, 'test-token')) {
      // Events emitted through context
    }

    // Verify event sequence
    const eventTypes = events.map((e) =>
      e.kind === 'llm_event' ? e.type : 'artifact'
    );

    expect(eventTypes).toContain('progress');
    expect(eventTypes).toContain('partial_result');
    expect(eventTypes).toContain('route_segment');
    expect(eventTypes).toContain('artifact');
    expect(eventTypes).toContain('final_result');
  });
});
```

#### 7.3 E2E Tests

Test complete streaming flow:

```typescript
// File: src/__tests__/e2e/dual-channel.e2e.test.ts

describe('Dual-Channel E2E', () => {
  it('should deliver artifacts through separate channel', async () => {
    const llmEvents: LlmEvent[] = [];
    const artifactEvents: ArtifactEvent[] = [];

    // Connect to LLM channel
    const llmStream = new EventSource(`${serverUrl}/mcp/llm-events`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    llmStream.onmessage = (e) => {
      if (e.event === 'llm_event') {
        llmEvents.push(JSON.parse(e.data));
      }
    };

    // Connect to artifact channel
    const artifactStream = new EventSource(`${serverUrl}/mcp/artifact-events`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Mcp-Main-Session-Id': llmStream.sessionId
      }
    });

    artifactStream.onmessage = (e) => {
      if (e.event === 'artifact_event') {
        artifactEvents.push(JSON.parse(e.data));
      }
    };

    // Execute streaming tool
    const response = await fetch(`${serverUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'directions_tool',
          arguments: {
            coordinates: [
              [-122.4, 37.8],
              [-122.5, 37.7]
            ],
            streaming: true
          }
        }
      })
    });

    // Wait for streaming to complete
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Verify events received
    expect(llmEvents.length).toBeGreaterThan(0);
    expect(artifactEvents.length).toBeGreaterThan(0);

    // Verify artifact accessibility
    const artifact = artifactEvents[0];
    const artifactResponse = await fetch(artifact.uri);
    expect(artifactResponse.ok).toBe(true);
    expect(artifactResponse.headers.get('content-type')).toBe(artifact.mime);

    llmStream.close();
    artifactStream.close();
  });
});
```

### Phase 8: Monitoring & Observability (Week 5)

#### 8.1 Metrics

Add streaming-specific metrics:

```typescript
// File: src/monitoring/streaming-metrics.ts

export class StreamingMetrics {
  // Event counters
  private eventCounts = new Map<string, number>();
  private artifactCounts = new Map<string, number>();

  // Performance metrics
  private streamDurations: number[] = [];
  private eventLatencies: number[] = [];

  // Storage metrics
  private artifactSizes: number[] = [];
  private storageErrors = 0;

  recordEvent(type: LlmEventType): void {
    const count = this.eventCounts.get(type) || 0;
    this.eventCounts.set(type, count + 1);
  }

  recordArtifact(size: number, mime: string): void {
    const count = this.artifactCounts.get(mime) || 0;
    this.artifactCounts.set(mime, count + 1);
    this.artifactSizes.push(size);
  }

  recordStreamDuration(ms: number): void {
    this.streamDurations.push(ms);
  }

  recordEventLatency(ms: number): void {
    this.eventLatencies.push(ms);
  }

  recordStorageError(): void {
    this.storageErrors++;
  }

  getMetrics(): StreamingMetricsSnapshot {
    return {
      events: {
        total: Array.from(this.eventCounts.values()).reduce((a, b) => a + b, 0),
        byType: Object.fromEntries(this.eventCounts)
      },
      artifacts: {
        total: Array.from(this.artifactCounts.values()).reduce(
          (a, b) => a + b,
          0
        ),
        byMime: Object.fromEntries(this.artifactCounts),
        avgSize: this.average(this.artifactSizes),
        totalSize: this.artifactSizes.reduce((a, b) => a + b, 0)
      },
      performance: {
        avgStreamDuration: this.average(this.streamDurations),
        avgEventLatency: this.average(this.eventLatencies),
        p99EventLatency: this.percentile(this.eventLatencies, 99)
      },
      errors: {
        storage: this.storageErrors
      }
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index];
  }
}
```

## Implementation Timeline

| Week | Phase                | Deliverables                                             |
| ---- | -------------------- | -------------------------------------------------------- |
| 1    | Core Infrastructure  | Event types, storage interface, streaming context        |
| 1-2  | Transport Extensions | Enhanced transport, SSE improvements, session management |
| 2    | Artifact Storage     | Proxy storage, S3 integration, delivery endpoints        |
| 2-3  | Tool Streaming       | Base tool updates, DirectionsTool, PoiSearchTool         |
| 3    | HTTP Endpoints       | Artifact delivery, dual-channel SSE                      |
| 4    | Configuration        | Config schema, environment variables, feature flags      |
| 5    | Testing & Monitoring | Unit tests, integration tests, E2E tests, metrics        |

## Migration Strategy

### Backward Compatibility

1. **Feature Flag**: Use `DUAL_CHANNEL_ENABLED` to control activation
2. **Fallback Mode**: When disabled, tools use existing response format
3. **Client Detection**: Auto-detect client capabilities via headers
4. **Gradual Rollout**: Enable per-tool via configuration

### Client Migration Path

```typescript
// Old client (still works)
const response = await fetch('/mcp', {
  method: 'POST',
  body: JSON.stringify({
    method: 'tools/call',
    params: { name: 'directions_tool', arguments: {...} }
  })
});
const result = await response.json();

// New streaming client
const eventSource = new EventSource('/mcp/llm-events');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.kind === 'llm_event') {
    // Handle LLM event
  }
};

// With artifact channel
const artifactSource = new EventSource('/mcp/artifact-events');
artifactSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.kind === 'artifact_event') {
    // Handle artifact
    fetch(data.uri).then(response => {
      // Use artifact
    });
  }
};
```

## Security Considerations

1. **Artifact Access Control**

   - JWT-based signed URLs with short TTL
   - Per-user artifact isolation
   - Rate limiting on artifact endpoints

2. **Storage Security**

   - Encryption at rest for S3/GCS
   - Secure token generation for proxy storage
   - Regular cleanup of expired artifacts

3. **Channel Security**
   - Separate authentication for each channel
   - Session binding between channels
   - Event filtering by user permissions

## Performance Optimizations

1. **Lazy Artifact Generation**

   - Generate artifacts only when requested
   - Cache frequently accessed artifacts
   - Use CDN for artifact delivery

2. **Event Batching**

   - Batch small events to reduce overhead
   - Compress event streams
   - Use binary format for large payloads

3. **Connection Management**
   - Connection pooling for SSE
   - Automatic reconnection with event replay
   - Heartbeat optimization

## Conclusion

This implementation provides a complete dual-channel streaming solution that:

- ✅ Supports all proposed `llm_event` types
- ✅ Implements full `artifact_event` functionality
- ✅ Maintains backward compatibility
- ✅ Provides flexible storage options
- ✅ Enables progressive UI updates
- ✅ Optimizes token usage

The phased approach ensures minimal disruption while delivering significant improvements in user experience and system efficiency.
