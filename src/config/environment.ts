import { z } from 'zod';

/**
 * JWT secret quality validation result
 */
interface JwtSecretValidation {
  isValid: boolean;
  entropy: number;
  issues: string[];
}

/**
 * Validates JWT secret quality with entropy and complexity checks
 * Ensures the secret is cryptographically secure
 */
function validateJwtSecretQuality(secret: string): JwtSecretValidation {
  const issues: string[] = [];

  // Check minimum length (already handled by Zod, but double-check)
  if (secret.length < 32) {
    issues.push('Must be at least 32 characters long');
  }

  // Check for character diversity
  const uniqueChars = new Set(secret).size;
  const diversityRatio = uniqueChars / secret.length;

  if (diversityRatio < 0.3) {
    issues.push('Too many repeated characters (low diversity)');
  }

  // Check for different character types
  const hasUppercase = /[A-Z]/.test(secret);
  const hasLowercase = /[a-z]/.test(secret);
  const hasNumbers = /[0-9]/.test(secret);
  const hasSpecialChars = /[^A-Za-z0-9]/.test(secret);

  const charTypeCount = [
    hasUppercase,
    hasLowercase,
    hasNumbers,
    hasSpecialChars
  ].filter(Boolean).length;

  if (charTypeCount < 3) {
    issues.push(
      'Must contain at least 3 different character types (uppercase, lowercase, numbers, special)'
    );
  }

  // Check for common weak patterns
  const weakPatterns = [
    /(.)\1{3,}/, // Same character repeated 4+ times
    /123456|654321|abcdef|qwerty/i, // Common sequences
    /password|secret|admin|test|demo/i, // Common words
    /^(.{1,4})\1+$/ // Short repeated patterns
  ];

  const hasWeakPattern = weakPatterns.some((pattern) => pattern.test(secret));
  if (hasWeakPattern) {
    issues.push('Contains weak patterns or common sequences');
  }

  // Calculate Shannon entropy for randomness measure
  const charFreq: Record<string, number> = {};
  for (const char of secret) {
    charFreq[char] = (charFreq[char] || 0) + 1;
  }

  let entropy = 0;
  for (const freq of Object.values(charFreq)) {
    const probability = freq / secret.length;
    entropy -= probability * Math.log2(probability);
  }

  // Require minimum entropy of 4.0 bits per character (good randomness)
  if (entropy < 4.0) {
    issues.push(
      `Low entropy (${entropy.toFixed(2)} bits/char, minimum 4.0 required)`
    );
  }

  return {
    isValid: issues.length === 0,
    entropy,
    issues
  };
}

/**
 * Environment configuration schema with strict validation
 * Optimized for Node.js 22 and high-performance operation
 */
const envSchema = z.object({
  // Node.js environment
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // Server configuration
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),

  // Required Mapbox configuration
  MAPBOX_ACCESS_TOKEN: z
    .string()
    .min(1, 'MAPBOX_ACCESS_TOKEN is required')
    .refine((token) => {
      // Allow test tokens for test environment
      if (process.env.NODE_ENV === 'test') {
        return true;
      }
      // Require pk. prefix for non-test environments
      return /^pk\./.test(token);
    }, 'MAPBOX_ACCESS_TOKEN must be a valid Mapbox public token'),

  // Optional Mapbox API endpoint override
  MAPBOX_API_ENDPOINT: z.string().url().default('https://api.mapbox.com/'),

  // JWT configuration (required for HTTP transport)
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters for security')
    .refine(
      (secret) => {
        if (!secret) return true; // Allow empty/undefined since it's optional

        // Check for sufficient entropy and complexity
        const validation = validateJwtSecretQuality(secret);
        return validation.isValid;
      },
      {
        message:
          'JWT_SECRET must have sufficient entropy and complexity. Use a cryptographically secure random string.'
      }
    )
    .optional(),

  // Transport configuration
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),

  // Logging configuration
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Performance tuning
  MAX_CONNECTIONS: z.coerce.number().int().min(1).max(1000).default(50),
  KEEP_ALIVE_TIMEOUT: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .default(30000),
  REQUEST_TIMEOUT: z.coerce.number().int().min(1000).max(300000).default(30000),

  // Error handling
  VERBOSE_ERRORS: z.coerce.boolean().default(false),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(100),
  RATE_LIMIT_WINDOW: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .default(60000)
}) satisfies z.ZodType<Record<string, unknown>>;

/**
 * Type definition for the environment configuration
 */
export type Environment = z.infer<typeof envSchema>;

/**
 * Cached environment configuration
 * Lazily initialized on first access to avoid startup crashes
 */
let _env: Environment | null = null;

/**
 * Gets the validated environment configuration
 * Performs validation on first access and caches the result
 */
export function getEnv(): Environment {
  if (!_env) {
    try {
      _env = envSchema.parse(process.env);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join('\n');

        throw new Error(
          `Environment validation failed:\n${errorMessages}\n\n` +
            'Please check your environment variables and try again.'
        );
      }
      throw error;
    }
  }
  return _env;
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use getEnv() instead for better error handling
 */
export const env = new Proxy({} as Environment, {
  get(target, prop) {
    const envConfig = getEnv();
    return envConfig[prop as keyof Environment];
  },
  set() {
    throw new Error('Environment configuration is read-only');
  },
  ownKeys() {
    return Object.keys(getEnv());
  },
  has(target, prop) {
    return prop in getEnv();
  },
  getOwnPropertyDescriptor(target, prop) {
    const envConfig = getEnv();
    if (prop in envConfig) {
      return {
        enumerable: true,
        configurable: true,
        value: envConfig[prop as keyof Environment]
      };
    }
    return undefined;
  }
});

/**
 * Validates JWT secret is present and secure when using HTTP transport
 * This is a runtime validation that happens after env parsing
 */
export function validateHttpTransportConfig(): void {
  const envConfig = getEnv();
  if (envConfig.MCP_TRANSPORT === 'http') {
    if (!envConfig.JWT_SECRET) {
      throw new Error(
        'JWT_SECRET environment variable is required when using HTTP transport. ' +
          'Generate a secure secret with: openssl rand -base64 32'
      );
    }

    // Additional quality check for JWT secret
    const validation = validateJwtSecretQuality(envConfig.JWT_SECRET);
    if (!validation.isValid) {
      throw new Error(
        `JWT_SECRET quality issues detected:\n${validation.issues.map((issue) => `  - ${issue}`).join('\n')}\n\n` +
          `Current entropy: ${validation.entropy.toFixed(2)} bits/char\n` +
          'Generate a secure secret with: openssl rand -base64 32'
      );
    }
  }
}

/**
 * Validates Mapbox token format more thoroughly
 * Checks for both public (pk.) and secret (sk.) tokens
 */
export function validateMapboxToken(): void {
  const envConfig = getEnv();
  const token = envConfig.MAPBOX_ACCESS_TOKEN;

  if (token.startsWith('sk.')) {
    console.warn(
      'Warning: Using a secret Mapbox token. ' +
        'Consider using a public token (pk.) for client-side applications.'
    );
  }

  // Basic JWT format validation for Mapbox tokens
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Mapbox token format. Expected JWT format.');
  }
}

/**
 * Performs all environment validations
 * Call this at application startup
 */
export function validateEnvironment(): Environment {
  const envConfig = getEnv();
  validateHttpTransportConfig();
  validateMapboxToken();

  // Log the configuration (without secrets)
  const safeConfig = {
    ...envConfig,
    MAPBOX_ACCESS_TOKEN: '***redacted***',
    JWT_SECRET: envConfig.JWT_SECRET ? '***redacted***' : undefined
  };

  console.log('Environment configuration loaded:', safeConfig);

  return envConfig;
}
