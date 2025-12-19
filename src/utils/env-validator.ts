/**
 * Environment Variable Validation
 *
 * Validates environment variables at startup to prevent runtime errors
 * from misconfiguration. Uses Zod for schema validation.
 *
 * Includes schemas for:
 * - Daemon configuration
 * - Orchestrator configuration
 * - Alerting configuration
 * - Metrics persistence configuration
 */

import { z } from 'zod';
import * as fs from 'fs';

// Allowed RPC endpoints (whitelist for security)
const ALLOWED_RPC_HOSTS = [
  'api.devnet.solana.com',
  'api.mainnet-beta.solana.com',
  'rpc.helius.xyz',
  'mainnet.helius-rpc.com',
  'devnet.helius-rpc.com',
  'localhost',
];

/**
 * Custom Zod refinement for RPC URL validation
 * Ensures URL is from an allowed host
 */
const rpcUrlSchema = z.string().url().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return ALLOWED_RPC_HOSTS.some(host => parsed.hostname.includes(host));
    } catch {
      return false;
    }
  },
  { message: 'RPC URL must be from an allowed host (Solana or Helius)' }
);

/**
 * Daemon environment schema
 */
export const DaemonEnvSchema = z.object({
  // Network configuration
  NETWORK: z.enum(['devnet', 'mainnet']).default('devnet'),

  // RPC configuration
  RPC_URL: rpcUrlSchema.optional(),
  HELIUS_API_KEY: z.string().optional(),

  // Wallet configuration
  WALLET_PATH: z.string().refine(
    (path) => !path || fs.existsSync(path),
    { message: 'Wallet file does not exist' }
  ).optional(),

  // Daemon API configuration
  API_PORT: z.coerce.number().min(1024).max(65535).default(3030),
  DAEMON_API_KEY: z.string().min(16).optional(),
  DAEMON_API_PORT: z.coerce.number().min(1024).max(65535).default(3030),

  // Monitoring configuration
  UPDATE_INTERVAL: z.coerce.number().min(5000).max(300000).default(30000),
  VERBOSE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
});

/**
 * Orchestrator environment schema
 */
export const OrchestratorEnvSchema = z.object({
  // Network configuration
  NETWORK: z.enum(['devnet', 'mainnet']).default('devnet'),

  // RPC configuration
  RPC_URL: rpcUrlSchema.optional(),
  HELIUS_API_KEY: z.string().optional(),

  // Wallet configuration
  WALLET_PATH: z.string().refine(
    (path) => !path || fs.existsSync(path),
    { message: 'Wallet file does not exist' }
  ).optional(),

  // Daemon API configuration (for triggering flush)
  DAEMON_API_PORT: z.coerce.number().min(1024).max(65535).default(3030),
  DAEMON_API_KEY: z.string().optional(),

  // Testing mode (MUST be false on mainnet)
  TESTING_MODE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
});

export type DaemonEnv = z.infer<typeof DaemonEnvSchema>;
export type OrchestratorEnv = z.infer<typeof OrchestratorEnvSchema>;

// ============================================================================
// Alerting Configuration Schema
// ============================================================================

/**
 * Webhook URL validation - supports Discord and Slack
 */
const webhookUrlSchema = z.string().url().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.includes('discord.com') ||
        parsed.hostname.includes('discordapp.com') ||
        parsed.hostname.includes('slack.com') ||
        parsed.hostname.includes('hooks.slack.com')
      );
    } catch {
      return false;
    }
  },
  { message: 'Webhook URL must be a valid Discord or Slack webhook URL' }
).optional();

/**
 * Alerting environment schema
 */
export const AlertingEnvSchema = z.object({
  // Webhook configuration
  WEBHOOK_URL: webhookUrlSchema,
  WEBHOOK_TYPE: z.enum(['discord', 'slack', 'auto']).default('auto'),

  // Enable/disable alerting (default: false - only enabled when explicitly configured)
  ALERT_ENABLED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),

  // Threshold configuration
  ALERT_ERROR_RATE_THRESHOLD: z.coerce.number().min(1).max(100).default(10),
  ALERT_POLL_LAG_MULTIPLIER: z.coerce.number().min(1).max(10).default(2),
  ALERT_PENDING_STUCK_MINUTES: z.coerce.number().min(5).max(1440).default(30),
  ALERT_FAILED_CYCLES_MAX: z.coerce.number().min(1).max(20).default(3),

  // Rate limiting
  ALERT_RATE_LIMIT_WINDOW: z.coerce.number().min(10000).max(600000).default(60000),
  ALERT_RATE_LIMIT_MAX: z.coerce.number().min(1).max(50).default(5),
  ALERT_COOLDOWN_MS: z.coerce.number().min(60000).max(3600000).default(300000),
});

export type AlertingEnv = z.infer<typeof AlertingEnvSchema>;

// ============================================================================
// Metrics Persistence Configuration Schema
// ============================================================================

/**
 * Metrics persistence environment schema
 */
export const MetricsPersistenceEnvSchema = z.object({
  // Enable/disable persistence
  METRICS_ENABLED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),

  // Storage configuration
  METRICS_DATA_DIR: z.string().default('./data/metrics'),
  METRICS_SNAPSHOT_INTERVAL: z.coerce.number().min(60000).max(3600000).default(300000),
  METRICS_RETENTION_DAYS: z.coerce.number().min(1).max(365).default(30),
});

export type MetricsPersistenceEnv = z.infer<typeof MetricsPersistenceEnvSchema>;

/**
 * Validate daemon environment variables
 * Throws descriptive error if validation fails
 */
export function validateDaemonEnv(): DaemonEnv {
  const result = DaemonEnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((e: any) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    throw new Error(
      `Invalid daemon configuration:\n${errors}\n\n` +
      `Set these environment variables or use a .env file.`
    );
  }

  // CRITICAL: API key required on mainnet
  if (result.data.NETWORK === 'mainnet' && !result.data.DAEMON_API_KEY) {
    throw new Error(
      'CRITICAL: DAEMON_API_KEY is required on mainnet.\n' +
      'Set a secure key (16+ characters) in your .env.local file.'
    );
  }

  return result.data;
}

/**
 * Validate orchestrator environment variables
 * Throws descriptive error if validation fails
 */
export function validateOrchestratorEnv(): OrchestratorEnv {
  const result = OrchestratorEnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((e: any) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    throw new Error(
      `Invalid orchestrator configuration:\n${errors}\n\n` +
      `Set these environment variables or use a .env file.`
    );
  }

  // Critical: TESTING_MODE must be false on mainnet
  if (result.data.NETWORK === 'mainnet' && result.data.TESTING_MODE) {
    throw new Error('CRITICAL: TESTING_MODE=true is NOT allowed on mainnet!');
  }

  return result.data;
}

/**
 * Validate alerting environment variables
 * Returns validated config with defaults applied
 */
export function validateAlertingEnv(): AlertingEnv {
  const result = AlertingEnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((e: any) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    console.warn(
      `Warning: Invalid alerting configuration (using defaults):\n${errors}`
    );

    // Return defaults instead of throwing
    return AlertingEnvSchema.parse({});
  }

  // Silently disable alerting if no webhook URL configured
  // No warning needed - alerts are opt-in, not opt-out
  if (result.data.ALERT_ENABLED && !result.data.WEBHOOK_URL) {
    result.data.ALERT_ENABLED = false;
  }

  return result.data;
}

/**
 * Validate metrics persistence environment variables
 * Returns validated config with defaults applied
 */
export function validateMetricsPersistenceEnv(): MetricsPersistenceEnv {
  const result = MetricsPersistenceEnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((e: any) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    console.warn(
      `Warning: Invalid metrics persistence configuration (using defaults):\n${errors}`
    );

    // Return defaults instead of throwing
    return MetricsPersistenceEnvSchema.parse({});
  }

  return result.data;
}

/**
 * Log validated configuration (redacting sensitive values)
 */
export function logConfig(
  config: DaemonEnv | OrchestratorEnv | AlertingEnv | MetricsPersistenceEnv,
  logger: { info: (msg: string) => void }
): void {
  const redacted = { ...config } as Record<string, unknown>;

  // Redact sensitive values
  if ('DAEMON_API_KEY' in redacted && redacted.DAEMON_API_KEY) {
    redacted.DAEMON_API_KEY = '***REDACTED***';
  }
  if ('HELIUS_API_KEY' in redacted && redacted.HELIUS_API_KEY) {
    redacted.HELIUS_API_KEY = '***REDACTED***';
  }
  if ('WEBHOOK_URL' in redacted && redacted.WEBHOOK_URL) {
    // Show only the domain, not the full webhook URL
    try {
      const url = new URL(redacted.WEBHOOK_URL as string);
      redacted.WEBHOOK_URL = `***${url.hostname}***`;
    } catch {
      redacted.WEBHOOK_URL = '***REDACTED***';
    }
  }

  logger.info(`Configuration: ${JSON.stringify(redacted)}`);
}
