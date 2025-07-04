import { patchGlobalFetch } from './requestUtils.js';
import jwt from 'jsonwebtoken';

let defaultHeaders: Record<string, string> = {};

export function setupFetch(overrides?: any) {
  const mockFetch = (global.fetch = jest.fn());
  defaultHeaders = patchGlobalFetch({
    name: 'TestServer',
    version: '1.0.0',
    sha: 'abcdef',
    tag: 'no-tag',
    branch: 'default'
  });
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true }),
    arrayBuffer: async () => new ArrayBuffer(0),
    ...overrides
  });
  return mockFetch;
}

export function assertHeadersSent(mockFetch: jest.Mock) {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const callArgs = mockFetch.mock.calls[0];
  const requestInit = callArgs[1];
  expect(requestInit?.headers).toMatchObject(defaultHeaders);
}

/**
 * HTTP endpoint testing utilities
 */

export interface HttpTestConfig {
  serverUrl: string;
  jwtSecret: string;
  permissions?: string[];
}

export function createTestJWT(config: HttpTestConfig): string {
  return jwt.sign(
    {
      iss: 'mapbox-mcp-server',
      sub: 'test-user',
      aud: 'mapbox-mcp-server',
      permissions: config.permissions || ['mapbox:*']
    },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
}

export async function callHttpTool(
  config: HttpTestConfig,
  toolName: string,
  args: Record<string, unknown>,
  token?: string
): Promise<Response> {
  const authToken = token || createTestJWT(config);

  return fetch(`${config.serverUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    })
  });
}

export async function listHttpTools(
  config: HttpTestConfig,
  token?: string
): Promise<Response> {
  const authToken = token || createTestJWT(config);

  return fetch(`${config.serverUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    })
  });
}

export async function initializeHttpMcp(
  config: HttpTestConfig,
  token?: string
): Promise<Response> {
  const authToken = token || createTestJWT(config);

  return fetch(`${config.serverUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    })
  });
}

/**
 * Test data generators for each tool
 */

export const testData = {
  geocoding: {
    forward: {
      valid: { query: 'San Francisco, CA', limit: 1 },
      invalid: { limit: 1 } // Missing query
    },
    reverse: {
      valid: { longitude: -122.4194, latitude: 37.7749, limit: 1 },
      invalid: { longitude: 200, latitude: 37.7749, limit: 1 } // Invalid longitude
    }
  },

  directions: {
    valid: {
      coordinates: [
        [-122.4194, 37.7749],
        [-122.4094, 37.7849]
      ],
      profile: 'driving'
    },
    invalid: {
      coordinates: [
        [-122.4194, 37.7749],
        [-122.4094, 37.7849]
      ],
      profile: 'invalid_profile'
    }
  },

  isochrone: {
    valid: {
      coordinates: [-122.4194, 37.7749],
      contours_minutes: [5, 10],
      profile: 'driving'
    },
    invalid: {
      coordinates: [200, 100], // Invalid coordinates
      contours_minutes: [5, 10],
      profile: 'driving'
    }
  },

  matrix: {
    valid: {
      coordinates: [
        [-122.4194, 37.7749],
        [-122.4094, 37.7849],
        [-122.3994, 37.7949]
      ],
      profile: 'driving'
    },
    invalid: {
      coordinates: Array.from({ length: 30 }, (_, i) => [
        -122.4194 + i * 0.01,
        37.7749 + i * 0.01
      ]), // Too many coordinates
      profile: 'driving'
    }
  },

  poi: {
    valid: {
      query: 'coffee',
      proximity: [-122.4194, 37.7749],
      limit: 5
    },
    invalid: {
      proximity: [-122.4194, 37.7749],
      limit: 5
    } // Missing query
  },

  category: {
    valid: {
      category: 'restaurant',
      proximity: [-122.4194, 37.7749],
      limit: 5
    },
    invalid: {
      category: 'invalid_category',
      proximity: [-122.4194, 37.7749],
      limit: 5
    }
  },

  staticMap: {
    valid: {
      longitude: -122.4194,
      latitude: 37.7749,
      zoom: 12,
      width: 300,
      height: 200,
      style: 'mapbox://styles/mapbox/streets-v11'
    },
    invalid: {
      longitude: -122.4194,
      latitude: 37.7749,
      zoom: 12,
      width: 2000, // Too large
      height: 2000, // Too large
      style: 'mapbox://styles/mapbox/streets-v11'
    }
  }
};

/**
 * Mock response generators for testing
 */

export function createMockGeocodingResponse(features: any[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      type: 'FeatureCollection',
      features,
      query: ['san', 'francisco'],
      attribution: 'NOTICE: © 2024 Mapbox and its suppliers.'
    })
  };
}

export function createMockDirectionsResponse(routes: any[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      routes,
      waypoints: [],
      code: 'Ok',
      uuid: 'test-uuid'
    })
  };
}

export function createMockIsochroneResponse(features: any[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      type: 'FeatureCollection',
      features
    })
  };
}

export function createMockMatrixResponse(
  durations: number[][] = [],
  distances: number[][] = []
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      durations,
      distances,
      sources: [],
      destinations: []
    })
  };
}

export function createMockPoiResponse(features: any[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      type: 'FeatureCollection',
      features,
      attribution: 'NOTICE: © 2024 Mapbox and its suppliers.'
    })
  };
}

export function createMockStaticMapResponse(): any {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(1024), // Mock image data
    headers: new Map([['content-type', 'image/png']])
  };
}

export function createMockErrorResponse(
  status: number = 400,
  message: string = 'Bad Request'
) {
  return {
    ok: false,
    status,
    statusText: message,
    json: async () => ({
      message,
      error: message
    })
  };
}
