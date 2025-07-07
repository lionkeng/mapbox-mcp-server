/**
 * Authentication utilities for testing
 * Provides JWT token generation and auth-related test helpers
 */

import jwt from 'jsonwebtoken';
import { JwtPayload } from '../../server/httpServer.js';
import { TEST_SERVER_CONFIG } from './constants.js';

/**
 * Default JWT secret for testing
 */
export const TEST_JWT_SECRET = TEST_SERVER_CONFIG.JWT_SECRET;

/**
 * Test JWT payload interface that extends the server's JwtPayload
 */
export interface TestJwtPayload extends Omit<JwtPayload, 'exp' | 'iat'> {
  permissions: string[];
}

/**
 * JWT sign options for testing (using jwt library's built-in type)
 */
export type TestJwtSignOptions = jwt.SignOptions;

/**
 * Creates a valid JWT token with specified permissions
 */
export function createTestToken(
  permissions: string[] = ['mapbox:*'],
  options: {
    sub?: string;
    expiresIn?: string | number;
    secret?: string;
  } = {}
): string {
  const {
    sub = 'test-user',
    expiresIn = '1h',
    secret = TEST_JWT_SECRET
  } = options;

  const payload: TestJwtPayload = {
    iss: 'mapbox-mcp-server',
    sub,
    aud: 'mapbox-mcp-server',
    permissions
  };

  const signOptions: TestJwtSignOptions = {
    expiresIn,
    algorithm: 'HS256'
  };

  return jwt.sign(payload, secret, signOptions);
}

/**
 * Creates an expired JWT token
 */
export function createExpiredToken(
  permissions: string[] = ['mapbox:*'],
  secret: string = TEST_JWT_SECRET
): string {
  const payload: TestJwtPayload = {
    iss: 'mapbox-mcp-server',
    sub: 'expired-user',
    aud: 'mapbox-mcp-server',
    permissions
  };

  const signOptions: TestJwtSignOptions = {
    expiresIn: '-1h', // Expired 1 hour ago
    algorithm: 'HS256'
  };

  return jwt.sign(payload, secret, signOptions);
}

/**
 * Creates a JWT token with wrong issuer/audience
 */
export function createInvalidToken(
  permissions: string[] = ['mapbox:*'],
  wrongSecret: string = 'wrong-secret'
): string {
  const payload: TestJwtPayload = {
    iss: 'wrong-issuer',
    sub: 'test-user',
    aud: 'wrong-audience',
    permissions
  };

  const signOptions: TestJwtSignOptions = {
    expiresIn: '1h',
    algorithm: 'HS256'
  };

  return jwt.sign(payload, wrongSecret, signOptions);
}

/**
 * Creates a token with no permissions
 */
export function createNoPermissionsToken(
  secret: string = TEST_JWT_SECRET
): string {
  const payload: TestJwtPayload = {
    iss: 'mapbox-mcp-server',
    sub: 'no-permissions-user',
    aud: 'mapbox-mcp-server',
    permissions: []
  };

  const signOptions: TestJwtSignOptions = {
    expiresIn: '1h',
    algorithm: 'HS256'
  };

  return jwt.sign(payload, secret, signOptions);
}

/**
 * Creates a token with limited permissions
 */
export function createLimitedPermissionsToken(
  allowedPermissions: string[],
  secret: string = TEST_JWT_SECRET
): string {
  const payload: TestJwtPayload = {
    iss: 'mapbox-mcp-server',
    sub: 'limited-user',
    aud: 'mapbox-mcp-server',
    permissions: allowedPermissions
  };

  const signOptions: TestJwtSignOptions = {
    expiresIn: '1h',
    algorithm: 'HS256'
  };

  return jwt.sign(payload, secret, signOptions);
}

/**
 * Common permission sets for testing
 */
export const PERMISSION_SETS = {
  FULL_ACCESS: ['mapbox:*'],
  GEOCODE_ONLY: ['mapbox:geocode'],
  DIRECTIONS_ONLY: ['mapbox:directions'],
  POI_ONLY: ['mapbox:poi'],
  LIMITED: ['mapbox:geocode', 'mapbox:poi'],
  NONE: []
};

/**
 * Creates Authorization header for requests
 */
export function createAuthHeader(token: string): { Authorization: string } {
  return {
    Authorization: `Bearer ${token}`
  };
}

/**
 * Creates a complete set of test tokens for various scenarios
 */
export function createTestTokenSet(secret: string = TEST_JWT_SECRET) {
  return {
    valid: createTestToken(PERMISSION_SETS.FULL_ACCESS, { secret }),
    expired: createExpiredToken(PERMISSION_SETS.FULL_ACCESS, secret),
    invalid: createInvalidToken(),
    noPermissions: createNoPermissionsToken(secret),
    geocodeOnly: createLimitedPermissionsToken(
      PERMISSION_SETS.GEOCODE_ONLY,
      secret
    ),
    directionsOnly: createLimitedPermissionsToken(
      PERMISSION_SETS.DIRECTIONS_ONLY,
      secret
    ),
    poiOnly: createLimitedPermissionsToken(PERMISSION_SETS.POI_ONLY, secret),
    limited: createLimitedPermissionsToken(PERMISSION_SETS.LIMITED, secret)
  };
}

/**
 * Extracts payload from JWT token (for testing verification)
 * @throws {jwt.JsonWebTokenError} If token is invalid
 * @throws {jwt.TokenExpiredError} If token is expired
 */
export function extractTokenPayload(
  token: string,
  secret: string = TEST_JWT_SECRET
): JwtPayload {
  const decoded = jwt.verify(token, secret);

  if (typeof decoded === 'string') {
    throw new Error('Unexpected string payload from JWT verification');
  }

  // Ensure the decoded payload has the required JwtPayload structure
  if (
    !decoded ||
    typeof decoded !== 'object' ||
    !decoded.iss ||
    !decoded.sub ||
    !decoded.aud
  ) {
    throw new Error('Invalid JWT payload structure');
  }

  return decoded as JwtPayload;
}
