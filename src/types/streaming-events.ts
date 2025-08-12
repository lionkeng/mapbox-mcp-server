/**
 * Dual-channel streaming event type definitions
 * Separates LLM-consumable events from large binary artifacts
 */

/**
 * Event validation configuration
 */
export interface EventValidationConfig {
  maxEventSize?: number;       // Max total event size in bytes
  maxMessageLength?: number;   // Max string field length
  maxArrayLength?: number;     // Max array field length
  allowedMimeTypes?: string[]; // Allowed MIME types for artifacts
  maxArtifactSize?: number;    // Max artifact size in bytes
}

/**
 * Default validation configuration
 */
export const DEFAULT_VALIDATION_CONFIG: Required<EventValidationConfig> = {
  maxEventSize: 65536,      // 64KB per event
  maxMessageLength: 2048,   // 2KB for text fields
  maxArrayLength: 100,      // Max 100 items in arrays
  allowedMimeTypes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/json',
    'application/geo+json',
    'text/plain',
    'text/csv',
    'application/octet-stream' // For generic binary data
  ],
  maxArtifactSize: 10485760 // 10MB for artifacts
};

// Event type enumeration for LLM events
export type LlmEventType =
  | 'progress'        // Progress percentage updates
  | 'partial_result'  // Intermediate results (bbox, coarse polyline)
  | 'route_segment'   // Individual route segments with steps
  | 'poi_batch'       // Batches of POI results
  | 'final_result'    // Final computation result
  | 'error'           // Error events
  | 'status'          // Connection/tool state updates
  | 'metadata'        // Tool execution metadata
  | 'cancel'          // Cancellation acknowledgment
  | 'heartbeat';      // Keep-alive signals

// Base interface for LLM events
interface BaseLlmEvent {
  kind: 'llm_event';
  type: LlmEventType;
  seq?: number;
  timestamp?: string;
}

// Specific event type interfaces using discriminated unions
interface ProgressEvent extends BaseLlmEvent {
  type: 'progress';
  pct: number;
  message?: string;
}

interface PartialResultEvent extends BaseLlmEvent {
  type: 'partial_result';
  camera?: {
    center: [number, number];
    zoom: number;
  };
  bbox?: [number, number, number, number];
  polyline?: string;
  distance_km?: string;
  duration_min?: number;
}

interface RouteSegmentEvent extends BaseLlmEvent {
  type: 'route_segment';
  seq: number;
  polyline?: string;
  steps: Array<{
    instruction: string;
    distance: number;
    duration: number;
    mode?: string;
  }>;
  eta: number;
  distance?: number;
  summary?: string;
}

interface PoiBatchEvent extends BaseLlmEvent {
  type: 'poi_batch';
  seq: number;
  items: Array<{
    id: string;
    coord: [number, number];
    name: string;
    address?: string;
    category?: string;
    distance?: number;
  }>;
  total: number;
  hasMore: boolean;
}

interface FinalResultEvent extends BaseLlmEvent {
  type: 'final_result';
  distance_m?: number;
  eta_s?: number;
  profile?: string;
  query?: string;
  total_results?: number;
  center?: [number, number];
  radius?: number;
  summary?: string;
  waypoints?: Array<{
    name: string;
    location: [number, number];
  }>;
  content?: unknown;
  message?: string;
}

interface ErrorEvent extends BaseLlmEvent {
  type: 'error';
  code?: string;
  message: string;
  details?: unknown;
}

interface StatusEvent extends BaseLlmEvent {
  type: 'status';
  status: string;
  message?: string;
}

interface MetadataEvent extends BaseLlmEvent {
  type: 'metadata';
  metadata: Record<string, unknown>;
}

interface CancelEvent extends BaseLlmEvent {
  type: 'cancel';
  reason?: string;
}

interface HeartbeatEvent extends BaseLlmEvent {
  type: 'heartbeat';
}

// Union type for all LLM events
export type LlmEvent =
  | ProgressEvent
  | PartialResultEvent
  | RouteSegmentEvent
  | PoiBatchEvent
  | FinalResultEvent
  | ErrorEvent
  | StatusEvent
  | MetadataEvent
  | CancelEvent
  | HeartbeatEvent;

// Artifact event interface
export interface ArtifactEvent {
  kind: 'artifact_event';
  id: string;
  uri: string;
  mime: string;
  bytes: number;
  sha256?: string;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

// Union type for all streaming events
export type StreamingEvent = LlmEvent | ArtifactEvent;

/**
 * Event sequence manager for context-scoped numbering
 */
export class EventSequenceManager {
  private sequence = 0;

  nextSequence(): number {
    return ++this.sequence;
  }

  reset(): void {
    this.sequence = 0;
  }

  getCurrentSequence(): number {
    return this.sequence;
  }
}

/**
 * Creates an LLM event with validation, automatic sequence numbering and timestamp
 * @param event Event data without kind, seq, timestamp
 * @param sequenceManager Optional sequence manager for context-scoped numbering
 * @param validationConfig Optional validation configuration
 */
export function createLlmEvent<T extends Omit<LlmEvent, 'kind'>>(
  event: T,
  sequenceManager?: EventSequenceManager,
  validationConfig?: EventValidationConfig
): T & { kind: 'llm_event'; seq: number; timestamp: string } {
  const fullEvent = {
    kind: 'llm_event' as const,
    seq: sequenceManager?.nextSequence() ?? Date.now(), // Fallback to timestamp for uniqueness
    timestamp: new Date().toISOString(),
    ...event
  } as T & { kind: 'llm_event'; seq: number; timestamp: string };
  
  // Validate the created event
  validateLlmEvent(fullEvent, validationConfig);
  
  return fullEvent;
}

/**
 * Creates an artifact event with validation
 * @param event Event data without kind
 * @param validationConfig Optional validation configuration
 */
export function createArtifactEvent(
  event: Omit<ArtifactEvent, 'kind'>,
  validationConfig?: EventValidationConfig
): ArtifactEvent {
  const fullEvent = {
    kind: 'artifact_event' as const,
    ...event
  };
  
  // Validate the created event
  validateArtifactEvent(fullEvent, validationConfig);
  
  return fullEvent;
}

/**
 * Type guard for LLM events
 */
export function isLlmEvent(event: unknown): event is LlmEvent {
  return (
    event !== null &&
    event !== undefined &&
    typeof event === 'object' &&
    'kind' in event &&
    (event as { kind: unknown }).kind === 'llm_event'
  );
}

/**
 * Type guard for artifact events
 */
export function isArtifactEvent(event: unknown): event is ArtifactEvent {
  return (
    event !== null &&
    event !== undefined &&
    typeof event === 'object' &&
    'kind' in event &&
    (event as { kind: unknown }).kind === 'artifact_event'
  );
}

/**
 * Validates an LLM event with comprehensive checks
 * @throws Error if validation fails
 */
export function validateLlmEvent(event: unknown, config: EventValidationConfig = {}): asserts event is LlmEvent {
  if (!event || typeof event !== 'object') {
    throw new Error('Invalid LlmEvent: must be an object');
  }

  const e = event as Record<string, unknown>;
  const validationConfig = { ...DEFAULT_VALIDATION_CONFIG, ...config };

  if (e.kind !== 'llm_event') {
    throw new Error('Invalid LlmEvent: kind must be "llm_event"');
  }

  const validTypes: LlmEventType[] = [
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

  if (!validTypes.includes(e.type as LlmEventType)) {
    throw new Error(`Invalid LlmEvent: unknown type "${e.type}"`);
  }

  // Check overall event size
  const eventSize = estimateEventSize(event);
  if (eventSize > validationConfig.maxEventSize) {
    throw new Error(`Invalid LlmEvent: event size ${eventSize} exceeds maximum ${validationConfig.maxEventSize} bytes`);
  }

  // Type-specific validation with size limits
  validateLlmEventFields(e, validationConfig);
}

/**
 * Validates an artifact event with comprehensive checks
 * @throws Error if validation fails
 */
export function validateArtifactEvent(event: unknown, config: EventValidationConfig = {}): asserts event is ArtifactEvent {
  if (!event || typeof event !== 'object') {
    throw new Error('Invalid ArtifactEvent: must be an object');
  }

  const e = event as Record<string, unknown>;
  const validationConfig = { ...DEFAULT_VALIDATION_CONFIG, ...config };

  if (e.kind !== 'artifact_event') {
    throw new Error('Invalid ArtifactEvent: kind must be "artifact_event"');
  }

  // Check required fields
  const requiredFields = ['id', 'uri', 'mime', 'bytes'];
  for (const field of requiredFields) {
    if (!(field in e)) {
      throw new Error(`Invalid ArtifactEvent: missing required field "${field}"`);
    }
  }

  // Validate field types and lengths
  if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > validationConfig.maxMessageLength / 4) {
    throw new Error(`Invalid ArtifactEvent: id must be a non-empty string (max ${validationConfig.maxMessageLength / 4} chars)`);
  }

  if (typeof e.uri !== 'string' || e.uri.length === 0) {
    throw new Error('Invalid ArtifactEvent: uri must be a non-empty string');
  }

  // Validate URI format
  try {
    new URL(e.uri);
  } catch {
    throw new Error('Invalid ArtifactEvent: uri must be a valid URL');
  }

  if (typeof e.mime !== 'string' || e.mime.length === 0) {
    throw new Error('Invalid ArtifactEvent: mime must be a non-empty string');
  }

  // Validate MIME type
  if (!isValidMimeType(e.mime, validationConfig.allowedMimeTypes)) {
    throw new Error(`Invalid ArtifactEvent: unsupported MIME type "${e.mime}"`);
  }

  if (typeof e.bytes !== 'number' || e.bytes < 0) {
    throw new Error('Invalid ArtifactEvent: bytes must be a positive number');
  }

  if (e.bytes > validationConfig.maxArtifactSize) {
    throw new Error(`Invalid ArtifactEvent: artifact size ${e.bytes} exceeds maximum ${validationConfig.maxArtifactSize} bytes`);
  }

  // Validate optional fields
  if (e.sha256 !== undefined) {
    if (typeof e.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(e.sha256)) {
      throw new Error('Invalid ArtifactEvent: sha256 must be a 64-character hex string');
    }
  }

  if (e.expires_at !== undefined) {
    if (typeof e.expires_at !== 'string') {
      throw new Error('Invalid ArtifactEvent: expires_at must be a string');
    }
    try {
      new Date(e.expires_at);
    } catch {
      throw new Error('Invalid ArtifactEvent: expires_at must be a valid ISO date string');
    }
  }

  if (e.metadata !== undefined && (typeof e.metadata !== 'object' || e.metadata === null)) {
    throw new Error('Invalid ArtifactEvent: metadata must be an object');
  }
}

/**
 * Helper to get event type from a streaming event
 */
export function getEventType(event: StreamingEvent): string {
  if (isLlmEvent(event)) {
    return event.type;
  }
  return 'artifact';
}

/**
 * Helper to check if an event is a progress event
 */
export function isProgressEvent(event: StreamingEvent): event is ProgressEvent {
  return isLlmEvent(event) && event.type === 'progress';
}

/**
 * Helper to check if an event is an error event
 */
export function isErrorEvent(event: StreamingEvent): event is ErrorEvent {
  return isLlmEvent(event) && event.type === 'error';
}

/**
 * Helper to check if an event is a final result event
 */
export function isFinalResultEvent(event: StreamingEvent): event is FinalResultEvent {
  return isLlmEvent(event) && event.type === 'final_result';
}

/**
 * Validates LLM event fields based on type
 */
function validateLlmEventFields(event: Record<string, unknown>, config: Required<EventValidationConfig>): void {
  const type = event.type as LlmEventType;
  
  switch (type) {
    case 'progress':
      if (typeof event.pct !== 'number' || event.pct < 0 || event.pct > 100) {
        throw new Error('Invalid progress event: pct must be a number between 0 and 100');
      }
      if (event.message && typeof event.message === 'string' && event.message.length > config.maxMessageLength) {
        throw new Error(`Invalid progress event: message too long (max ${config.maxMessageLength} chars)`);
      }
      break;
      
    case 'error':
      if (!event.message || typeof event.message !== 'string') {
        throw new Error('Invalid error event: missing required field "message"');
      }
      if (event.message.length > config.maxMessageLength) {
        throw new Error(`Invalid error event: message too long (max ${config.maxMessageLength} chars)`);
      }
      if (event.code && (typeof event.code !== 'string' || event.code.length > 50)) {
        throw new Error('Invalid error event: code must be a string (max 50 chars)');
      }
      break;
      
    case 'route_segment':
      if (typeof event.seq !== 'number' || typeof event.eta !== 'number') {
        throw new Error('Invalid route_segment event: missing required numeric fields');
      }
      if (!Array.isArray(event.steps)) {
        throw new Error('Invalid route_segment event: steps must be an array');
      }
      if (event.steps.length > config.maxArrayLength) {
        throw new Error(`Invalid route_segment event: too many steps (max ${config.maxArrayLength})`);
      }
      for (const step of event.steps) {
        if (!step || typeof step !== 'object') {
          throw new Error('Invalid route_segment event: steps must be objects');
        }
        const s = step as Record<string, unknown>;
        if (!s.instruction || typeof s.instruction !== 'string') {
          throw new Error('Invalid route_segment event: step missing instruction');
        }
        if (s.instruction.length > config.maxMessageLength / 2) {
          throw new Error(`Invalid route_segment event: instruction too long (max ${config.maxMessageLength / 2} chars)`);
        }
      }
      break;
      
    case 'poi_batch':
      if (typeof event.seq !== 'number' || typeof event.total !== 'number' || typeof event.hasMore !== 'boolean') {
        throw new Error('Invalid poi_batch event: missing required fields');
      }
      if (!Array.isArray(event.items)) {
        throw new Error('Invalid poi_batch event: items must be an array');
      }
      if (event.items.length > config.maxArrayLength) {
        throw new Error(`Invalid poi_batch event: too many items (max ${config.maxArrayLength})`);
      }
      for (const item of event.items) {
        if (!item || typeof item !== 'object') {
          throw new Error('Invalid poi_batch event: items must be objects');
        }
        const i = item as Record<string, unknown>;
        if (!i.id || typeof i.id !== 'string') {
          throw new Error('Invalid poi_batch event: item missing id');
        }
        if (i.name && typeof i.name === 'string' && i.name.length > config.maxMessageLength / 4) {
          throw new Error(`Invalid poi_batch event: item name too long (max ${config.maxMessageLength / 4} chars)`);
        }
      }
      break;
      
    case 'status':
      if (!event.status || typeof event.status !== 'string') {
        throw new Error('Invalid status event: missing required field "status"');
      }
      if (event.message && typeof event.message === 'string' && event.message.length > config.maxMessageLength) {
        throw new Error(`Invalid status event: message too long (max ${config.maxMessageLength} chars)`);
      }
      break;
      
    case 'cancel':
      if (event.reason && typeof event.reason === 'string' && event.reason.length > config.maxMessageLength) {
        throw new Error(`Invalid cancel event: reason too long (max ${config.maxMessageLength} chars)`);
      }
      break;

    case 'final_result':
      if (event.summary && typeof event.summary === 'string' && event.summary.length > config.maxMessageLength) {
        throw new Error(`Invalid final_result event: summary too long (max ${config.maxMessageLength} chars)`);
      }
      break;
  }
}

/**
 * Validates MIME type against allowed list
 */
function isValidMimeType(mime: string, allowedTypes: string[]): boolean {
  return allowedTypes.includes(mime) || allowedTypes.some(allowed => {
    if (allowed.endsWith('/*')) {
      const baseType = allowed.slice(0, -2);
      return mime.startsWith(baseType + '/');
    }
    return false;
  });
}

/**
 * Estimates event size in bytes
 */
function estimateEventSize(event: unknown): number {
  try {
    // Use JSON.stringify to get accurate size
    return new TextEncoder().encode(JSON.stringify(event)).length;
  } catch {
    // Fallback estimation if JSON.stringify fails
    return 1000; // Conservative estimate
  }
}

/**
 * Sanitizes string fields to prevent injection attacks
 */
export function sanitizeStringField(value: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new Error('Value must be a string');
  }
  
  // Remove null bytes and control characters (except newline and tab)
  const cleaned = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Truncate if too long
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/**
 * Validates and sanitizes event data
 */
export function sanitizeEvent(event: StreamingEvent, config?: EventValidationConfig): StreamingEvent {
  const validationConfig = { ...DEFAULT_VALIDATION_CONFIG, ...config };
  
  if (isLlmEvent(event)) {
    validateLlmEvent(event, validationConfig);
    return {
      ...event,
      message: event.message ? sanitizeStringField(event.message, validationConfig.maxMessageLength) : event.message
    } as StreamingEvent;
  } else if (isArtifactEvent(event)) {
    validateArtifactEvent(event, validationConfig);
    return event;
  }
  
  throw new Error('Unknown event type');
}

/**
 * Gets the global validation configuration
 */
export function getGlobalValidationConfig(): Required<EventValidationConfig> {
  return { ...DEFAULT_VALIDATION_CONFIG };
}

/**
 * Updates the global validation configuration
 */
export function setGlobalValidationConfig(config: Partial<EventValidationConfig>): void {
  Object.assign(DEFAULT_VALIDATION_CONFIG, config);
}

// Export specific event types for convenience
export type {
  ProgressEvent,
  PartialResultEvent,
  RouteSegmentEvent,
  PoiBatchEvent,
  FinalResultEvent,
  ErrorEvent,
  StatusEvent,
  MetadataEvent,
  CancelEvent,
  HeartbeatEvent
};