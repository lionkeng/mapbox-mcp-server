/**
 * Unit tests for artifact storage interface
 * Testing storage abstraction, metadata handling, and TTL operations
 */

import {
  ArtifactStorage,
  ArtifactMetadata,
  StoredArtifact,
  createArtifactMetadata,
  validateArtifactMetadata,
  isExpired
} from '../../../services/artifact-storage';

// Mock implementation for testing the interface
class MockArtifactStorage implements ArtifactStorage {
  private artifacts = new Map<string, StoredArtifact>();
  private nextId = 1;

  async store(data: Buffer, metadata: ArtifactMetadata): Promise<string> {
    const id = `artifact-${this.nextId++}`;
    const artifact: StoredArtifact = {
      id,
      data,
      metadata: {
        ...metadata,
        sha256: metadata.sha256 || this.calculateSha256(data)
      },
      createdAt: new Date(),
      expiresAt: metadata.ttlSeconds 
        ? new Date(Date.now() + metadata.ttlSeconds * 1000)
        : undefined
    };
    this.artifacts.set(id, artifact);
    return id;
  }

  async getSignedUrl(artifactId: string, ttl?: number): Promise<string> {
    if (!this.artifacts.has(artifactId)) {
      throw new Error(`Artifact ${artifactId} not found`);
    }
    const expires = ttl ? Date.now() + ttl * 1000 : Date.now() + 3600000;
    return `https://mock.storage/artifacts/${artifactId}?expires=${expires}`;
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

  async exists(artifactId: string): Promise<boolean> {
    const artifact = await this.get(artifactId);
    return artifact !== null;
  }

  async getSize(artifactId: string): Promise<number | null> {
    const artifact = await this.get(artifactId);
    return artifact ? artifact.data.byteLength : null;
  }

  async listArtifacts(): Promise<string[]> {
    return Array.from(this.artifacts.keys());
  }

  private calculateSha256(data: Buffer): string {
    // Mock SHA-256 calculation
    return `sha256-${data.byteLength}`;
  }
}

describe('Artifact Storage Interface', () => {
  let storage: ArtifactStorage;

  beforeEach(() => {
    storage = new MockArtifactStorage();
  });

  describe('ArtifactMetadata', () => {
    it('should create valid metadata with required fields', () => {
      const metadata = createArtifactMetadata({
        mime: 'image/png',
        tool: 'static_map_tool'
      });

      expect(metadata.mime).toBe('image/png');
      expect(metadata.tool).toBe('static_map_tool');
    });

    it('should include optional fields when provided', () => {
      const metadata = createArtifactMetadata({
        mime: 'application/geo+json',
        tool: 'directions_tool',
        userId: 'user123',
        requestId: 'req456',
        ttlSeconds: 3600,
        tags: {
          profile: 'driving',
          distance: '19.8km'
        }
      });

      expect(metadata.userId).toBe('user123');
      expect(metadata.requestId).toBe('req456');
      expect(metadata.ttlSeconds).toBe(3600);
      expect(metadata.tags).toEqual({
        profile: 'driving',
        distance: '19.8km'
      });
    });

    it('should validate required fields', () => {
      expect(() => {
        validateArtifactMetadata({ mime: 'image/png', tool: 'test' });
      }).not.toThrow();

      expect(() => {
        validateArtifactMetadata({ mime: 'image/png' } as any);
      }).toThrow('Invalid ArtifactMetadata: missing required field "tool"');

      expect(() => {
        validateArtifactMetadata({ tool: 'test' } as any);
      }).toThrow('Invalid ArtifactMetadata: missing required field "mime"');
    });

    it('should validate MIME type format', () => {
      expect(() => {
        validateArtifactMetadata({ mime: 'invalid', tool: 'test' });
      }).toThrow('Invalid ArtifactMetadata: invalid MIME type format');

      expect(() => {
        validateArtifactMetadata({ mime: 'image/png', tool: 'test' });
      }).not.toThrow();

      expect(() => {
        validateArtifactMetadata({ mime: 'application/geo+json', tool: 'test' });
      }).not.toThrow();
    });
  });

  describe('Storage Operations', () => {
    it('should store an artifact and return its ID', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool'
      });

      const id = await storage.store(data, metadata);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should retrieve a stored artifact by ID', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool',
        userId: 'user123'
      });

      const id = await storage.store(data, metadata);
      const artifact = await storage.get(id);

      expect(artifact).not.toBeNull();
      expect(artifact!.id).toBe(id);
      expect(artifact!.data.toString()).toBe('test data');
      expect(artifact!.metadata.mime).toBe('text/plain');
      expect(artifact!.metadata.tool).toBe('test_tool');
      expect(artifact!.metadata.userId).toBe('user123');
      expect(artifact!.createdAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent artifact', async () => {
      const artifact = await storage.get('non-existent-id');
      expect(artifact).toBeNull();
    });

    it('should delete an artifact', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool'
      });

      const id = await storage.store(data, metadata);
      
      // Verify it exists
      let artifact = await storage.get(id);
      expect(artifact).not.toBeNull();

      // Delete it
      await storage.delete(id);

      // Verify it's gone
      artifact = await storage.get(id);
      expect(artifact).toBeNull();
    });

    it('should generate SHA-256 hash if not provided', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool'
      });

      const id = await storage.store(data, metadata);
      const artifact = await storage.get(id);

      expect(artifact!.metadata.sha256).toBeDefined();
      expect(artifact!.metadata.sha256).toMatch(/^sha256-/);
    });

    it('should use provided SHA-256 hash', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool',
        sha256: 'abc123def456'
      });

      const id = await storage.store(data, metadata);
      const artifact = await storage.get(id);

      expect(artifact!.metadata.sha256).toBe('abc123def456');
    });
  });

  describe('Signed URLs', () => {
    it('should generate a signed URL for an existing artifact', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'image/png',
        tool: 'test_tool'
      });

      const id = await storage.store(data, metadata);
      const url = await storage.getSignedUrl(id);

      expect(url).toBeDefined();
      expect(url).toMatch(/^https?:\/\//);
      expect(url).toContain(id);
      expect(url).toContain('expires=');
    });

    it('should generate signed URL with custom TTL', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'image/png',
        tool: 'test_tool'
      });

      const id = await storage.store(data, metadata);
      const url = await storage.getSignedUrl(id, 7200); // 2 hours

      expect(url).toBeDefined();
      const urlObj = new URL(url);
      const expires = parseInt(urlObj.searchParams.get('expires') || '0');
      const now = Date.now();
      
      // Should expire in approximately 2 hours (allowing some tolerance)
      expect(expires).toBeGreaterThan(now + 7100000);
      expect(expires).toBeLessThan(now + 7300000);
    });

    it('should throw error for non-existent artifact', async () => {
      await expect(
        storage.getSignedUrl('non-existent-id')
      ).rejects.toThrow('Artifact non-existent-id not found');
    });
  });

  describe('TTL and Expiration', () => {
    it('should set expiration time based on TTL', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool',
        ttlSeconds: 60 // 1 minute
      });

      const id = await storage.store(data, metadata);
      const artifact = await storage.get(id);

      expect(artifact!.expiresAt).toBeDefined();
      expect(artifact!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(artifact!.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 60000);
    });

    it('should not set expiration if TTL not provided', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool'
      });

      const id = await storage.store(data, metadata);
      const artifact = await storage.get(id);

      expect(artifact!.expiresAt).toBeUndefined();
    });

    it('should check if artifact is expired', () => {
      const past = new Date(Date.now() - 1000);
      const future = new Date(Date.now() + 1000);

      expect(isExpired(past)).toBe(true);
      expect(isExpired(future)).toBe(false);
      expect(isExpired(undefined)).toBe(false);
    });

    it('should cleanup expired artifacts', async () => {
      // Store artifacts with different TTLs
      const data = Buffer.from('test data');
      
      // Will expire very quickly
      const metadata1 = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool',
        ttlSeconds: 0.001 // Expires in 1ms
      });
      
      // Not expired
      const metadata2 = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool',
        ttlSeconds: 3600 // 1 hour
      });

      const id1 = await storage.store(data, metadata1);
      const id2 = await storage.store(data, metadata2);

      // Wait to ensure first artifact has expired
      await new Promise(resolve => setTimeout(resolve, 10));

      const deletedCount = await storage.cleanupExpired();
      
      expect(deletedCount).toBe(1);
      
      // Check that expired artifact is gone
      const artifact1 = await storage.get(id1);
      expect(artifact1).toBeNull();
      
      // Check that non-expired artifact remains
      const artifact2 = await storage.get(id2);
      expect(artifact2).not.toBeNull();
    });

    it('should auto-delete expired artifact on get', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool',
        ttlSeconds: 0.001 // Expires almost immediately
      });

      const id = await storage.store(data, metadata);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const artifact = await storage.get(id);
      expect(artifact).toBeNull();
    });
  });

  describe('Extended Operations', () => {
    it('should check if artifact exists', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool'
      });

      const id = await storage.store(data, metadata);
      
      expect(await storage.exists(id)).toBe(true);
      expect(await storage.exists('non-existent')).toBe(false);
    });

    it('should get artifact size', async () => {
      const data = Buffer.from('test data of specific size');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool'
      });

      const id = await storage.store(data, metadata);
      const size = await storage.getSize(id);
      
      expect(size).toBe(data.byteLength);
    });

    it('should return null size for non-existent artifact', async () => {
      const size = await storage.getSize('non-existent');
      expect(size).toBeNull();
    });

    it('should list all artifact IDs', async () => {
      const data = Buffer.from('test data');
      const metadata = createArtifactMetadata({
        mime: 'text/plain',
        tool: 'test_tool'
      });

      const id1 = await storage.store(data, metadata);
      const id2 = await storage.store(data, metadata);
      const id3 = await storage.store(data, metadata);

      const ids = await storage.listArtifacts();
      
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).toContain(id3);
      expect(ids.length).toBe(3);
    });
  });
});