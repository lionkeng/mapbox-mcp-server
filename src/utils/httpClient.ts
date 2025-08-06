import { Pool, Dispatcher } from 'undici';
import { getEnv } from '@/config/environment.js';
import {
  HttpClientError,
  TimeoutError,
  CircuitBreakerError,
  createHttpError,
  isRetryableError,
  isRateLimitError
} from './errors.js';
import { registerCleanup } from './shutdown.js';

/**
 * High-performance HTTP client using Undici with connection pooling
 * Optimized for making external API calls to services like Mapbox
 */

// Connection pools for different domains
const pools = new Map<string, Pool>();

// Circuit breakers for different origins
const circuitBreakers = new Map<string, CircuitBreaker>();

// Default circuit breaker configuration
const defaultCircuitBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 5, // Open circuit after 5 failures
  resetTimeout: 60000, // Try again after 60 seconds
  monitoringPeriod: 10000 // Monitor failures over 10 seconds
};

/**
 * Pool configuration optimized for API servers
 */
interface PoolConfig {
  connections: number;
  pipelining: number;
  keepAliveTimeout: number;
  keepAliveMaxTimeout: number;
  bodyTimeout: number;
  headersTimeout: number;
}

/**
 * Circuit breaker states
 */
enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

/**
 * Circuit breaker implementation
 */
class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime = 0;
  private nextAttempt = 0;

  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new CircuitBreakerError('Circuit breaker is OPEN', this.state);
      }
      this.state = CircuitState.HALF_OPEN;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.config.resetTimeout;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): {
    state: CircuitState;
    failures: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

/**
 * Default pool configuration for high-performance API calls
 */
function getDefaultPoolConfig(): PoolConfig {
  const env = getEnv();
  return {
    connections: env.MAX_CONNECTIONS,
    pipelining: 10, // Allow multiple requests per connection
    keepAliveTimeout: env.KEEP_ALIVE_TIMEOUT,
    keepAliveMaxTimeout: env.KEEP_ALIVE_TIMEOUT * 20, // 10 minutes max
    bodyTimeout: env.REQUEST_TIMEOUT,
    headersTimeout: 5000 // 5 seconds for headers
  };
}

/**
 * Specialized pool configuration for Mapbox API
 */
function getMapboxPoolConfig(): PoolConfig {
  const defaultConfig = getDefaultPoolConfig();
  const env = getEnv();
  return {
    ...defaultConfig,
    connections: Math.min(env.MAX_CONNECTIONS, 20), // Mapbox has rate limits
    pipelining: 5 // Conservative pipelining for Mapbox
  };
}

/**
 * Gets or creates a circuit breaker for the given origin
 */
function getCircuitBreaker(origin: string): CircuitBreaker {
  if (!circuitBreakers.has(origin)) {
    circuitBreakers.set(
      origin,
      new CircuitBreaker(defaultCircuitBreakerConfig)
    );
  }
  return circuitBreakers.get(origin)!;
}

/**
 * Gets or creates a connection pool for the given origin
 */
function getPool(origin: string, config?: PoolConfig): Pool {
  if (!pools.has(origin)) {
    const poolConfig = config || getDefaultPoolConfig();
    const pool = new Pool(origin, {
      connections: poolConfig.connections,
      pipelining: poolConfig.pipelining,
      keepAliveTimeout: poolConfig.keepAliveTimeout,
      keepAliveMaxTimeout: poolConfig.keepAliveMaxTimeout,
      bodyTimeout: poolConfig.bodyTimeout,
      headersTimeout: poolConfig.headersTimeout
    });

    pools.set(origin, pool);

    // Add error handling for the pool
    pool.on('disconnect', (origin, targets, error) => {
      console.warn(
        `Pool disconnected from ${origin}:`,
        error?.message || 'Unknown error'
      );
    });

    pool.on('connect', (origin, _targets) => {
      console.debug(`Pool connected to ${origin}`);
    });

    // Register cleanup for this pool
    registerCleanup(
      `http-pool-${origin}`,
      async () => {
        try {
          await pool.close();
          console.log(`Closed HTTP pool for ${origin}`);
        } catch (error) {
          console.error(`Error closing HTTP pool for ${origin}:`, error);
        }
      },
      pool
    );
  }

  return pools.get(origin)!;
}

/**
 * Gets the Mapbox API pool with optimized configuration
 */
export function getMapboxPool(): Pool {
  const env = getEnv();
  return getPool(env.MAPBOX_API_ENDPOINT, getMapboxPoolConfig());
}

/**
 * Gets a generic pool for any origin
 */
export function getGenericPool(origin: string): Pool {
  return getPool(origin);
}

/**
 * Request options for HTTP client
 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | Buffer | Uint8Array;
  query?: Record<string, string | number | boolean>;
  timeout?: number;
  signal?: AbortSignal;
  retries?: number;
  retryDelay?: number;
  circuitBreaker?: boolean;
}

/**
 * Response interface with proper typing
 */
export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: any;
  trailers: Record<string, string>;
}

/**
 * Calculates exponential backoff delay with jitter
 */
function calculateRetryDelay(attempt: number, baseDelay: number): number {
  const exponential = Math.min(baseDelay * Math.pow(2, attempt), 30000); // Max 30s
  const jitter = exponential * 0.1 * Math.random(); // Add 10% jitter
  return Math.floor(exponential + jitter);
}

/**
 * Sleeps for the specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => global.setTimeout(resolve, ms));
}

/**
 * Low-level HTTP request function without retry logic
 */
async function makeRawRequest(
  url: string,
  options: RequestOptions
): Promise<HttpResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    query,
    timeout,
    signal
  } = options;

  const env = getEnv();
  const requestTimeout = timeout || env.REQUEST_TIMEOUT;

  // Parse URL to get origin and path
  const urlObj = new URL(url);
  const origin = `${urlObj.protocol}//${urlObj.host}`;

  // Build query string
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      urlObj.searchParams.set(key, String(value));
    });
  }

  const pool = getPool(origin);

  try {
    const response = await pool.request({
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mapbox-MCP-Server/1.0',
        ...headers
      },
      body: body ?? null,
      bodyTimeout: requestTimeout,
      headersTimeout: Math.min(requestTimeout, 5000),
      signal
    });

    // Read response body
    let responseBody: unknown;
    const responseData = response as Dispatcher.ResponseData;
    try {
      responseBody = await responseData.body.json();
    } catch {
      // Fallback to text if JSON parsing fails
      responseBody = await responseData.body.text();
    }

    const httpResponse: HttpResponse = {
      statusCode: responseData.statusCode,
      headers: responseData.headers as Record<string, string | string[]>,
      body: responseBody,
      trailers: responseData.trailers as Record<string, string>
    };

    // Check for HTTP errors
    if (responseData.statusCode >= 400) {
      throw createHttpError(
        { statusCode: responseData.statusCode, body: responseBody },
        { origin, url, method }
      );
    }

    return httpResponse;
  } catch (error) {
    // Enhanced error handling with context
    if (error instanceof HttpClientError) {
      throw error; // Re-throw our custom errors
    }

    if (error instanceof Error) {
      // Check for timeout errors
      if (
        error.message.includes('timeout') ||
        error.message.includes('ETIMEDOUT')
      ) {
        throw new TimeoutError(
          `Request timeout after ${requestTimeout}ms`,
          requestTimeout,
          { origin, url, method }
        );
      }

      throw new HttpClientError(
        `HTTP request failed for ${method} ${url}: ${error.message}`,
        undefined,
        undefined,
        { origin, url, method, originalError: error.message }
      );
    }
    throw error;
  }
}

/**
 * High-performance HTTP request function with retry logic and circuit breaker
 */
export async function makeRequest(
  url: string,
  options: RequestOptions = {}
): Promise<HttpResponse> {
  const {
    retries = 3,
    retryDelay = 1000,
    circuitBreaker = true,
    ...requestOptions
  } = options;

  const urlObj = new URL(url);
  const origin = `${urlObj.protocol}//${urlObj.host}`;
  const breaker = circuitBreaker ? getCircuitBreaker(origin) : null;

  const executeRequest = async (): Promise<HttpResponse> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await makeRawRequest(url, requestOptions);
        return response;
      } catch (error) {
        // Don't retry on the last attempt
        if (attempt === retries) {
          throw error;
        }

        // Check if error is retryable
        if (!isRetryableError(error)) {
          throw error;
        }

        // Calculate delay for next attempt
        let delay = calculateRetryDelay(attempt, retryDelay);

        // Increase delay for rate limit errors
        if (isRateLimitError(error)) {
          delay = Math.max(delay, 5000); // Minimum 5s for rate limits
        }

        console.warn(
          `Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms:`,
          error instanceof Error ? error.message : error
        );

        await sleep(delay);
      }
    }

    // This should never be reached due to the throw in the catch block
    throw new Error('Unexpected end of retry loop');
  };

  // Execute with circuit breaker if enabled
  if (breaker) {
    return breaker.execute(executeRequest);
  } else {
    return executeRequest();
  }
}

/**
 * Specialized function for Mapbox API requests
 * Includes automatic token injection and error handling
 */
export async function makeMapboxRequest(
  path: string,
  options: RequestOptions = {}
): Promise<HttpResponse> {
  const env = getEnv();
  const url = new URL(path, env.MAPBOX_API_ENDPOINT);

  // Add access token to query parameters
  url.searchParams.set('access_token', env.MAPBOX_ACCESS_TOKEN);

  return makeRequest(url.toString(), {
    // Use conservative retry settings for Mapbox API
    retries: 2,
    retryDelay: 2000,
    circuitBreaker: true,
    ...options,
    headers: {
      'User-Agent': 'Mapbox-MCP-Server/1.0',
      ...options.headers
    }
  });
}

/**
 * Utility function for making GET requests with query parameters
 */
export async function get(
  url: string,
  query?: Record<string, string | number | boolean>,
  options: Omit<RequestOptions, 'method' | 'query'> = {}
): Promise<HttpResponse> {
  return makeRequest(url, {
    ...options,
    method: 'GET',
    ...(query && { query })
  });
}

/**
 * Utility function for making POST requests with JSON body
 */
export async function post(
  url: string,
  data?: any,
  options: Omit<RequestOptions, 'method' | 'body'> = {}
): Promise<HttpResponse> {
  return makeRequest(url, {
    ...options,
    method: 'POST',
    ...(data && { body: JSON.stringify(data) }),
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
}

/**
 * Gracefully closes all connection pools
 * Call this when shutting down the application
 */
export async function closeAllPools(): Promise<void> {
  const closePromises = Array.from(pools.values()).map((pool) => pool.close());
  await Promise.all(closePromises);
  pools.clear();
  console.log('All HTTP connection pools closed');
}

/**
 * Gets statistics for all active pools
 * Useful for monitoring and debugging
 */
export function getPoolStats(): Record<string, any> {
  const stats: Record<string, any> = {};

  for (const [origin, pool] of pools.entries()) {
    // Pool stats are not directly exposed in Undici
    // We'll track basic info about the pool's existence
    stats[origin] = {
      active: true,
      destroyed: pool.destroyed,
      closed: pool.closed
    };
  }

  return stats;
}

/**
 * Gets circuit breaker statistics for all origins
 */
export function getCircuitBreakerStats(): Record<string, any> {
  const stats: Record<string, any> = {};

  for (const [origin, breaker] of circuitBreakers.entries()) {
    stats[origin] = breaker.getStats();
  }

  return stats;
}

/**
 * Destroys and recreates a pool for the given origin
 * Useful for handling connection issues
 */
export async function recreatePool(origin: string): Promise<void> {
  const pool = pools.get(origin);
  if (pool) {
    await pool.close();
    pools.delete(origin);
    console.log(`Recreated pool for ${origin}`);
  }
}

// Register global cleanup for all pools
registerCleanup('http-client-pools', closeAllPools);
