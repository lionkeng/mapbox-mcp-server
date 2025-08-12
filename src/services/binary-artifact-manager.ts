/**
 * Simple binary artifact manager for separating binary data from text responses
 * This helps reduce token usage by storing all binary data (images, PDFs, etc.) separately
 */

import { randomUUID } from 'crypto';

/**
 * Size threshold for when text/JSON data should become an artifact
 * Binary data (images, PDFs) always become artifacts regardless of size
 * Text/JSON data becomes an artifact when exceeding this threshold
 */
export const ARTIFACT_SIZE_THRESHOLD_BYTES = 50000; // 50KB

/**
 * Artifact reference with explicit fetch metadata
 */
export interface ArtifactReference {
  url: string;
  fetchMode: 'direct' | 'proxy';
  mimeType: string;
  expires?: string;
  size?: number;
}

/**
 * Metadata for stored artifacts
 */
export interface ArtifactMetadata {
  mime: string;
  tool: string;
  createdAt: Date;
  expiresAt?: Date;
}

/**
 * Stored artifact data
 */
export interface StoredArtifact {
  id: string;
  data: Buffer;
  metadata: ArtifactMetadata;
}

/**
 * Simple in-memory artifact manager
 * For production use, this should be replaced with S3, GCS, or filesystem storage
 */
export class BinaryArtifactManager {
  private artifacts = new Map<string, StoredArtifact>();
  private readonly ttlMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(ttlSeconds = 3600) {
    this.ttlMs = ttlSeconds * 1000;
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60000); // Clean up every minute
  }

  /**
   * Store a binary artifact and return its ID
   */
  store(data: Buffer, tool: string, mime: string): string {
    const id = randomUUID();
    const metadata: ArtifactMetadata = {
      mime,
      tool,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.ttlMs)
    };

    this.artifacts.set(id, { id, data, metadata });
    return id;
  }

  /**
   * Retrieve an artifact by ID
   */
  get(id: string): StoredArtifact | null {
    const artifact = this.artifacts.get(id);
    if (!artifact) return null;

    // Check expiration
    if (artifact.metadata.expiresAt && artifact.metadata.expiresAt < new Date()) {
      this.artifacts.delete(id);
      return null;
    }

    return artifact;
  }

  /**
   * Get a URL for accessing the artifact
   * In development: returns relative URL for proxy
   * In production: returns signed S3/GCS URL
   */
  getUrl(id: string): string {
    // In production, this would return a signed S3 URL
    // For now, return a relative URL for proxy mode
    return `/artifacts/${id}`;
  }

  /**
   * Get the fetch mode for the current environment
   */
  getFetchMode(): 'direct' | 'proxy' {
    // In production with S3/CDN, this would return 'direct'
    // For in-memory storage, always use proxy
    return 'proxy';
  }

  /**
   * Create a complete artifact reference with metadata
   */
  createReference(id: string, mimeType: string): ArtifactReference {
    const artifact = this.get(id);
    
    return {
      url: this.getUrl(id),
      fetchMode: this.getFetchMode(),
      mimeType,
      expires: artifact?.metadata.expiresAt?.toISOString(),
      size: artifact?.data.byteLength
    };
  }

  /**
   * Delete an artifact
   */
  delete(id: string): void {
    this.artifacts.delete(id);
  }

  /**
   * Clean up expired artifacts
   */
  private cleanupExpired(): void {
    const now = new Date();
    for (const [id, artifact] of this.artifacts.entries()) {
      if (artifact.metadata.expiresAt && artifact.metadata.expiresAt < now) {
        this.artifacts.delete(id);
      }
    }
  }

  /**
   * Dispose of the manager and clean up resources
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.artifacts.clear();
  }
}

/**
 * Default instance for simple usage
 */
let defaultManager: BinaryArtifactManager | null = null;

/**
 * Get the default artifact manager instance
 */
export function getArtifactManager(): BinaryArtifactManager {
  if (!defaultManager) {
    defaultManager = new BinaryArtifactManager();
  }
  return defaultManager;
}

/**
 * Reset the default manager (useful for testing)
 */
export function resetArtifactManager(): void {
  if (defaultManager) {
    defaultManager.dispose();
    defaultManager = null;
  }
}