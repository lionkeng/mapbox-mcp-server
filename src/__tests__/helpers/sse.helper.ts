/**
 * SSE (Server-Sent Events) test helpers
 * Provides utilities for managing SSE connections with proper cleanup
 */

import { createTestToken, createAuthHeader } from './auth.helper.js';
import { HTTP_STATUS } from './constants.js';

/**
 * SSE Connection wrapper for proper resource management
 */
export class SseConnection {
  private response: Response | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private sessionId: string | null = null;
  private serverUrl: string;
  private token: string;
  private cleanup: (() => Promise<void>)[] = [];

  constructor(serverUrl: string, token?: string) {
    this.serverUrl = serverUrl;
    this.token = token || createTestToken();
  }

  /**
   * Establish SSE connection
   */
  async connect(customHeaders: Record<string, string> = {}): Promise<{
    response: Response;
    sessionId: string;
  }> {
    try {
      this.response = await fetch(`${this.serverUrl}/mcp`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...createAuthHeader(this.token),
          ...customHeaders
        }
      });

      if (!this.response.ok) {
        throw new Error(
          `SSE connection failed with status ${this.response.status}`
        );
      }

      this.sessionId = this.response.headers.get('mcp-session-id');
      if (!this.sessionId) {
        throw new Error('No session ID received from SSE connection');
      }

      // Set up reader for potential streaming tests
      if (this.response.body) {
        this.reader = this.response.body.getReader();
      }

      return {
        response: this.response,
        sessionId: this.sessionId
      };
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /**
   * Get the session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get the response object
   */
  getResponse(): Response | null {
    return this.response;
  }

  /**
   * Read a chunk from the SSE stream
   */
  async readChunk(): Promise<string | null> {
    if (!this.reader) {
      throw new Error(
        'No reader available - connection not established or already closed'
      );
    }

    const { done, value } = await this.reader.read();

    if (done) {
      return null;
    }

    return new TextDecoder().decode(value);
  }

  /**
   * Add a cleanup function to be called when the connection is closed
   */
  addCleanup(cleanupFn: () => Promise<void>): void {
    this.cleanup.push(cleanupFn);
  }

  /**
   * Gracefully close the SSE connection and clean up resources
   */
  async close(): Promise<void> {
    const errors: Error[] = [];

    // Close the reader first - this will automatically handle the stream cleanup
    if (this.reader) {
      try {
        await this.reader.cancel();
        this.reader = null;
      } catch (error) {
        errors.push(new Error(`Error closing reader: ${error}`));
      }
    } else if (this.response?.body) {
      // Only cancel the response body if we don't have a reader
      // (to avoid "ReadableStream is locked" errors)
      try {
        await this.response.body.cancel();
      } catch (error) {
        errors.push(new Error(`Error canceling response body: ${error}`));
      }
    }

    // Delete the session if we have a session ID
    if (this.sessionId) {
      try {
        const deleteResponse = await fetch(`${this.serverUrl}/mcp`, {
          method: 'DELETE',
          headers: {
            ...createAuthHeader(this.token),
            'Mcp-Session-Id': this.sessionId
          }
        });

        // Session deletion should return 204 No Content
        if (deleteResponse.status !== HTTP_STATUS.NO_CONTENT) {
          errors.push(
            new Error(
              `Session deletion returned unexpected status: ${deleteResponse.status}`
            )
          );
        }
      } catch (error) {
        errors.push(new Error(`Error deleting session: ${error}`));
      }
    }

    // Run custom cleanup functions
    for (const cleanupFn of this.cleanup) {
      try {
        await cleanupFn();
      } catch (error) {
        errors.push(new Error(`Error in custom cleanup: ${error}`));
      }
    }

    // Clear state
    this.response = null;
    this.sessionId = null;
    this.cleanup = [];

    // Report any errors (but don't throw to avoid masking test failures)
    if (errors.length > 0) {
      console.warn('SSE connection cleanup encountered errors:', errors);
    }
  }
}

/**
 * Connection pool for managing multiple SSE connections
 */
export class SseConnectionPool {
  private connections: SseConnection[] = [];
  private serverUrl: string;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  /**
   * Create a new SSE connection and add it to the pool
   */
  async createConnection(
    token?: string,
    customHeaders?: Record<string, string>
  ): Promise<SseConnection> {
    const connection = new SseConnection(this.serverUrl, token);
    await connection.connect(customHeaders);
    this.connections.push(connection);
    return connection;
  }

  /**
   * Create multiple concurrent connections
   */
  async createMultipleConnections(
    count: number,
    token?: string,
    customHeaders?: Record<string, string>
  ): Promise<SseConnection[]> {
    const connectionPromises = Array.from({ length: count }, () =>
      this.createConnection(token, customHeaders)
    );

    const connections = await Promise.all(connectionPromises);
    return connections;
  }

  /**
   * Get all connections in the pool
   */
  getConnections(): SseConnection[] {
    return [...this.connections];
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.length;
  }

  /**
   * Close a specific connection and remove it from the pool
   */
  async closeConnection(connection: SseConnection): Promise<void> {
    await connection.close();
    const index = this.connections.indexOf(connection);
    if (index > -1) {
      this.connections.splice(index, 1);
    }
  }

  /**
   * Close all connections in the pool
   */
  async closeAll(): Promise<void> {
    const closePromises = this.connections.map((conn) => conn.close());
    await Promise.all(closePromises);
    this.connections = [];
  }

  /**
   * Get all session IDs from active connections
   */
  getSessionIds(): (string | null)[] {
    return this.connections.map((conn) => conn.getSessionId());
  }

  /**
   * Verify all connections have unique session IDs
   */
  verifyUniqueSessionIds(): boolean {
    const sessionIds = this.getSessionIds().filter((id) => id !== null);
    const uniqueIds = new Set(sessionIds);
    return uniqueIds.size === sessionIds.length;
  }
}

/**
 * Higher-level helper functions for common SSE test patterns
 */

/**
 * Test SSE connection establishment with automatic cleanup
 */
export async function testSseConnection(
  serverUrl: string,
  token?: string,
  customHeaders?: Record<string, string>
): Promise<{
  connection: SseConnection;
  cleanup: () => Promise<void>;
}> {
  const connection = new SseConnection(serverUrl, token);
  await connection.connect(customHeaders);

  return {
    connection,
    cleanup: () => connection.close()
  };
}

/**
 * Test multiple concurrent SSE connections with automatic cleanup
 */
export async function testConcurrentSseConnections(
  serverUrl: string,
  count: number,
  token?: string
): Promise<{
  pool: SseConnectionPool;
  connections: SseConnection[];
  cleanup: () => Promise<void>;
}> {
  const pool = new SseConnectionPool(serverUrl);
  const connections = await pool.createMultipleConnections(count, token);

  return {
    pool,
    connections,
    cleanup: () => pool.closeAll()
  };
}

/**
 * Performance test helper for SSE connections
 */
export async function measureSseConnectionTime(
  serverUrl: string,
  token?: string
): Promise<{
  connectionTime: number;
  connection: SseConnection;
  cleanup: () => Promise<void>;
}> {
  const startTime = Date.now();
  const connection = new SseConnection(serverUrl, token);
  await connection.connect();
  const connectionTime = Date.now() - startTime;

  return {
    connectionTime,
    connection,
    cleanup: () => connection.close()
  };
}

/**
 * Stress test helper for rapid connection creation/destruction
 */
export async function stresTestSseConnections(
  serverUrl: string,
  iterations: number,
  token?: string
): Promise<{
  averageConnectionTime: number;
  averageCleanupTime: number;
  errors: Error[];
}> {
  const connectionTimes: number[] = [];
  const cleanupTimes: number[] = [];
  const errors: Error[] = [];

  for (let i = 0; i < iterations; i++) {
    try {
      // Measure connection time
      const connectStart = Date.now();
      const connection = new SseConnection(serverUrl, token);
      await connection.connect();
      connectionTimes.push(Date.now() - connectStart);

      // Measure cleanup time
      const cleanupStart = Date.now();
      await connection.close();
      cleanupTimes.push(Date.now() - cleanupStart);

      // Small delay to avoid overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error) {
      errors.push(error as Error);
    }
  }

  return {
    averageConnectionTime:
      connectionTimes.reduce((a, b) => a + b, 0) / connectionTimes.length || 0,
    averageCleanupTime:
      cleanupTimes.reduce((a, b) => a + b, 0) / cleanupTimes.length || 0,
    errors
  };
}
