/**
 * Custom error hierarchy for the MCP server
 * Provides better error handling and debugging capabilities
 */

/**
 * Base error class for all MCP server errors
 */
export abstract class McpServerError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serializes the error for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack
    };
  }
}

/**
 * Configuration-related errors
 */
export class ConfigurationError extends McpServerError {
  constructor(
    message: string,
    public readonly field?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'CONFIGURATION_ERROR', { field, ...context });
  }
}

/**
 * HTTP client errors
 */
export class HttpClientError extends McpServerError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: any,
    context?: Record<string, unknown>
  ) {
    super(message, 'HTTP_CLIENT_ERROR', { statusCode, response, ...context });
  }
}

/**
 * Network timeout errors
 */
export class TimeoutError extends McpServerError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    context?: Record<string, unknown>
  ) {
    super(message, 'TIMEOUT_ERROR', { timeoutMs, ...context });
  }
}

/**
 * Circuit breaker errors
 */
export class CircuitBreakerError extends McpServerError {
  constructor(
    message: string,
    public readonly circuitState: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'CIRCUIT_BREAKER_ERROR', { circuitState, ...context });
  }
}

/**
 * Authentication/authorization errors
 */
export class AuthenticationError extends McpServerError {
  constructor(
    message: string,
    public readonly authType?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'AUTHENTICATION_ERROR', { authType, ...context });
  }
}

/**
 * Transport-related errors
 */
export class TransportError extends McpServerError {
  constructor(
    message: string,
    public readonly transportType?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'TRANSPORT_ERROR', { transportType, ...context });
  }
}

/**
 * Mapbox API specific errors
 */
export class MapboxApiError extends HttpClientError {
  constructor(
    message: string,
    statusCode?: number,
    public readonly mapboxErrorCode?: string,
    context?: Record<string, unknown>
  ) {
    super(message, statusCode, undefined, { mapboxErrorCode, ...context });
    (this as any).code = 'MAPBOX_API_ERROR';
  }
}

/**
 * Resource management errors
 */
export class ResourceError extends McpServerError {
  constructor(
    message: string,
    public readonly resourceType?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'RESOURCE_ERROR', { resourceType, ...context });
  }
}

/**
 * Validation errors for input data
 */
export class ValidationError extends McpServerError {
  constructor(
    message: string,
    public readonly validationErrors?: any[],
    context?: Record<string, unknown>
  ) {
    super(message, 'VALIDATION_ERROR', { validationErrors, ...context });
  }
}

/**
 * Type guard to check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpClientError) {
    // Retry on 5xx server errors, timeouts, and network errors
    return (
      !error.statusCode || // Network errors
      error.statusCode >= 500 || // Server errors
      error instanceof TimeoutError ||
      error.statusCode === 429 // Rate limiting
    );
  }

  if (error instanceof Error) {
    // Retry on common network error codes
    const networkErrors = [
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNABORTED'
    ];

    return networkErrors.some((code) => error.message.includes(code));
  }

  return false;
}

/**
 * Type guard to check if error indicates rate limiting
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof HttpClientError) {
    return error.statusCode === 429;
  }
  return false;
}

/**
 * Type guard to check if error is a client error (4xx)
 */
export function isClientError(error: unknown): boolean {
  if (error instanceof HttpClientError) {
    return (
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    );
  }
  return false;
}

/**
 * Type guard to check if error is a server error (5xx)
 */
export function isServerError(error: unknown): boolean {
  if (error instanceof HttpClientError) {
    return error.statusCode !== undefined && error.statusCode >= 500;
  }
  return false;
}

/**
 * Creates an error from an HTTP response
 */
export function createHttpError(
  response: { statusCode: number; body?: any },
  context?: Record<string, unknown>
): HttpClientError {
  const { statusCode, body } = response;

  let message = `HTTP ${statusCode}`;
  let errorCode: string | undefined;

  // Extract error details from response body
  if (body && typeof body === 'object') {
    if (body.message) {
      message = body.message;
    } else if (body.error) {
      message =
        typeof body.error === 'string' ? body.error : body.error.message;
    }

    errorCode = body.code || body.error_code;
  }

  // Create specific error types for Mapbox API
  if (
    context?.origin &&
    typeof context.origin === 'string' &&
    context.origin.includes('mapbox.com')
  ) {
    return new MapboxApiError(message, statusCode, errorCode, context);
  }

  return new HttpClientError(message, statusCode, body, context);
}
