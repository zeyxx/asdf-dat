/**
 * Token Configuration Validator
 *
 * Validates token configuration files using Zod schemas.
 * Ensures all required fields are present and correctly formatted.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// Solana base58 address regex (32-44 characters)
const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Zod schema for Solana public key validation
 */
const SolanaAddressSchema = z.string().regex(
  solanaAddressRegex,
  'Invalid Solana address format (must be base58, 32-44 characters)'
);

/**
 * Pool type enum
 */
export const PoolTypeSchema = z.enum(['bonding_curve', 'pumpswap_amm']);
export type PoolType = z.infer<typeof PoolTypeSchema>;

/**
 * Token program enum
 */
export const TokenProgramSchema = z.enum(['SPL', 'Token2022']);
export type TokenProgram = z.infer<typeof TokenProgramSchema>;

/**
 * Network enum
 */
export const NetworkSchema = z.enum(['devnet', 'mainnet']);
export type Network = z.infer<typeof NetworkSchema>;

/**
 * Complete token configuration schema
 */
export const TokenConfigSchema = z.object({
  // Required fields
  mint: SolanaAddressSchema,
  creator: SolanaAddressSchema,
  name: z.string().min(1).max(32),
  symbol: z.string().min(1).max(10),
  isRoot: z.boolean(),
  poolType: PoolTypeSchema,
  network: NetworkSchema,

  // Pool address - either bondingCurve or pool (for compatibility)
  bondingCurve: SolanaAddressSchema.optional(),
  pool: SolanaAddressSchema.optional(),

  // Optional fields
  uri: z.string().url().optional(),
  mayhemMode: z.boolean().optional().default(false),
  tokenProgram: TokenProgramSchema.optional().default('SPL'),
  timestamp: z.string().datetime().optional(),
  transaction: z.string().optional(),
}).refine(
  (data) => data.bondingCurve || data.pool,
  { message: 'Either bondingCurve or pool must be provided' }
);

export type TokenConfig = z.infer<typeof TokenConfigSchema>;

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  config?: TokenConfig;
  errors?: z.ZodIssue[];
  errorMessages?: string[];
}

/**
 * Validate a token configuration object
 */
export function validateTokenConfig(config: unknown): ValidationResult {
  const result = TokenConfigSchema.safeParse(config);

  if (result.success) {
    return {
      valid: true,
      config: result.data,
    };
  }

  return {
    valid: false,
    errors: result.error.issues,
    errorMessages: result.error.issues.map(
      (e) => `${e.path.join('.')}: ${e.message}`
    ),
  };
}

/**
 * Load and validate a token configuration from a file
 */
export function loadAndValidateTokenConfig(filePath: string): ValidationResult {
  // Check file exists
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      errorMessages: [`File not found: ${filePath}`],
    };
  }

  // Read file
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    return {
      valid: false,
      errorMessages: [`Failed to read file: ${(error as Error).message}`],
    };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      valid: false,
      errorMessages: [`Invalid JSON in file: ${(error as Error).message}`],
    };
  }

  // Validate
  return validateTokenConfig(parsed);
}

/**
 * Load and validate all token configs from a directory
 */
export function loadAndValidateTokenDirectory(
  dirPath: string
): { configs: TokenConfig[]; errors: Array<{ file: string; errors: string[] }> } {
  const configs: TokenConfig[] = [];
  const errors: Array<{ file: string; errors: string[] }> = [];

  if (!fs.existsSync(dirPath)) {
    return { configs, errors: [{ file: dirPath, errors: ['Directory not found'] }] };
  }

  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.json') && !f.includes('example'))
    .sort();

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const result = loadAndValidateTokenConfig(fullPath);

    if (result.valid && result.config) {
      configs.push(result.config);
    } else {
      errors.push({
        file,
        errors: result.errorMessages || ['Unknown validation error'],
      });
    }
  }

  return { configs, errors };
}

/**
 * Validate token ecosystem consistency
 * - Exactly one root token
 * - All tokens have same network
 * - All tokens share same creator (for shared vault)
 */
export function validateEcosystemConsistency(
  configs: TokenConfig[]
): { valid: boolean; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (configs.length === 0) {
    errors.push('No token configurations found');
    return { valid: false, warnings, errors };
  }

  // Check for exactly one root token
  const rootTokens = configs.filter(c => c.isRoot);
  if (rootTokens.length === 0) {
    errors.push('No root token found (isRoot: true)');
  } else if (rootTokens.length > 1) {
    errors.push(`Multiple root tokens found: ${rootTokens.map(r => r.symbol).join(', ')}`);
  }

  // Check all tokens have same network
  const networks = new Set(configs.map(c => c.network));
  if (networks.size > 1) {
    errors.push(`Mixed networks found: ${Array.from(networks).join(', ')}`);
  }

  // Check all tokens share same creator (for shared vault)
  const creators = new Set(configs.map(c => c.creator));
  if (creators.size > 1) {
    warnings.push(
      `Multiple creators found. Tokens with different creators won't share vault fees. ` +
      `Creators: ${Array.from(creators).join(', ')}`
    );
  }

  // Check pool types are valid for each token
  for (const config of configs) {
    if (config.poolType === 'pumpswap_amm' && !config.pool && !config.bondingCurve) {
      errors.push(`${config.symbol}: AMM token missing pool address`);
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Get the effective pool address (handles both bondingCurve and pool fields)
 */
export function getPoolAddress(config: TokenConfig): string {
  return config.pool || config.bondingCurve || '';
}
