/**
 * Test fixtures and common test data
 * Provides reusable test data for consistent testing
 */

/**
 * Common coordinate sets for testing
 */
export const TEST_COORDINATES = {
  SAN_FRANCISCO: {
    longitude: -122.4194,
    latitude: 37.7749
  },
  NEW_YORK: {
    longitude: -74.0059,
    latitude: 40.7128
  },
  LONDON: {
    longitude: -0.1276,
    latitude: 51.5074
  },
  INVALID: {
    longitude: 200, // Invalid longitude
    latitude: 100 // Invalid latitude
  },
  ZERO: {
    longitude: 0,
    latitude: 0
  }
} as const;

/**
 * Common coordinate arrays for directions/matrix testing
 */
export const COORDINATE_ARRAYS = {
  SF_TO_NYC: [
    [
      TEST_COORDINATES.SAN_FRANCISCO.longitude,
      TEST_COORDINATES.SAN_FRANCISCO.latitude
    ],
    [TEST_COORDINATES.NEW_YORK.longitude, TEST_COORDINATES.NEW_YORK.latitude]
  ],
  SF_LOCAL: [
    [-122.4194, 37.7749], // Downtown SF
    [-122.4094, 37.7849], // North Beach
    [-122.3994, 37.7949] // Russian Hill
  ],
  SINGLE_POINT: [
    [
      TEST_COORDINATES.SAN_FRANCISCO.longitude,
      TEST_COORDINATES.SAN_FRANCISCO.latitude
    ]
  ]
} as const;

/**
 * Common JSON-RPC request templates
 */
export const MCP_REQUESTS = {
  TOOLS_LIST: {
    jsonrpc: '2.0' as const,
    id: 'test-list',
    method: 'tools/list',
    params: {}
  },

  INITIALIZE: {
    jsonrpc: '2.0' as const,
    id: 'test-init',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    }
  },

  GEOCODE_FORWARD: {
    jsonrpc: '2.0' as const,
    id: 'test-geocode',
    method: 'tools/call',
    params: {
      name: 'forward_geocode_tool',
      arguments: {
        q: 'San Francisco, CA',
        limit: 1
      }
    }
  },

  GEOCODE_REVERSE: {
    jsonrpc: '2.0' as const,
    id: 'test-reverse',
    method: 'tools/call',
    params: {
      name: 'reverse_geocode_tool',
      arguments: {
        longitude: TEST_COORDINATES.SAN_FRANCISCO.longitude,
        latitude: TEST_COORDINATES.SAN_FRANCISCO.latitude,
        limit: 1
      }
    }
  },

  DIRECTIONS: {
    jsonrpc: '2.0' as const,
    id: 'test-directions',
    method: 'tools/call',
    params: {
      name: 'directions_tool',
      arguments: {
        coordinates: COORDINATE_ARRAYS.SF_LOCAL.slice(0, 2),
        profile: 'driving'
      }
    }
  },

  POI_SEARCH: {
    jsonrpc: '2.0' as const,
    id: 'test-poi',
    method: 'tools/call',
    params: {
      name: 'poi_search_tool',
      arguments: {
        q: 'coffee',
        proximity: TEST_COORDINATES.SAN_FRANCISCO,
        limit: 5
      }
    }
  }
} as const;

/**
 * Invalid JSON-RPC requests for error testing
 */
export const INVALID_MCP_REQUESTS = {
  MISSING_JSONRPC: {
    id: 'test-invalid',
    method: 'tools/list',
    params: {}
  },

  INVALID_VERSION: {
    jsonrpc: '1.0',
    id: 'test-invalid',
    method: 'tools/list',
    params: {}
  },

  MISSING_METHOD: {
    jsonrpc: '2.0' as const,
    id: 'test-invalid',
    params: {}
  },

  INVALID_TOOL: {
    jsonrpc: '2.0' as const,
    id: 'test-invalid',
    method: 'tools/call',
    params: {
      name: 'nonexistent_tool',
      arguments: {}
    }
  },

  MISSING_TOOL_ARGS: {
    jsonrpc: '2.0' as const,
    id: 'test-invalid',
    method: 'tools/call',
    params: {
      name: 'forward_geocode_tool',
      arguments: {} // Missing required 'q' parameter
    }
  }
} as const;

/**
 * Test responses for mocking
 */
export const MCP_RESPONSES = {
  TOOLS_LIST_SUCCESS: {
    jsonrpc: '2.0' as const,
    id: 'test-list',
    result: {
      tools: [
        {
          name: 'forward_geocode_tool',
          description: 'Forward geocoding tool',
          inputSchema: {
            type: 'object',
            properties: {
              q: { type: 'string' },
              limit: { type: 'number' }
            },
            required: ['q']
          }
        }
      ]
    }
  },

  TOOL_EXECUTION_SUCCESS: {
    jsonrpc: '2.0' as const,
    id: 'test-geocode',
    result: {
      content: [
        {
          type: 'text',
          text: 'Geocoding result for San Francisco, CA'
        }
      ]
    }
  },

  TOOL_NOT_FOUND_ERROR: {
    jsonrpc: '2.0' as const,
    id: 'test-invalid',
    error: {
      code: -32601,
      message: 'Tool not found: nonexistent_tool'
    }
  },

  INVALID_PARAMS_ERROR: {
    jsonrpc: '2.0' as const,
    id: 'test-invalid',
    error: {
      code: -32602,
      message: 'Invalid params'
    }
  }
} as const;

/**
 * Common HTTP headers for testing
 */
export const TEST_HEADERS = {
  JSON: {
    'Content-Type': 'application/json'
  },

  SSE: {
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache'
  },

  BOTH_ACCEPT: {
    Accept: 'application/json, text/event-stream'
  },

  INVALID_ACCEPT: {
    Accept: 'text/html'
  },

  INVALID_CONTENT_TYPE: {
    'Content-Type': 'text/plain'
  }
} as const;

/**
 * Common search queries for testing
 */
export const SEARCH_QUERIES = {
  VALID: {
    CITY: 'San Francisco, CA',
    RESTAURANT: 'pizza',
    COFFEE: 'coffee shop',
    ADDRESS: '1600 Amphitheatre Parkway, Mountain View, CA'
  },

  INVALID: {
    EMPTY: '',
    NUMERIC: 123,
    SPECIAL_CHARS: '!@#$%^&*()',
    VERY_LONG: 'x'.repeat(1000)
  }
} as const;

/**
 * Tool execution parameters for testing
 */
export const TOOL_PARAMS = {
  GEOCODING_FORWARD: {
    VALID: { q: 'San Francisco, CA', limit: 1 },
    MISSING_Q: { limit: 1 },
    INVALID_LIMIT: { q: 'San Francisco, CA', limit: 'invalid' }
  },

  GEOCODING_REVERSE: {
    VALID: { ...TEST_COORDINATES.SAN_FRANCISCO, limit: 1 },
    INVALID_COORDS: { ...TEST_COORDINATES.INVALID, limit: 1 },
    MISSING_COORDS: { limit: 1 }
  },

  DIRECTIONS: {
    VALID: {
      coordinates: COORDINATE_ARRAYS.SF_LOCAL.slice(0, 2),
      profile: 'driving'
    },
    INVALID_PROFILE: {
      coordinates: COORDINATE_ARRAYS.SF_LOCAL.slice(0, 2),
      profile: 'invalid_profile'
    },
    SINGLE_COORD: {
      coordinates: COORDINATE_ARRAYS.SINGLE_POINT,
      profile: 'driving'
    }
  }
} as const;

/**
 * JSON-RPC request interface for type safety
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Generate random request ID for testing
 */
export function generateRequestId(): string {
  return `test-${Math.floor(Math.random() * 1000000)}`;
}

/**
 * Create a batch request for testing
 */
export function createBatchRequest(
  requests: JsonRpcRequest[]
): JsonRpcRequest[] {
  return requests.map((req, index) => ({
    ...req,
    id: `batch-${index}`
  }));
}
