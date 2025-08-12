/**
 * Authentication service for streaming operations
 * Handles JWT token validation and scope checking
 */

import jwt from 'jsonwebtoken';

/**
 * Authentication configuration
 */
export interface AuthConfig {
  enabled: boolean;
  jwtSecret?: string;
  requiredScopes?: string[];
  tokenHeader?: string;
  allowAnonymous?: boolean;
}

/**
 * User authentication result
 */
export interface AuthResult {
  userId: string;
  scopes: string[];
  isAnonymous: boolean;
}

/**
 * JWT payload structure
 */
export interface JWTPayload {
  sub: string;
  scopes?: string[];
  scope?: string;
  iat?: number;
  exp?: number;
  aud?: string;
  iss?: string;
}

/**
 * Default authentication configuration
 */
export const DEFAULT_AUTH_CONFIG: Required<Omit<AuthConfig, 'jwtSecret'>> & { jwtSecret: string | undefined } = {
  enabled: false,
  jwtSecret: undefined,
  requiredScopes: [],
  tokenHeader: 'authorization',
  allowAnonymous: true
};

/**
 * Authentication service class
 */
export class AuthService {
  private readonly config: Required<AuthConfig>;

  constructor(config: AuthConfig = { enabled: false }) {
    this.config = { ...DEFAULT_AUTH_CONFIG, ...config };
  }

  /**
   * Gets the authentication configuration
   */
  getConfig(): Required<AuthConfig> {
    return { ...this.config };
  }

  /**
   * Authenticates a JWT token
   */
  async authenticateToken(token: string): Promise<AuthResult> {
    if (!this.config.enabled) {
      return {
        userId: 'anonymous',
        scopes: ['streaming:read', 'streaming:write'],
        isAnonymous: true
      };
    }

    if (!token) {
      if (this.config.allowAnonymous) {
        return {
          userId: 'anonymous',
          scopes: ['streaming:read'],
          isAnonymous: true
        };
      }
      throw new Error('Missing JWT token');
    }

    if (!this.config.jwtSecret) {
      throw new Error('JWT secret not configured');
    }

    try {
      const payload = jwt.verify(token, this.config.jwtSecret) as JWTPayload;
      
      if (!payload.sub) {
        throw new Error('JWT missing subject (user ID)');
      }

      // Extract scopes from payload
      let userScopes: string[] = [];
      if (payload.scopes && Array.isArray(payload.scopes)) {
        userScopes = payload.scopes;
      } else if (payload.scope && typeof payload.scope === 'string') {
        userScopes = payload.scope.split(' ').filter(s => s.trim().length > 0);
      }

      return {
        userId: payload.sub,
        scopes: userScopes,
        isAnonymous: false
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error(`Invalid JWT: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Extracts token from authorization header
   */
  extractTokenFromHeader(authHeader: string | undefined): string | undefined {
    if (!authHeader) {
      return undefined;
    }

    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    return authHeader;
  }

  /**
   * Checks if user has required scopes
   */
  hasRequiredScopes(userScopes: string[], requiredScopes: string[] = []): boolean {
    if (requiredScopes.length === 0) {
      return true;
    }

    // Admin wildcard scope
    if (userScopes.includes('*')) {
      return true;
    }

    return requiredScopes.every(scope => userScopes.includes(scope));
  }

  /**
   * Checks if user has specific scope
   */
  hasScope(userScopes: string[], scope: string): boolean {
    return userScopes.includes(scope) || userScopes.includes('*');
  }

  /**
   * Validates user has required scopes for operation
   */
  validateScopes(userScopes: string[], requiredScopes: string[]): void {
    if (!this.hasRequiredScopes(userScopes, requiredScopes)) {
      throw new Error(`Missing required scopes: ${requiredScopes.join(', ')}`);
    }
  }

  /**
   * Creates a JWT token for testing purposes
   */
  createTestToken(userId: string, scopes: string[] = [], expiresIn: string = '1h'): string {
    if (!this.config.jwtSecret) {
      throw new Error('JWT secret not configured');
    }

    const payload: JWTPayload = {
      sub: userId,
      scopes,
      iat: Math.floor(Date.now() / 1000)
    };

    const options: jwt.SignOptions = {};
    if (expiresIn) {
      options.expiresIn = expiresIn;
    }
    return jwt.sign(payload, this.config.jwtSecret, options);
  }
}

/**
 * Creates an authentication service instance
 */
export function createAuthService(config?: AuthConfig): AuthService {
  return new AuthService(config);
}

/**
 * Standard streaming scopes
 */
export const StreamingScopes = {
  READ: 'streaming:read',
  WRITE: 'streaming:write', 
  ADMIN: 'streaming:admin',
  CREATE_CONTEXT: 'streaming:create',
  DELETE_CONTEXT: 'streaming:delete'
} as const;

/**
 * Validates streaming operation permissions
 */
export function validateStreamingPermission(
  userScopes: string[], 
  operation: 'read' | 'write' | 'admin' | 'create' | 'delete'
): void {
  const requiredScope = StreamingScopes[operation.toUpperCase() as keyof typeof StreamingScopes];
  
  if (!userScopes.includes(requiredScope) && !userScopes.includes('*')) {
    throw new Error(`Missing required permission: ${requiredScope}`);
  }
}