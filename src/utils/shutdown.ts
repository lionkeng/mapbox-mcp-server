/**
 * Graceful shutdown coordinator for resource cleanup
 * Ensures proper cleanup of connections, pools, and other resources
 */

import { createLogger } from './logger.js';

const logger = createLogger('shutdown');

/**
 * Cleanup handler function type
 */
export type CleanupHandler = () => Promise<void>;

/**
 * Generic resource type for registry
 */
type ResourceType = Record<string, unknown> | unknown;

/**
 * Shutdown configuration
 */
interface ShutdownConfig {
  timeout: number; // Maximum time to wait for graceful shutdown
  signals: string[]; // Signals to listen for
}

/**
 * Default shutdown configuration
 */
const defaultConfig: ShutdownConfig = {
  timeout: 30000, // 30 seconds
  signals: ['SIGTERM', 'SIGINT', 'SIGUSR2']
};

/**
 * Resource manager for handling application lifecycle
 */
export class ResourceManager {
  private readonly cleanupHandlers: Map<string, CleanupHandler> = new Map();
  private readonly resources: Map<string, ResourceType> = new Map();
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  /**
   * Registers a cleanup handler for a named resource
   */
  register(
    name: string,
    cleanup: CleanupHandler,
    resource?: ResourceType
  ): void {
    if (this.isShuttingDown) {
      logger.warn('Attempting to register cleanup handler during shutdown', {
        name
      });
      return;
    }

    this.cleanupHandlers.set(name, cleanup);
    if (resource) {
      this.resources.set(name, resource);
    }

    logger.debug('Registered cleanup handler', {
      name,
      totalHandlers: this.cleanupHandlers.size
    });
  }

  /**
   * Unregisters a cleanup handler
   */
  unregister(name: string): void {
    const removed = this.cleanupHandlers.delete(name);
    this.resources.delete(name);

    if (removed) {
      logger.debug('Unregistered cleanup handler', {
        name,
        totalHandlers: this.cleanupHandlers.size
      });
    }
  }

  /**
   * Gets a registered resource by name
   */
  getResource<T = ResourceType>(name: string): T | undefined {
    return this.resources.get(name) as T;
  }

  /**
   * Lists all registered resource names
   */
  getResourceNames(): string[] {
    return Array.from(this.cleanupHandlers.keys());
  }

  /**
   * Performs cleanup of all registered resources
   */
  async cleanup(): Promise<void> {
    if (this.isShuttingDown) {
      return this.shutdownPromise || Promise.resolve();
    }

    this.isShuttingDown = true;
    const startTime = Date.now();

    logger.info('Starting resource cleanup', {
      totalResources: this.cleanupHandlers.size,
      resources: Array.from(this.cleanupHandlers.keys())
    });

    this.shutdownPromise = this.performCleanup();
    await this.shutdownPromise;

    const duration = Date.now() - startTime;
    logger.info('Resource cleanup completed', { duration });
  }

  /**
   * Internal cleanup implementation
   */
  private async performCleanup(): Promise<void> {
    // Create cleanup promises for all handlers
    const cleanupPromises = Array.from(this.cleanupHandlers.entries()).map(
      async ([name, handler]) => {
        try {
          logger.debug('Cleaning up resource', { name });
          await handler();
          logger.debug('Resource cleanup completed', { name });
        } catch (error) {
          logger.error(`Failed to cleanup resource: ${name}`, { error });
          // Continue with other cleanups even if one fails
        }
      }
    );

    // Wait for all cleanups to complete
    await Promise.allSettled(cleanupPromises);

    // Clear all handlers
    this.cleanupHandlers.clear();
    this.resources.clear();
  }

  /**
   * Checks if shutdown is in progress
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }
}

/**
 * Global resource manager instance
 */
export const resourceManager = new ResourceManager();

/**
 * Shutdown coordinator class
 */
export class ShutdownCoordinator {
  private readonly config: ShutdownConfig;
  private isSetup = false;
  private shutdownTimeout: NodeJS.Timeout | null = null;

  constructor(config: Partial<ShutdownConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Sets up signal handlers for graceful shutdown
   */
  setup(): void {
    if (this.isSetup) {
      logger.warn('Shutdown coordinator already setup');
      return;
    }

    this.isSetup = true;

    // Setup signal handlers
    for (const signal of this.config.signals) {
      process.on(signal as NodeJS.Signals, () => {
        logger.info(`Received ${signal}, initiating graceful shutdown`);
        this.shutdown(signal).catch((error) => {
          logger.error('Error during shutdown', { error });
          process.exit(1);
        });
      });
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.fatal('Uncaught exception', { error });
      this.shutdown('uncaughtException').finally(() => {
        process.exit(1);
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal('Unhandled promise rejection', { reason, promise });
      this.shutdown('unhandledRejection').finally(() => {
        process.exit(1);
      });
    });

    logger.info('Shutdown coordinator setup completed', {
      signals: this.config.signals,
      timeout: this.config.timeout
    });
  }

  /**
   * Initiates graceful shutdown
   */
  async shutdown(reason: string): Promise<void> {
    if (resourceManager.isShutdownInProgress()) {
      logger.info('Shutdown already in progress');
      return;
    }

    logger.info('Starting graceful shutdown', {
      reason,
      timeout: this.config.timeout
    });

    // Set timeout for forced shutdown
    this.shutdownTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, this.config.timeout);

    try {
      // Perform cleanup
      await resourceManager.cleanup();

      // Clear timeout
      if (this.shutdownTimeout) {
        clearTimeout(this.shutdownTimeout);
        this.shutdownTimeout = null;
      }

      logger.info('Graceful shutdown completed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', { error });
      process.exit(1);
    }
  }

  /**
   * Manually trigger shutdown (for testing)
   */
  async triggerShutdown(reason = 'manual'): Promise<void> {
    await this.shutdown(reason);
  }
}

/**
 * Global shutdown coordinator instance
 */
export const shutdownCoordinator = new ShutdownCoordinator();

/**
 * Convenience function to register a cleanup handler
 */
export function registerCleanup(
  name: string,
  cleanup: CleanupHandler,
  resource?: ResourceType
): void {
  resourceManager.register(name, cleanup, resource);
}

/**
 * Convenience function to setup graceful shutdown
 */
export function setupGracefulShutdown(config?: Partial<ShutdownConfig>): void {
  if (config) {
    const coordinator = new ShutdownCoordinator(config);
    coordinator.setup();
  } else {
    shutdownCoordinator.setup();
  }
}

/**
 * Health check for shutdown status
 */
export function getShutdownStatus(): {
  isShuttingDown: boolean;
  registeredResources: string[];
  totalResources: number;
} {
  return {
    isShuttingDown: resourceManager.isShutdownInProgress(),
    registeredResources: resourceManager.getResourceNames(),
    totalResources: resourceManager.getResourceNames().length
  };
}

/**
 * Object pool for frequently allocated objects
 */
export class ObjectPool<T> {
  private readonly pool: T[] = [];
  private readonly factory: () => T;
  private readonly reset: (obj: T) => void;
  private readonly maxSize: number;
  private created = 0;

  constructor(
    factory: () => T,
    reset: (obj: T) => void,
    options: { initialSize?: number; maxSize?: number } = {}
  ) {
    const { initialSize = 0, maxSize = 100 } = options;

    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;

    // Pre-populate pool
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
      this.created++;
    }

    // Register cleanup
    registerCleanup(`object-pool-${Date.now()}`, async () => {
      this.clear();
    });
  }

  /**
   * Acquires an object from the pool
   */
  acquire(): T {
    const obj = this.pool.pop();
    if (obj) {
      return obj;
    }

    // Create new object if pool is empty
    this.created++;
    return this.factory();
  }

  /**
   * Returns an object to the pool
   */
  release(obj: T): void {
    if (this.pool.length >= this.maxSize) {
      // Pool is full, discard object
      return;
    }

    try {
      this.reset(obj);
      this.pool.push(obj);
    } catch (error) {
      logger.warn('Failed to reset object for pool', { error });
      // Don't return object to pool if reset fails
    }
  }

  /**
   * Gets pool statistics
   */
  getStats(): {
    poolSize: number;
    maxSize: number;
    totalCreated: number;
    utilizationRate: number;
  } {
    return {
      poolSize: this.pool.length,
      maxSize: this.maxSize,
      totalCreated: this.created,
      utilizationRate: (this.created - this.pool.length) / this.created
    };
  }

  /**
   * Clears the pool
   */
  clear(): void {
    this.pool.length = 0;
  }
}

/**
 * Creates a response object pool for HTTP responses
 */
export function createResponsePool(
  initialSize = 10
): ObjectPool<Record<string, unknown>> {
  return new ObjectPool(
    () => ({}) as Record<string, unknown>,
    (obj) => {
      // Clear all properties
      Object.keys(obj).forEach((key) => delete obj[key]);
    },
    { initialSize, maxSize: 50 }
  );
}

/**
 * Creates an error object pool
 */
export function createErrorPool(
  initialSize = 5
): ObjectPool<{ message: string; code?: string; details?: unknown }> {
  return new ObjectPool(
    () => ({ message: '' }),
    (obj) => {
      obj.message = '';
      delete (obj as any).code;
      delete (obj as any).details;
    },
    { initialSize, maxSize: 20 }
  );
}
