/**
 * Network Configuration for Mainnet/Devnet Scripts
 *
 * Shared configuration for all validator and ecosystem scripts.
 * Use --network mainnet|devnet to switch between networks.
 *
 * Environment Variables:
 * - HELIUS_API_KEY: Helius API key for mainnet RPC
 * - HELIUS_RPC_URL: Override full Helius RPC URL
 * - RPC_FALLBACK_URL: Fallback RPC if primary fails
 * - JITO_TIP_LAMPORTS: Override default Jito tip amount
 */

import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from '@solana/web3.js';

export type NetworkType = 'mainnet' | 'devnet';

// ============================================================================
// Types
// ============================================================================

export interface JitoConfig {
  enabled: boolean;
  blockEngineUrl: string;
  tipAccount: string;
  defaultTipLamports: number;
}

export interface ComputeConfig {
  defaultUnits: number;
  priorityFeeMultiplier: number;
  maxPriorityFeeLamports: number;
}

export interface NetworkConfig {
  rpcUrl: string;
  rpcFallbackUrl?: string;
  wallet: string;
  tokens: string[];
  name: string;
  programId: string;
  jito: JitoConfig;
  compute: ComputeConfig;
  cycleConfig: {
    minIntervalSeconds: number;
    randomOffsetEnabled: boolean;
    maxSlippageBps: number;
  };
}

// Same program ID deployed on both networks
const PROGRAM_ID = 'ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ';

// Jito tip accounts (for load balancing)
const JITO_TIP_ACCOUNTS = {
  mainnet: '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  devnet: 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
};

// ============================================================================
// Network Configurations
// ============================================================================

export const NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
  devnet: {
    rpcUrl: process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    rpcFallbackUrl: undefined,
    wallet: 'devnet-wallet.json',
    tokens: [
      'devnet-token-spl.json',
      'devnet-token-secondary.json',
      'devnet-token-mayhem.json',
    ],
    name: 'Devnet',
    programId: PROGRAM_ID,
    jito: {
      enabled: false, // Jito not typically used on devnet
      blockEngineUrl: 'https://dallas.testnet.block-engine.jito.wtf',
      tipAccount: JITO_TIP_ACCOUNTS.devnet,
      defaultTipLamports: 1_000_000, // 0.001 SOL
    },
    compute: {
      defaultUnits: 500_000,
      priorityFeeMultiplier: 1.0,
      maxPriorityFeeLamports: 10_000_000, // 0.01 SOL max
    },
    cycleConfig: {
      minIntervalSeconds: 60,
      randomOffsetEnabled: false, // Disabled for devnet testing
      maxSlippageBps: 500, // 5%
    },
  },
  mainnet: {
    rpcUrl: getHeliusRpcUrl(),
    rpcFallbackUrl: process.env.RPC_FALLBACK_URL,
    wallet: 'mainnet-wallet.json',
    tokens: loadMainnetTokens(),
    name: 'Mainnet',
    programId: PROGRAM_ID,
    jito: {
      enabled: true,
      blockEngineUrl: 'https://mainnet.block-engine.jito.wtf',
      tipAccount: JITO_TIP_ACCOUNTS.mainnet,
      defaultTipLamports: parseInt(process.env.JITO_TIP_LAMPORTS || '1000000', 10),
    },
    compute: {
      defaultUnits: 600_000,
      priorityFeeMultiplier: 1.5,
      maxPriorityFeeLamports: 50_000_000, // 0.05 SOL max
    },
    cycleConfig: {
      minIntervalSeconds: 60,
      randomOffsetEnabled: true, // Enabled for mainnet
      maxSlippageBps: 500, // 5%
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get Helius RPC URL from environment
 */
function getHeliusRpcUrl(): string {
  // Check for full URL override
  if (process.env.HELIUS_RPC_URL) {
    return process.env.HELIUS_RPC_URL;
  }

  // Build URL from API key
  const apiKey = process.env.HELIUS_API_KEY;
  if (apiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }

  // Fallback to public endpoint (not recommended for production)
  console.warn('[WARN] No HELIUS_API_KEY set. Using public RPC (rate limited).');
  return 'https://api.mainnet-beta.solana.com';
}

/**
 * Load mainnet token configurations dynamically
 * Scans mainnet-tokens/ directory for token JSON files
 */
function loadMainnetTokens(): string[] {
  const tokensDir = path.join(process.cwd(), 'mainnet-tokens');

  // Check if directory exists
  if (!fs.existsSync(tokensDir)) {
    // Fallback to single token file
    if (fs.existsSync('mainnet-token-root.json')) {
      return ['mainnet-token-root.json'];
    }
    return [];
  }

  // Scan directory for .json files
  const files = fs.readdirSync(tokensDir);
  const tokenFiles = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join('mainnet-tokens', f));

  return tokenFiles;
}

/**
 * Parse --network argument from command line
 * @param args Command line arguments (process.argv.slice(2))
 * @param defaultNetwork Default network if not specified
 * @returns Network type
 */
export function parseNetworkArg(
  args: string[],
  defaultNetwork: NetworkType = 'devnet'
): NetworkType {
  // Check for --network=value format
  const networkEqArg = args.find((a) => a.startsWith('--network='));
  if (networkEqArg) {
    const network = networkEqArg.split('=')[1];
    if (network === 'mainnet' || network === 'devnet') {
      return network;
    }
    console.warn(`Invalid network "${network}", using ${defaultNetwork}`);
  }

  // Check for --network value format (two separate args)
  const networkIdx = args.indexOf('--network');
  if (networkIdx !== -1 && args[networkIdx + 1]) {
    const network = args[networkIdx + 1];
    if (network === 'mainnet' || network === 'devnet') {
      return network;
    }
    console.warn(`Invalid network "${network}", using ${defaultNetwork}`);
  }

  // Also check for shorthand
  if (args.includes('--mainnet') || args.includes('-m')) {
    return 'mainnet';
  }
  if (args.includes('--devnet') || args.includes('-d')) {
    return 'devnet';
  }

  return defaultNetwork;
}

/**
 * Get network config from command line arguments
 */
export function getNetworkConfig(args: string[]): NetworkConfig {
  const network = parseNetworkArg(args);
  return NETWORK_CONFIGS[network];
}

/**
 * Print network banner
 */
export function printNetworkBanner(config: NetworkConfig): void {
  const isMainnet = config.name === 'Mainnet';
  const color = isMainnet ? '\x1b[31m' : '\x1b[33m'; // Red for mainnet, yellow for devnet
  const reset = '\x1b[0m';

  console.log(`${color}${'='.repeat(70)}${reset}`);
  console.log(
    `${color}  NETWORK: ${config.name.toUpperCase()} ${isMainnet ? '(PRODUCTION)' : '(TEST)'}${reset}`
  );
  console.log(`${color}${'='.repeat(70)}${reset}\n`);
}

/**
 * Validate network configuration
 * Checks for required environment variables and files
 */
export function validateNetworkConfig(config: NetworkConfig): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check wallet file
  if (!fs.existsSync(config.wallet)) {
    errors.push(`Wallet file not found: ${config.wallet}`);
  }

  // Check token files
  for (const tokenFile of config.tokens) {
    if (!fs.existsSync(tokenFile)) {
      warnings.push(`Token file not found: ${tokenFile}`);
    }
  }

  // Check RPC URL
  if (config.name === 'Mainnet') {
    if (config.rpcUrl.includes('api.mainnet-beta.solana.com')) {
      warnings.push('Using public RPC endpoint. Set HELIUS_API_KEY for production.');
    }

    if (config.jito.enabled && !config.rpcFallbackUrl) {
      warnings.push('No RPC fallback URL configured. Set RPC_FALLBACK_URL.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get Jito tip account as PublicKey
 */
export function getJitoTipAccount(config: NetworkConfig): PublicKey {
  return new PublicKey(config.jito.tipAccount);
}

/**
 * Check if current network is mainnet
 */
export function isMainnet(config: NetworkConfig): boolean {
  return config.name === 'Mainnet';
}

/**
 * Get commitment level for network
 */
export function getCommitment(config: NetworkConfig): 'confirmed' | 'finalized' {
  return config.name === 'Mainnet' ? 'finalized' : 'confirmed';
}
