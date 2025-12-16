/**
 * Environment Validation Utility
 *
 * Validates required environment variables before script execution.
 * Prevents runtime failures due to missing configuration.
 *
 * Usage:
 *   import { validateEnv } from './utils/validate-env';
 *   validateEnv('development'); // or 'production'
 */

export type Environment = 'development' | 'production';

interface EnvRequirements {
  required: string[];
  optional: string[];
  warnings: Record<string, string>;
}

const ENV_REQUIREMENTS: Record<Environment, EnvRequirements> = {
  development: {
    required: [
      'CREATOR',
    ],
    optional: [
      'HELIUS_API_KEY',
      'HELIUS_DEVNET_RPC',
    ],
    warnings: {
      HELIUS_API_KEY: 'Using public RPC - may hit rate limits. Get a free key at https://helius.dev',
    },
  },
  production: {
    required: [
      'HELIUS_API_KEY',
      'HELIUS_MAINNET_RPC',
      'QUICKNODE_RPC',
      'MAINNET_WALLET',
      'CREATOR',
    ],
    optional: [
      'TRITON_RPC',
      'GRAFANA_METRICS_URL',
      'PAGERDUTY_KEY',
      'SLACK_WEBHOOK_URL',
    ],
    warnings: {},
  },
};

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validate environment configuration
 *
 * @param environment - 'development' or 'production'
 * @param options - Validation options
 * @throws EnvValidationError if required variables are missing
 */
export function validateEnv(
  environment: Environment = 'development',
  options: { strict?: boolean; exitOnError?: boolean } = {}
): void {
  const { strict = false, exitOnError = true } = options;
  const requirements = ENV_REQUIREMENTS[environment];

  console.log(`🔍 Validating ${environment} environment...`);

  // Check required variables
  const missing = requirements.required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    const error = new EnvValidationError(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `\nPlease:\n` +
      `1. Copy .env.template to .env\n` +
      `2. Fill in the required values\n` +
      `3. See docs/SECRETS_MANAGEMENT.md for details`
    );

    console.error(`\n❌ ${error.message}\n`);

    if (exitOnError) {
      process.exit(1);
    } else {
      throw error;
    }
  }

  // Check optional variables (warnings only)
  const missingOptional = requirements.optional.filter(key => !process.env[key]);

  if (missingOptional.length > 0 && strict) {
    console.warn(`\n⚠️  Optional environment variables not set:`);
    missingOptional.forEach(key => {
      const warning = requirements.warnings[key];
      if (warning) {
        console.warn(`   - ${key}: ${warning}`);
      } else {
        console.warn(`   - ${key}`);
      }
    });
    console.warn('');
  }

  // Success
  console.log(`✅ Environment validation passed\n`);

  // Display configuration summary
  if (process.env.DEBUG === 'true') {
    console.log('📋 Environment Summary:');
    requirements.required.forEach(key => {
      const value = process.env[key];
      const masked = maskSecret(value || '');
      console.log(`   ${key}: ${masked}`);
    });
    console.log('');
  }
}

/**
 * Mask secret values for display
 */
function maskSecret(value: string): string {
  if (!value) return '<not set>';
  if (value.length <= 8) return '***';

  const visible = 4;
  const start = value.slice(0, visible);
  const end = value.slice(-visible);
  return `${start}${'*'.repeat(Math.max(0, value.length - visible * 2))}${end}`;
}

/**
 * Check if a specific environment variable is set
 */
export function hasEnv(key: string): boolean {
  return Boolean(process.env[key]);
}

/**
 * Get environment variable with fallback
 */
export function getEnv(key: string, fallback?: string): string {
  return process.env[key] || fallback || '';
}

/**
 * Require environment variable (throws if not set)
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new EnvValidationError(`Required environment variable not set: ${key}`);
  }
  return value;
}

/**
 * Validate environment and export helper
 */
export function validateAndExport(environment: Environment = 'development') {
  validateEnv(environment);

  return {
    hasEnv,
    getEnv,
    requireEnv,
  };
}
