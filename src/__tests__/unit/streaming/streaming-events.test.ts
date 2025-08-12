/**
 * Unit tests for streaming event type definitions
 * Testing event validation, serialization, and type guards
 */

import {
  LlmEventType,
  LlmEvent,
  ArtifactEvent,
  StreamingEvent,
  isLlmEvent,
  isArtifactEvent,
  validateLlmEvent,
  validateArtifactEvent,
  createLlmEvent,
  createArtifactEvent,
  EventSequenceManager
} from '../../../types/streaming-events';

describe('Streaming Events Type Definitions', () => {
  describe('LlmEventType', () => {
    it('should define all required event types', () => {
      const expectedTypes: LlmEventType[] = [
        'progress',
        'partial_result',
        'route_segment',
        'poi_batch',
        'final_result',
        'error',
        'status',
        'metadata',
        'cancel',
        'heartbeat'
      ];

      expectedTypes.forEach((type) => {
        expect(type).toBeDefined();
      });
    });
  });

  describe('LlmEvent', () => {
    it('should create a valid progress event', () => {
      const event = createLlmEvent({
        type: 'progress',
        pct: 50
      });

      expect(event.kind).toBe('llm_event');
      expect(event.type).toBe('progress');
      expect(event.pct).toBe(50);
      expect(event.seq).toBeDefined();
      expect(event.timestamp).toBeDefined();
    });

    it('should create a valid partial_result event', () => {
      const event = createLlmEvent({
        type: 'partial_result',
        camera: { center: [-122.4, 37.8], zoom: 12 },
        bbox: [-122.5, 37.7, -122.3, 37.9],
        polyline: 'encodedPolylineString'
      });

      expect(event.kind).toBe('llm_event');
      expect(event.type).toBe('partial_result');
      expect(event.camera).toEqual({ center: [-122.4, 37.8], zoom: 12 });
      expect(event.bbox).toEqual([-122.5, 37.7, -122.3, 37.9]);
    });

    it('should create a valid route_segment event', () => {
      const event = createLlmEvent({
        type: 'route_segment',
        seq: 1,
        polyline: 'encodedPolyline',
        steps: [
          { instruction: 'Turn left', distance: 100, duration: 60 }
        ],
        eta: 1234
      });

      expect(event.kind).toBe('llm_event');
      expect(event.type).toBe('route_segment');
      expect(event.steps).toHaveLength(1);
      expect(event.eta).toBe(1234);
    });

    it('should create a valid poi_batch event', () => {
      const event = createLlmEvent({
        type: 'poi_batch',
        seq: 0,
        items: [
          { id: 'poi1', coord: [-122.4, 37.8], name: 'Cafe' }
        ],
        total: 10,
        hasMore: true
      });

      expect(event.kind).toBe('llm_event');
      expect(event.type).toBe('poi_batch');
      expect(event.items).toHaveLength(1);
      expect(event.total).toBe(10);
      expect(event.hasMore).toBe(true);
    });

    it('should create a valid final_result event', () => {
      const event = createLlmEvent({
        type: 'final_result',
        distance_m: 19876,
        eta_s: 1260,
        profile: 'driving',
        summary: 'Route found: 19.9km, 21 minutes'
      });

      expect(event.kind).toBe('llm_event');
      expect(event.type).toBe('final_result');
      expect(event.distance_m).toBe(19876);
      expect(event.eta_s).toBe(1260);
      expect(event.profile).toBe('driving');
    });

    it('should create a valid error event', () => {
      const event = createLlmEvent({
        type: 'error',
        code: 'API_ERROR',
        message: 'Failed to fetch directions'
      });

      expect(event.kind).toBe('llm_event');
      expect(event.type).toBe('error');
      expect(event.code).toBe('API_ERROR');
      expect(event.message).toBe('Failed to fetch directions');
    });

    it('should auto-increment sequence numbers', () => {
      const sequenceManager = new EventSequenceManager();
      
      const event1 = createLlmEvent({ type: 'progress', pct: 0 }, sequenceManager);
      const event2 = createLlmEvent({ type: 'progress', pct: 50 }, sequenceManager);
      const event3 = createLlmEvent({ type: 'progress', pct: 100 }, sequenceManager);

      expect(event2.seq).toBeGreaterThan(event1.seq!);
      expect(event3.seq).toBeGreaterThan(event2.seq!);
      expect(event1.seq).toBe(1);
      expect(event2.seq).toBe(2);
      expect(event3.seq).toBe(3);
    });

    it('should include timestamp in ISO format', () => {
      const event = createLlmEvent({ type: 'heartbeat' });
      const timestamp = new Date(event.timestamp!);
      
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('ArtifactEvent', () => {
    it('should create a valid artifact event', () => {
      const event = createArtifactEvent({
        id: 'map-final-123',
        uri: 'https://example.com/artifacts/map-final-123',
        mime: 'image/png',
        bytes: 146522
      });

      expect(event.kind).toBe('artifact_event');
      expect(event.id).toBe('map-final-123');
      expect(event.uri).toBe('https://example.com/artifacts/map-final-123');
      expect(event.mime).toBe('image/png');
      expect(event.bytes).toBe(146522);
    });

    it('should include optional fields when provided', () => {
      const event = createArtifactEvent({
        id: 'route-geojson',
        uri: 'https://example.com/route.geojson',
        mime: 'application/geo+json',
        bytes: 50234,
        sha256: '8b4d73e08a17b1c7d3e5c9a2f1e3d5b7a9c3e1f5d7b9a1c3e5f7a8b9c2d4e6f8',
        expires_at: '2025-01-01T00:00:00Z',
        metadata: {
          tool: 'directions_tool',
          profile: 'driving'
        }
      });

      expect(event.sha256).toBe('8b4d73e08a17b1c7d3e5c9a2f1e3d5b7a9c3e1f5d7b9a1c3e5f7a8b9c2d4e6f8');
      expect(event.expires_at).toBe('2025-01-01T00:00:00Z');
      expect(event.metadata).toEqual({
        tool: 'directions_tool',
        profile: 'driving'
      });
    });
  });

  describe('Type Guards', () => {
    it('should correctly identify LlmEvent', () => {
      const llmEvent = createLlmEvent({ type: 'progress', pct: 50 });
      const artifactEvent = createArtifactEvent({
        id: 'test',
        uri: 'http://test',
        mime: 'image/png',
        bytes: 100
      });

      expect(isLlmEvent(llmEvent)).toBe(true);
      expect(isLlmEvent(artifactEvent)).toBe(false);
      expect(isLlmEvent({})).toBe(false);
      expect(isLlmEvent(null)).toBe(false);
      expect(isLlmEvent(undefined)).toBe(false);
    });

    it('should correctly identify ArtifactEvent', () => {
      const llmEvent = createLlmEvent({ type: 'progress', pct: 50 });
      const artifactEvent = createArtifactEvent({
        id: 'test',
        uri: 'http://test',
        mime: 'image/png',
        bytes: 100
      });

      expect(isArtifactEvent(artifactEvent)).toBe(true);
      expect(isArtifactEvent(llmEvent)).toBe(false);
      expect(isArtifactEvent({})).toBe(false);
      expect(isArtifactEvent(null)).toBe(false);
      expect(isArtifactEvent(undefined)).toBe(false);
    });

    it('should handle discriminated union correctly', () => {
      const events: StreamingEvent[] = [
        createLlmEvent({ type: 'progress', pct: 50 }),
        createArtifactEvent({
          id: 'test',
          uri: 'http://test',
          mime: 'image/png',
          bytes: 100
        })
      ];

      events.forEach((event) => {
        if (isLlmEvent(event)) {
          expect(event.type).toBeDefined();
          expect(event.seq).toBeDefined();
        } else if (isArtifactEvent(event)) {
          expect(event.id).toBeDefined();
          expect(event.uri).toBeDefined();
        } else {
          fail('Unknown event type');
        }
      });
    });
  });

  describe('Validation', () => {
    describe('validateLlmEvent', () => {
      it('should validate valid LlmEvent', () => {
        const validEvent = {
          kind: 'llm_event',
          type: 'progress',
          pct: 50,
          seq: 1,
          timestamp: new Date().toISOString()
        };

        expect(() => validateLlmEvent(validEvent)).not.toThrow();
      });

      it('should reject invalid kind', () => {
        const invalidEvent = {
          kind: 'invalid_kind',
          type: 'progress',
          pct: 50
        };

        expect(() => validateLlmEvent(invalidEvent)).toThrow('Invalid LlmEvent: kind must be "llm_event"');
      });

      it('should reject invalid type', () => {
        const invalidEvent = {
          kind: 'llm_event',
          type: 'invalid_type',
          pct: 50
        };

        expect(() => validateLlmEvent(invalidEvent)).toThrow('Invalid LlmEvent: unknown type "invalid_type"');
      });

      it('should reject missing required fields for progress event', () => {
        const invalidEvent = {
          kind: 'llm_event',
          type: 'progress'
          // Missing pct field
        };

        expect(() => validateLlmEvent(invalidEvent)).toThrow('Invalid progress event: pct must be a number between 0 and 100');
      });
    });

    describe('validateArtifactEvent', () => {
      it('should validate valid ArtifactEvent', () => {
        const validEvent = {
          kind: 'artifact_event',
          id: 'test-id',
          uri: 'https://example.com/artifact',
          mime: 'image/png',
          bytes: 12345
        };

        expect(() => validateArtifactEvent(validEvent)).not.toThrow();
      });

      it('should reject invalid kind', () => {
        const invalidEvent = {
          kind: 'invalid_kind',
          id: 'test-id',
          uri: 'https://example.com/artifact',
          mime: 'image/png',
          bytes: 12345
        };

        expect(() => validateArtifactEvent(invalidEvent)).toThrow('Invalid ArtifactEvent: kind must be "artifact_event"');
      });

      it('should reject missing required fields', () => {
        const invalidEvent = {
          kind: 'artifact_event',
          id: 'test-id'
          // Missing uri, mime, bytes
        };

        expect(() => validateArtifactEvent(invalidEvent)).toThrow('Invalid ArtifactEvent: missing required field');
      });

      it('should reject invalid bytes value', () => {
        const invalidEvent = {
          kind: 'artifact_event',
          id: 'test-id',
          uri: 'https://example.com/artifact',
          mime: 'image/png',
          bytes: -100
        };

        expect(() => validateArtifactEvent(invalidEvent)).toThrow('Invalid ArtifactEvent: bytes must be a positive number');
      });

      it('should accept valid optional fields', () => {
        const validEvent = {
          kind: 'artifact_event',
          id: 'test-id',
          uri: 'https://example.com/artifact',
          mime: 'image/png',
          bytes: 12345,
          sha256: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd',
          expires_at: '2025-01-01T00:00:00Z',
          metadata: { tool: 'test' }
        };

        expect(() => validateArtifactEvent(validEvent)).not.toThrow();
      });
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize LlmEvent correctly', () => {
      const original = createLlmEvent({
        type: 'progress',
        pct: 75
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(parsed.kind).toBe(original.kind);
      expect(parsed.type).toBe(original.type);
      expect(parsed.pct).toBe(original.pct);
      expect(parsed.seq).toBe(original.seq);
      expect(parsed.timestamp).toBe(original.timestamp);
    });

    it('should serialize and deserialize ArtifactEvent correctly', () => {
      const original = createArtifactEvent({
        id: 'test-artifact',
        uri: 'https://example.com/test',
        mime: 'application/json',
        bytes: 1024,
        metadata: { custom: 'data' }
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(parsed.kind).toBe(original.kind);
      expect(parsed.id).toBe(original.id);
      expect(parsed.uri).toBe(original.uri);
      expect(parsed.mime).toBe(original.mime);
      expect(parsed.bytes).toBe(original.bytes);
      expect(parsed.metadata).toEqual(original.metadata);
    });
  });
});