/**
 * Centralized test constants and configuration
 * Provides consistent values across all test suites
 */

/**
 * HTTP Status Codes for different error scenarios
 */
export const HTTP_STATUS = {
  // Success
  OK: 200,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  // Client Errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,

  // Server Errors
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const;

/**
 * JSON-RPC Error Codes (as per JSON-RPC 2.0 specification)
 */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Custom application errors
  TOOL_NOT_FOUND: -32601,
  PERMISSION_DENIED: -32000,
  AUTHENTICATION_FAILED: -32001,
  VALIDATION_ERROR: -32002
} as const;

/**
 * Test timeout values in milliseconds
 */
export const TIMEOUTS = {
  UNIT_TEST: 5000, // 5 seconds for unit tests
  INTEGRATION_TEST: 15000, // 15 seconds for integration tests
  E2E_TEST: 30000, // 30 seconds for E2E tests
  PERFORMANCE_TEST: 60000, // 60 seconds for performance tests
  SSE_CONNECTION: 10000, // 10 seconds for SSE connection tests
  LONG_RUNNING: 90000 // 90 seconds for complex workflows
} as const;

/**
 * Test server configuration constants
 */
export const TEST_SERVER_CONFIG = {
  HOST: '127.0.0.1',
  PORT: 0, // Use random port
  REQUEST_TIMEOUT: 10000,
  BODY_LIMIT: 1048576, // 1MB
  JWT_SECRET: 'test-secret-key-at-least-32-characters-long-for-testing'
} as const;

/**
 * Error expectation patterns for different scenarios
 */
export const ERROR_EXPECTATIONS = {
  // Authentication errors (missing/invalid JWT) should return HTTP 401
  AUTHENTICATION: {
    HTTP_STATUS: HTTP_STATUS.UNAUTHORIZED,
    JSON_RPC_ERROR: undefined // No JSON-RPC response for auth failures
  },

  // Authorization errors (valid JWT, insufficient permissions) should return HTTP 200 with JSON-RPC error
  AUTHORIZATION: {
    HTTP_STATUS: HTTP_STATUS.OK,
    JSON_RPC_ERROR: JSON_RPC_ERRORS.PERMISSION_DENIED
  },

  // Protocol errors (malformed JSON-RPC) should return HTTP 400
  PROTOCOL: {
    HTTP_STATUS: HTTP_STATUS.BAD_REQUEST,
    JSON_RPC_ERROR: undefined
  },

  // Application errors (valid request, tool failure) should return HTTP 200 with JSON-RPC error
  APPLICATION: {
    HTTP_STATUS: HTTP_STATUS.OK,
    JSON_RPC_ERROR: JSON_RPC_ERRORS.INTERNAL_ERROR
  },

  // Validation errors (invalid parameters) should return HTTP 200 with JSON-RPC error
  VALIDATION: {
    HTTP_STATUS: HTTP_STATUS.OK,
    JSON_RPC_ERROR: JSON_RPC_ERRORS.INVALID_PARAMS
  },

  // Tool not found should return HTTP 200 with JSON-RPC error
  TOOL_NOT_FOUND: {
    HTTP_STATUS: HTTP_STATUS.OK,
    JSON_RPC_ERROR: JSON_RPC_ERRORS.TOOL_NOT_FOUND
  }
} as const;

/**
 * Performance thresholds for testing
 */
export const PERFORMANCE_THRESHOLDS = {
  // Response time thresholds in milliseconds
  TOOLS_LIST_RESPONSE: 1000,
  GEOCODING_RESPONSE: 2000,
  CONCURRENT_REQUESTS: 10000,
  SSE_CONNECTION: 1000,

  // Throughput thresholds
  REQUESTS_PER_SECOND: 10,
  CONCURRENT_CONNECTIONS: 20,

  // Memory and resource thresholds
  MAX_MEMORY_USAGE_MB: 512,
  MAX_RESPONSE_SIZE_KB: 100
} as const;

/**
 * Test data size constants
 */
export const TEST_DATA_SIZES = {
  SMALL_BATCH: 5,
  MEDIUM_BATCH: 20,
  LARGE_BATCH: 50,
  STRESS_BATCH: 100,

  CONCURRENT_LOW: 5,
  CONCURRENT_MEDIUM: 10,
  CONCURRENT_HIGH: 20,

  ITERATIONS_QUICK: 5,
  ITERATIONS_STANDARD: 10,
  ITERATIONS_EXTENSIVE: 50
} as const;

/**
 * Retry and backoff constants
 */
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY: 100,
  BACKOFF_MULTIPLIER: 2,
  MAX_DELAY: 5000
} as const;

/**
 * Content type constants for HTTP requests
 */
export const CONTENT_TYPES = {
  JSON: 'application/json',
  EVENT_STREAM: 'text/event-stream',
  FORM_DATA: 'application/x-www-form-urlencoded',
  TEXT_PLAIN: 'text/plain',
  HTML: 'text/html'
} as const;

/**
 * Common test patterns and expectations
 */
export const TEST_PATTERNS = {
  UUID_REGEX: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  ISO_DATE_REGEX: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  JWT_REGEX: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/,
  SESSION_ID_REGEX: /^[a-zA-Z0-9-_]{10,}$/
} as const;

/**
 * JSON-RPC response interface for type safety
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Error response interface
 */
export interface ErrorResponse {
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

/**
 * Helper function to create error expectation matcher
 */
export function expectError(
  scenario: keyof typeof ERROR_EXPECTATIONS,
  response: { status: number },
  data?: ErrorResponse
): void {
  const expectation = ERROR_EXPECTATIONS[scenario];

  expect(response.status).toBe(expectation.HTTP_STATUS);

  if (expectation.JSON_RPC_ERROR && data) {
    expect(data.error).toBeDefined();
    expect(data.error?.code).toBe(expectation.JSON_RPC_ERROR);
  }
}

/**
 * Helper function to create success expectation matcher
 */
export function expectSuccess(
  response: { status: number },
  data?: JsonRpcResponse
): void {
  expect(response.status).toBe(HTTP_STATUS.OK);

  if (data) {
    expect(data.jsonrpc).toBe('2.0');
    expect(data.result).toBeDefined();
    expect(data.error).toBeUndefined();
  }
}

/**
 * Helper function to validate response timing
 */
export function expectTimingWithin(
  actualTime: number,
  expectedThreshold: number,
  operation: string
) {
  expect(actualTime).toBeLessThan(expectedThreshold);

  if (actualTime > expectedThreshold * 0.8) {
    console.warn(
      `⚠️ ${operation} took ${actualTime}ms, approaching threshold of ${expectedThreshold}ms`
    );
  }
}
