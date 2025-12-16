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

// Load environment variables from .env and .env.local
import * as dotenv from 'dotenv';
dotenv.config(); // Load .env
dotenv.config({ path: '.env.local', override: true }); // Load .env.local (overrides .env)

import * as fs from 'fs';
import * as path from 'path';
import { PublicKey, Connection, ConnectionConfig } from '@solana/web3.js';

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
  rpcUrls: string[]; // Array of RPC URLs for failover
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
const PROGRAM_ID = 'ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui';

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
    rpcUrl: process.env.HELIUS_DEVNET_RPC || 'https://api.devnet.solana.com',
    rpcFallbackUrl: 'https://api.devnet.solana.com',
    rpcUrls: [
      process.env.HELIUS_DEVNET_RPC,
      process.env.DEVNET_RPC_URL,
      'https://api.devnet.solana.com', // Public fallback
    ].filter((url): url is string => Boolean(url) && !url!.endsWith('=') && !url!.endsWith('api-key=')),
    wallet: 'devnet-wallet.json',
    tokens: loadDevnetTokens(),
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
    rpcUrls: buildMainnetRpcUrls(),
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
 * Build mainnet RPC URLs array for failover
 * Order: Helius primary → Custom fallback → Public endpoint (last resort)
 */
function buildMainnetRpcUrls(): string[] {
  const urls: string[] = [];

  // Primary: Helius
  const heliusUrl = getHeliusRpcUrl();
  if (!heliusUrl.includes('api.mainnet-beta.solana.com')) {
    urls.push(heliusUrl);
  }

  // Secondary: Custom fallback from env
  if (process.env.RPC_FALLBACK_URL) {
    urls.push(process.env.RPC_FALLBACK_URL);
  }

  // Tertiary: Additional RPC providers (env-configurable)
  if (process.env.RPC_BACKUP_1) {
    urls.push(process.env.RPC_BACKUP_1);
  }
  if (process.env.RPC_BACKUP_2) {
    urls.push(process.env.RPC_BACKUP_2);
  }

  // Last resort: Public endpoint
  urls.push('https://api.mainnet-beta.solana.com');

  return urls;
}

/**
 * Load devnet token configurations dynamically
 * Scans devnet-tokens/ directory for token JSON files
 */
function loadDevnetTokens(): string[] {
  const tokensDir = path.join(process.cwd(), 'devnet-tokens');

  // Check if directory exists
  if (!fs.existsSync(tokensDir)) {
    // Fallback to legacy files in root
    const legacyFiles = [
      'devnet-token-spl.json',
      'devnet-token-secondary.json',
      'devnet-token-mayhem.json',
    ];
    return legacyFiles.filter((f) => fs.existsSync(f));
  }

  // Scan directory for .json files
  const files = fs.readdirSync(tokensDir);
  const tokenFiles = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join('devnet-tokens', f))
    .sort(); // Alphabetical order for deterministic processing

  // Fallback to legacy files if directory is empty
  if (tokenFiles.length === 0) {
    const legacyFiles = [
      'devnet-token-spl.json',
      'devnet-token-secondary.json',
      'devnet-token-mayhem.json',
    ];
    return legacyFiles.filter((f) => fs.existsSync(f));
  }

  return tokenFiles;
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

// ============================================================================
// RPC Failover Support
// ============================================================================

/**
 * Create a connection with automatic failover support
 *
 * Tries each RPC URL in order until one succeeds.
 * On failure, automatically switches to next URL.
 *
 * @param config Network configuration
 * @param connectionConfig Optional connection configuration
 * @returns Connection object and a method to get next fallback
 */
export function createConnectionWithFailover(
  config: NetworkConfig,
  connectionConfig?: ConnectionConfig
): {
  connection: Connection;
  currentUrl: string;
  tryNextRpc: () => Connection | null;
  getRpcIndex: () => number;
} {
  let currentIndex = 0;
  const urls = config.rpcUrls.length > 0 ? config.rpcUrls : [config.rpcUrl];

  const createConnection = (url: string): Connection => {
    return new Connection(url, {
      commitment: config.name === 'Mainnet' ? 'finalized' : 'confirmed',
      ...connectionConfig,
    });
  };

  return {
    connection: createConnection(urls[0]),
    currentUrl: urls[0],

    /**
     * Try next RPC endpoint in the failover list
     * @returns New connection or null if no more endpoints
     */
    tryNextRpc: (): Connection | null => {
      currentIndex++;
      if (currentIndex >= urls.length) {
        return null;
      }
      console.warn(`[RPC Failover] Switching to: ${maskRpcUrl(urls[currentIndex])}`);
      return createConnection(urls[currentIndex]);
    },

    /**
     * Get current RPC index (for logging)
     */
    getRpcIndex: (): number => currentIndex,
  };
}

/**
 * Execute an RPC call with automatic failover
 *
 * @param config Network configuration
 * @param operation Async operation to execute with connection
 * @param maxRetries Maximum retries per endpoint (default: 2)
 * @returns Result of the operation
 */
export async function withRpcFailover<T>(
  config: NetworkConfig,
  operation: (connection: Connection) => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  const urls = config.rpcUrls.length > 0 ? config.rpcUrls : [config.rpcUrl];

  for (let urlIndex = 0; urlIndex < urls.length; urlIndex++) {
    const url = urls[urlIndex];
    const connection = new Connection(url, {
      commitment: config.name === 'Mainnet' ? 'finalized' : 'confirmed',
    });

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        return await operation(connection);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Check if it's a recoverable RPC error
        const isRpcError =
          errorMsg.includes('429') || // Rate limited
          errorMsg.includes('503') || // Service unavailable
          errorMsg.includes('502') || // Bad gateway
          errorMsg.includes('timeout') ||
          errorMsg.includes('ECONNREFUSED') ||
          errorMsg.includes('ENOTFOUND') ||
          errorMsg.includes('fetch failed');

        if (!isRpcError) {
          // Non-RPC error, don't retry
          throw error;
        }

        // If last retry on this endpoint, move to next
        if (retry === maxRetries - 1) {
          if (urlIndex < urls.length - 1) {
            console.warn(
              `[RPC Failover] ${maskRpcUrl(url)} failed after ${maxRetries} attempts. Trying next endpoint...`
            );
          }
        } else {
          // Exponential backoff before retry
          const delay = Math.min(1000 * Math.pow(2, retry), 8000);
          console.warn(`[RPC Failover] Retry ${retry + 1}/${maxRetries} in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  throw new Error(`[RPC Failover] All ${urls.length} RPC endpoints failed`);
}

/**
 * Mask RPC URL for safe logging (hide API keys)
 */
function maskRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('api-key')) {
      parsed.searchParams.set('api-key', '***');
    }
    return parsed.toString();
  } catch {
    return url.replace(/api-key=[^&]+/, 'api-key=***');
  }
}
