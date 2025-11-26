/**
 * Network Configuration for Mainnet/Devnet Scripts
 *
 * Shared configuration for all validator and ecosystem scripts.
 * Use --network mainnet|devnet to switch between networks.
 */

export type NetworkType = 'mainnet' | 'devnet';

export interface NetworkConfig {
  rpcUrl: string;
  wallet: string;
  tokens: string[];
  name: string;
}

export const NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
  devnet: {
    rpcUrl: 'https://api.devnet.solana.com',
    wallet: 'devnet-wallet.json',
    tokens: [
      'devnet-token-spl.json',
      'devnet-token-secondary.json',
      'devnet-token-mayhem.json',
    ],
    name: 'Devnet',
  },
  mainnet: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    wallet: 'mainnet-wallet.json',
    tokens: ['mainnet-token-root.json'],
    name: 'Mainnet',
  },
};

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
  const networkArg = args.find(
    (a) => a.startsWith('--network=') || a.startsWith('--network ')
  );

  if (networkArg) {
    const network = networkArg.split('=')[1] || args[args.indexOf('--network') + 1];
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
