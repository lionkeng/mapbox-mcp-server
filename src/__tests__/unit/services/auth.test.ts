/**
 * Unit tests for authentication service
 * Testing JWT validation, scope checking, and permissions
 */

import {
  AuthService,
  AuthConfig,
  StreamingScopes,
  validateStreamingPermission,
  createAuthService
} from '../../../services/auth';

describe('Authentication Service', () => {
  let authService: AuthService;
  const testSecret = 'test-secret-key-for-jwt-validation';

  beforeEach(() => {
    authService = createAuthService({
      enabled: true,
      jwtSecret: testSecret,
      requiredScopes: [],
      allowAnonymous: false
    });
  });

  describe('Configuration', () => {
    it('should use default configuration when not provided', () => {
      const defaultService = createAuthService();
      const config = defaultService.getConfig();
      
      expect(config.enabled).toBe(false);
      expect(config.allowAnonymous).toBe(true);
      expect(config.tokenHeader).toBe('authorization');
      expect(config.requiredScopes).toEqual([]);
    });

    it('should merge provided configuration with defaults', () => {
      const customConfig: AuthConfig = {
        enabled: true,
        jwtSecret: 'custom-secret',
        requiredScopes: ['custom:scope']
      };
      
      const service = createAuthService(customConfig);
      const config = service.getConfig();
      
      expect(config.enabled).toBe(true);
      expect(config.jwtSecret).toBe('custom-secret');
      expect(config.requiredScopes).toEqual(['custom:scope']);
      expect(config.allowAnonymous).toBe(true); // Default value
    });
  });

  describe('Token Extraction', () => {
    it('should extract token from Bearer header', () => {
      const token = authService.extractTokenFromHeader('Bearer abc123');
      expect(token).toBe('abc123');
    });

    it('should extract token from plain header', () => {
      const token = authService.extractTokenFromHeader('abc123');
      expect(token).toBe('abc123');
    });

    it('should handle missing header', () => {
      const token = authService.extractTokenFromHeader(undefined);
      expect(token).toBeUndefined();
    });

    it('should handle empty Bearer header', () => {
      const token = authService.extractTokenFromHeader('Bearer ');
      expect(token).toBe('');
    });
  });

  describe('Token Authentication', () => {
    it('should authenticate valid JWT token', async () => {
      const testToken = authService.createTestToken('user123', ['streaming:read']);
      const result = await authService.authenticateToken(testToken);
      
      expect(result.userId).toBe('user123');
      expect(result.scopes).toContain('streaming:read');
      expect(result.isAnonymous).toBe(false);
    });

    it('should handle missing token with anonymous allowed', async () => {
      const anonymousService = createAuthService({
        enabled: true,
        allowAnonymous: true
      });
      
      const result = await anonymousService.authenticateToken('');
      
      expect(result.userId).toBe('anonymous');
      expect(result.scopes).toContain('streaming:read');
      expect(result.isAnonymous).toBe(true);
    });

    it('should reject missing token when anonymous not allowed', async () => {
      await expect(authService.authenticateToken('')).rejects.toThrow('Missing JWT token');
    });

    it('should reject invalid JWT token', async () => {
      await expect(authService.authenticateToken('invalid-token')).rejects.toThrow('Invalid JWT:');
    });

    it('should reject token without subject', async () => {
      const invalidToken = authService.createTestToken('', []); // Empty subject
      await expect(authService.authenticateToken(invalidToken)).rejects.toThrow('JWT missing subject');
    });

    it('should handle disabled authentication', async () => {
      const disabledService = createAuthService({ enabled: false });
      const result = await disabledService.authenticateToken('any-token');
      
      expect(result.userId).toBe('anonymous');
      expect(result.isAnonymous).toBe(true);
      expect(result.scopes).toEqual(['streaming:read', 'streaming:write']);
    });

    it('should extract scopes from token array format', async () => {
      const testToken = authService.createTestToken('user123', ['scope1', 'scope2']);
      const result = await authService.authenticateToken(testToken);
      
      expect(result.scopes).toEqual(['scope1', 'scope2']);
    });
  });

  describe('Scope Validation', () => {
    it('should validate user has required scopes', () => {
      const userScopes = ['streaming:read', 'streaming:write'];
      const requiredScopes = ['streaming:read'];
      
      expect(authService.hasRequiredScopes(userScopes, requiredScopes)).toBe(true);
    });

    it('should reject user missing required scopes', () => {
      const userScopes = ['streaming:read'];
      const requiredScopes = ['streaming:read', 'streaming:write'];
      
      expect(authService.hasRequiredScopes(userScopes, requiredScopes)).toBe(false);
    });

    it('should allow admin wildcard scope', () => {
      const userScopes = ['*'];
      const requiredScopes = ['streaming:read', 'streaming:write'];
      
      expect(authService.hasRequiredScopes(userScopes, requiredScopes)).toBe(true);
    });

    it('should allow empty required scopes', () => {
      const userScopes = ['streaming:read'];
      const requiredScopes: string[] = [];
      
      expect(authService.hasRequiredScopes(userScopes, requiredScopes)).toBe(true);
    });

    it('should validate specific scope access', () => {
      const userScopes = ['streaming:read', 'streaming:write'];
      
      expect(authService.hasScope(userScopes, 'streaming:read')).toBe(true);
      expect(authService.hasScope(userScopes, 'streaming:admin')).toBe(false);
    });

    it('should throw error for missing required scopes', () => {
      const userScopes = ['streaming:read'];
      const requiredScopes = ['streaming:write'];
      
      expect(() => {
        authService.validateScopes(userScopes, requiredScopes);
      }).toThrow('Missing required scopes: streaming:write');
    });
  });

  describe('Streaming Permissions', () => {
    it('should validate read permission', () => {
      const userScopes = [StreamingScopes.READ];
      
      expect(() => {
        validateStreamingPermission(userScopes, 'read');
      }).not.toThrow();
    });

    it('should validate write permission', () => {
      const userScopes = [StreamingScopes.WRITE];
      
      expect(() => {
        validateStreamingPermission(userScopes, 'write');
      }).not.toThrow();
    });

    it('should validate admin permission', () => {
      const userScopes = [StreamingScopes.ADMIN];
      
      expect(() => {
        validateStreamingPermission(userScopes, 'admin');
      }).not.toThrow();
    });

    it('should reject insufficient permissions', () => {
      const userScopes = [StreamingScopes.READ];
      
      expect(() => {
        validateStreamingPermission(userScopes, 'admin');
      }).toThrow('Missing required permission: streaming:admin');
    });

    it('should allow wildcard admin access', () => {
      const userScopes = ['*'];
      
      expect(() => {
        validateStreamingPermission(userScopes, 'admin');
      }).not.toThrow();
    });
  });

  describe('Test Token Creation', () => {
    it('should create valid test tokens', () => {
      const token = authService.createTestToken('testuser', ['test:scope']);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should throw error when JWT secret not configured', () => {
      const noSecretService = createAuthService({ enabled: true });
      
      expect(() => {
        noSecretService.createTestToken('user', []);
      }).toThrow('JWT secret not configured');
    });

    it('should create tokens that can be validated', async () => {
      const token = authService.createTestToken('testuser', ['test:scope']);
      const result = await authService.authenticateToken(token);
      
      expect(result.userId).toBe('testuser');
      expect(result.scopes).toContain('test:scope');
    });
  });

  describe('Streaming Scopes Constants', () => {
    it('should define all required streaming scopes', () => {
      expect(StreamingScopes.READ).toBe('streaming:read');
      expect(StreamingScopes.WRITE).toBe('streaming:write');
      expect(StreamingScopes.ADMIN).toBe('streaming:admin');
      expect(StreamingScopes.CREATE_CONTEXT).toBe('streaming:create');
      expect(StreamingScopes.DELETE_CONTEXT).toBe('streaming:delete');
    });
  });

  describe('Error Handling', () => {
    it('should handle JWT verification errors gracefully', async () => {
      // Create token with different secret
      const otherService = createAuthService({
        enabled: true,
        jwtSecret: 'different-secret',
        allowAnonymous: false
      });
      
      const tokenFromOtherSecret = otherService.createTestToken('user', []);
      
      await expect(authService.authenticateToken(tokenFromOtherSecret)).rejects.toThrow('Invalid JWT:');
    });

    it('should handle malformed tokens', async () => {
      await expect(authService.authenticateToken('not.a.jwt')).rejects.toThrow('Invalid JWT:');
    });

    it('should require JWT secret for token operations', () => {
      const noSecretService = createAuthService({
        enabled: true,
        jwtSecret: undefined
      });
      
      expect(() => {
        noSecretService.createTestToken('user', []);
      }).toThrow('JWT secret not configured');
    });
  });
});