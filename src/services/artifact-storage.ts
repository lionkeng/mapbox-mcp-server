/**
 * Artifact storage interface and types
 * Provides abstraction for storing and retrieving large binary artifacts
 */

/**
 * Metadata associated with an artifact
 */
export interface ArtifactMetadata {
  mime: string;
  tool: string;
  userId?: string;
  requestId?: string;
  ttlSeconds?: number;
  sha256?: string;
  tags?: Record<string, string>;
}

/**
 * Stored artifact with metadata
 */
export interface StoredArtifact {
  id: string;
  data: Buffer;
  metadata: ArtifactMetadata;
  createdAt: Date;
  expiresAt?: Date;
}

/**
 * Abstract interface for artifact storage implementations
 */
export interface ArtifactStorage {
  /**
   * Store an artifact and return its ID
   */
  store(data: Buffer, metadata: ArtifactMetadata): Promise<string>;

  /**
   * Get a signed URL for artifact access
   * @param artifactId The artifact ID
   * @param ttl Optional TTL in seconds for the signed URL
   */
  getSignedUrl(artifactId: string, ttl?: number): Promise<string>;

  /**
   * Retrieve artifact data
   * Returns null if artifact doesn't exist or has expired
   */
  get(artifactId: string): Promise<StoredArtifact | null>;

  /**
   * Delete an artifact
   */
  delete(artifactId: string): Promise<void>;

  /**
   * Cleanup expired artifacts
   * Returns the number of artifacts deleted
   */
  cleanupExpired(): Promise<number>;

  /**
   * Check if an artifact exists
   */
  exists(artifactId: string): Promise<boolean>;

  /**
   * Get the size of an artifact in bytes
   * Returns null if artifact doesn't exist
   */
  getSize(artifactId: string): Promise<number | null>;

  /**
   * List all artifact IDs
   */
  listArtifacts(): Promise<string[]>;
}

/**
 * Creates artifact metadata with validation
 */
export function createArtifactMetadata(
  metadata: ArtifactMetadata
): ArtifactMetadata {
  validateArtifactMetadata(metadata);
  return { ...metadata };
}

/**
 * Validates artifact metadata
 * @throws Error if validation fails
 */
export function validateArtifactMetadata(
  metadata: unknown
): asserts metadata is ArtifactMetadata {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Invalid ArtifactMetadata: must be an object');
  }

  const m = metadata as Record<string, unknown>;

  // Check required fields
  if (!m.mime || typeof m.mime !== 'string') {
    throw new Error('Invalid ArtifactMetadata: missing required field "mime"');
  }

  if (!m.tool || typeof m.tool !== 'string') {
    throw new Error('Invalid ArtifactMetadata: missing required field "tool"');
  }

  // Validate MIME type format (basic check)
  if (!isValidMimeType(m.mime)) {
    throw new Error('Invalid ArtifactMetadata: invalid MIME type format');
  }

  // Validate optional fields
  if (m.userId !== undefined && typeof m.userId !== 'string') {
    throw new Error('Invalid ArtifactMetadata: userId must be a string');
  }

  if (m.requestId !== undefined && typeof m.requestId !== 'string') {
    throw new Error('Invalid ArtifactMetadata: requestId must be a string');
  }

  if (m.ttlSeconds !== undefined && 
      (typeof m.ttlSeconds !== 'number' || m.ttlSeconds < 0)) {
    throw new Error('Invalid ArtifactMetadata: ttlSeconds must be a positive number');
  }

  if (m.sha256 !== undefined && typeof m.sha256 !== 'string') {
    throw new Error('Invalid ArtifactMetadata: sha256 must be a string');
  }

  if (m.tags !== undefined && 
      (typeof m.tags !== 'object' || Array.isArray(m.tags))) {
    throw new Error('Invalid ArtifactMetadata: tags must be an object');
  }
}

/**
 * Checks if a MIME type is valid
 */
function isValidMimeType(mime: string): boolean {
  // Basic MIME type validation: type/subtype
  const mimeRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9\-+.]*$/;
  return mimeRegex.test(mime);
}

/**
 * Checks if an artifact has expired
 */
export function isExpired(expiresAt: Date | undefined): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() < Date.now();
}

/**
 * Storage configuration options
 */
export interface StorageConfig {
  type: 'proxy' | 's3' | 'gcs';
  baseUrl?: string;
  ttlSeconds?: number;
  maxSizeMB?: number;
  
  // Proxy storage options
  proxy?: {
    maxMemoryMB?: number;
    persistToDisk?: boolean;
    diskPath?: string;
  };
  
  // S3 storage options
  s3?: {
    bucket?: string;
    region?: string;
    prefix?: string;
  };
  
  // GCS storage options
  gcs?: {
    bucket?: string;
    projectId?: string;
    prefix?: string;
  };
}

/**
 * Default storage configuration
 */
export const defaultStorageConfig: StorageConfig = {
  type: 'proxy',
  ttlSeconds: 3600, // 1 hour
  maxSizeMB: 100,
  proxy: {
    maxMemoryMB: 500,
    persistToDisk: false
  }
};

/**
 * Storage factory function
 * Creates storage instance based on configuration
 */
export async function createArtifactStorage(
  config: StorageConfig = defaultStorageConfig
): Promise<ArtifactStorage> {
  switch (config.type) {
    case 'proxy':
      // Will be implemented in Phase 3.1
      const { ProxyArtifactStorage } = await import('./proxy-artifact-storage.js');
      return new ProxyArtifactStorage(
        config.baseUrl || 'http://localhost:8080',
        config.ttlSeconds || 3600
      );
      
    case 's3':
      // Future implementation
      throw new Error('S3 storage not yet implemented');
      
    case 'gcs':
      // Future implementation
      throw new Error('GCS storage not yet implemented');
      
    default:
      throw new Error(`Unknown storage type: ${(config as any).type}`);
  }
}

/**
 * Storage manager for managing multiple storage instances
 */
export class StorageManager {
  private storageInstances = new Map<string, ArtifactStorage>();
  private defaultConfig: StorageConfig;

  constructor(defaultConfig: StorageConfig = defaultStorageConfig) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Gets a storage instance by key, creating if necessary
   */
  async getStorage(key = 'default', config?: StorageConfig): Promise<ArtifactStorage> {
    if (!this.storageInstances.has(key)) {
      const storageConfig = config || this.defaultConfig;
      const storage = await createArtifactStorage(storageConfig);
      this.storageInstances.set(key, storage);
    }
    return this.storageInstances.get(key)!;
  }

  /**
   * Sets a storage instance for a specific key
   */
  setStorage(key: string, storage: ArtifactStorage): void {
    this.storageInstances.set(key, storage);
  }

  /**
   * Removes a storage instance
   */
  removeStorage(key: string): void {
    this.storageInstances.delete(key);
  }

  /**
   * Clears all storage instances
   */
  clear(): void {
    this.storageInstances.clear();
  }

  /**
   * Gets all storage instance keys
   */
  getKeys(): string[] {
    return Array.from(this.storageInstances.keys());
  }
}

/**
 * Default storage manager instance
 */
const defaultStorageManager = new StorageManager();

/**
 * Gets the default artifact storage instance
 * @deprecated Use StorageManager for better control and testing
 */
export async function getArtifactStorage(
  config?: StorageConfig
): Promise<ArtifactStorage> {
  return defaultStorageManager.getStorage('default', config);
}

/**
 * Sets the default artifact storage instance
 * @deprecated Use StorageManager for better control and testing
 */
export function setArtifactStorage(storage: ArtifactStorage | null): void {
  if (storage) {
    defaultStorageManager.setStorage('default', storage);
  } else {
    defaultStorageManager.removeStorage('default');
  }
}

/**
 * Resets the default storage instance
 * @deprecated Use StorageManager for better control and testing
 */
export function resetArtifactStorage(): void {
  defaultStorageManager.clear();
}

/**
 * Gets the default storage manager
 */
export function getStorageManager(): StorageManager {
  return defaultStorageManager;
}

/**
 * Creates a new storage manager instance
 */
export function createStorageManager(config?: StorageConfig): StorageManager {
  return new StorageManager(config);
}

/**
 * Utility to calculate storage size for multiple artifacts
 */
export async function calculateTotalSize(
  storage: ArtifactStorage,
  artifactIds: string[]
): Promise<number> {
  let total = 0;
  
  for (const id of artifactIds) {
    const size = await storage.getSize(id);
    if (size !== null) {
      total += size;
    }
  }
  
  return total;
}

/**
 * Utility to bulk delete artifacts
 */
export async function bulkDelete(
  storage: ArtifactStorage,
  artifactIds: string[]
): Promise<void> {
  await Promise.all(artifactIds.map(id => storage.delete(id)));
}

/**
 * Common MIME types for artifacts
 */
export const MIME_TYPES = {
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  WEBP: 'image/webp',
  GEOJSON: 'application/geo+json',
  JSON: 'application/json',
  BINARY: 'application/octet-stream'
} as const;

export type MimeType = typeof MIME_TYPES[keyof typeof MIME_TYPES];