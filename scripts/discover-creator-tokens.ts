#!/usr/bin/env ts-node
/**
 * Discover Creator Tokens
 *
 * Automatically discovers all tokens created by the DAT creator wallet
 * and generates config files for them.
 *
 * Usage:
 *   npx ts-node scripts/discover-creator-tokens.ts --network mainnet
 *   npx ts-node scripts/discover-creator-tokens.ts --network devnet --dry-run
 *   npx ts-node scripts/discover-creator-tokens.ts --network mainnet --force
 *
 * Options:
 *   --network <mainnet|devnet>  Network to scan (required)
 *   --dry-run                   Preview without writing files
 *   --force                     Overwrite existing config files
 *   --verbose                   Show detailed output
 */

import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import * as fs from 'fs';
import * as path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import { PUMP_PROGRAM, PUMPSWAP_PROGRAM, WSOL_MINT, PoolType } from '../lib/amm-utils';
import { getNetworkConfig, NetworkType, parseNetworkArg } from '../lib/network-config';

// ============================================================================
// Types
// ============================================================================

interface TokenConfig {
  mint: string;
  bondingCurve: string;
  pool: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  isRoot: boolean;
  mayhemMode: boolean;
  tokenProgram: 'SPL' | 'Token2022';
  poolType: PoolType;
  network: NetworkType;
  discoveredAt?: string;
}


// ============================================================================
// Constants
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// ============================================================================
// PDA Derivation
// ============================================================================

/**
 * Derive bonding curve address from mint
 * Seeds: ["bonding-curve", mint]
 */
function deriveBondingCurve(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_PROGRAM
  )[0];
}

/**
 * Derive PumpSwap AMM pool address from mint
 * Seeds: ["pool", mint, wsol_mint]
 */
function deriveAmmPool(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), mint.toBuffer(), WSOL_MINT.toBuffer()],
    PUMPSWAP_PROGRAM
  )[0];
}

/**
 * Detect pool type by checking if bonding curve account exists
 * If BC exists and has data → bonding_curve
 * Otherwise → pumpswap_amm
 */
async function detectPoolType(
  connection: Connection,
  bondingCurve: PublicKey
): Promise<PoolType> {
  try {
    const info = await connection.getAccountInfo(bondingCurve);
    // BC account exists and has meaningful data (not just rent exempt)
    if (info && info.data.length > 8) {
      return 'bonding_curve';
    }
    return 'pumpswap_amm';
  } catch {
    return 'pumpswap_amm';
  }
}

// ============================================================================
// Helius DAS API
// ============================================================================

/**
 * Derive the bonding curve creator vault (where fees accumulate)
 * Seeds: ["creator-vault", creator] (with hyphen)
 */
function deriveBcCreatorVault(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  )[0];
}

/**
 * Derive the AMM creator vault authority
 * Seeds: ["creator_vault", creator] (with underscore)
 */
function deriveAmmCreatorVaultAuthority(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), creator.toBuffer()],
    PUMPSWAP_PROGRAM
  )[0];
}

/**
 * Extract mint from bonding curve account data
 * Bonding curve layout has mint at offset 8 (after discriminator)
 */
function extractMintFromBondingCurve(data: Buffer): PublicKey | null {
  try {
    // Skip 8-byte discriminator, then read 32-byte mint pubkey
    if (data.length >= 40) {
      return new PublicKey(data.slice(8, 40));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Scan a single vault for transactions and extract mints
 */
async function scanVaultForMints(
  connection: Connection,
  vaultAddress: PublicKey,
  vaultName: string,
  discoveredMints: Map<string, { name: string; symbol: string }>,
  verbose: boolean
): Promise<number> {
  let lastSig: string | undefined;
  let totalTxns = 0;
  let newMints = 0;

  while (true) {
    const signatures = await connection.getSignaturesForAddress(vaultAddress, {
      limit: 100,
      before: lastSig,
    });

    if (signatures.length === 0) break;

    totalTxns += signatures.length;
    lastSig = signatures[signatures.length - 1].signature;

    // Parse each transaction to find token interactions
    for (const sig of signatures) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta?.postTokenBalances) continue;

        // Look for token mints in the transaction
        for (const balance of tx.meta.postTokenBalances) {
          if (balance.mint && !discoveredMints.has(balance.mint)) {
            // Skip WSOL
            if (balance.mint === WSOL_MINT.toBase58()) continue;

            // Found a new mint - get metadata
            try {
              const mintInfo = await getTokenMetadata(connection, balance.mint);
              discoveredMints.set(balance.mint, mintInfo);
              newMints++;

              if (verbose) {
                console.log(
                  `${colors.dim}    Found: ${mintInfo.symbol} (${balance.mint.slice(0, 8)}...)${colors.reset}`
                );
              }
            } catch {
              // Skip tokens we can't get metadata for
            }
          }
        }
      } catch {
        // Skip failed transactions
      }
    }

    if (verbose && totalTxns % 100 === 0) {
      console.log(`${colors.dim}  ${vaultName}: Scanned ${totalTxns} txns, found ${newMints} new mints${colors.reset}`);
    }

    // Limit to 300 transactions per vault to avoid rate limits
    if (totalTxns >= 300) {
      if (verbose) {
        console.log(`${colors.dim}  ${vaultName}: Reached scan limit (300 txns)${colors.reset}`);
      }
      break;
    }
  }

  return totalTxns;
}

/**
 * Discover tokens by scanning both BC and AMM creator vault transaction histories
 * This finds all tokens that have sent fees to either vault type
 */
async function discoverTokensFromVault(
  connection: Connection,
  creatorAddress: string,
  verbose: boolean
): Promise<Map<string, { name: string; symbol: string }>> {
  const creatorPubkey = new PublicKey(creatorAddress);
  const bcVault = deriveBcCreatorVault(creatorPubkey);
  const ammVaultAuthority = deriveAmmCreatorVaultAuthority(creatorPubkey);

  // Get AMM vault ATA (WSOL token account)
  const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
  const ammVaultAta = getAssociatedTokenAddressSync(WSOL_MINT, ammVaultAuthority, true);

  if (verbose) {
    console.log(`${colors.dim}  BC Creator vault: ${bcVault.toBase58()}${colors.reset}`);
    console.log(`${colors.dim}  AMM Creator vault: ${ammVaultAta.toBase58()}${colors.reset}`);
  }

  const discoveredMints = new Map<string, { name: string; symbol: string }>();

  console.log(`${colors.dim}  Scanning vault transaction histories...${colors.reset}`);

  // Scan BC vault
  const bcTxns = await scanVaultForMints(
    connection,
    bcVault,
    'BC',
    discoveredMints,
    verbose
  );

  // Scan AMM vault
  const ammTxns = await scanVaultForMints(
    connection,
    ammVaultAta,
    'AMM',
    discoveredMints,
    verbose
  );

  if (verbose) {
    console.log(`${colors.dim}  Total: ${bcTxns + ammTxns} transactions scanned${colors.reset}`);
  }

  return discoveredMints;
}

/**
 * Get token metadata from on-chain
 */
async function getTokenMetadata(
  connection: Connection,
  mint: string
): Promise<{ name: string; symbol: string }> {
  // Try to get token metadata from Metaplex
  const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  const mintPubkey = new PublicKey(mint);

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mintPubkey.toBuffer()],
    METADATA_PROGRAM
  );

  const metadataAccount = await connection.getAccountInfo(metadataPda);

  if (metadataAccount) {
    // Parse metadata (simplified - just extract name and symbol)
    const data = metadataAccount.data;

    // Metadata layout: skip first bytes to get to name/symbol
    // This is a simplified parser
    try {
      // Name starts at offset ~65 (after key, update authority, mint, etc.)
      // Each string is: 4 bytes length + string bytes
      const nameOffset = 65;
      const nameLen = data.readUInt32LE(nameOffset);
      const name = data
        .slice(nameOffset + 4, nameOffset + 4 + Math.min(nameLen, 32))
        .toString('utf-8')
        .replace(/\0/g, '')
        .trim();

      const symbolOffset = nameOffset + 4 + 32; // Fixed 32 bytes for name
      const symbolLen = data.readUInt32LE(symbolOffset);
      const symbol = data
        .slice(symbolOffset + 4, symbolOffset + 4 + Math.min(symbolLen, 10))
        .toString('utf-8')
        .replace(/\0/g, '')
        .trim();

      return { name: name || 'Unknown', symbol: symbol || 'UNK' };
    } catch {
      return { name: 'Unknown', symbol: 'UNK' };
    }
  }

  return { name: 'Unknown', symbol: 'UNK' };
}

/**
 * Alternative: Discover by scanning pump.fun program accounts
 * Uses getProgramAccounts to find bonding curves owned by this creator
 */
async function discoverFromProgramAccounts(
  connection: Connection,
  creatorAddress: string,
  verbose: boolean
): Promise<Map<string, { name: string; symbol: string }>> {
  if (verbose) {
    console.log(`${colors.dim}  Scanning Pump.fun program accounts...${colors.reset}`);
  }

  const discoveredMints = new Map<string, { name: string; symbol: string }>();

  // This approach is more expensive but more reliable
  // Note: getProgramAccounts can be slow/rate-limited on public RPCs
  try {
    const accounts = await connection.getProgramAccounts(PUMP_PROGRAM, {
      filters: [
        // Filter by creator address in the account data
        // Creator is typically at a specific offset in bonding curve accounts
        {
          memcmp: {
            offset: 40, // After discriminator (8) + mint (32)
            bytes: creatorAddress,
          },
        },
      ],
    });

    for (const { pubkey, account } of accounts) {
      const mint = extractMintFromBondingCurve(account.data);
      if (mint && !discoveredMints.has(mint.toBase58())) {
        try {
          const metadata = await getTokenMetadata(connection, mint.toBase58());
          discoveredMints.set(mint.toBase58(), metadata);

          if (verbose) {
            console.log(
              `${colors.dim}    Found: ${metadata.symbol} (${mint.toBase58().slice(0, 8)}...)${colors.reset}`
            );
          }
        } catch {
          discoveredMints.set(mint.toBase58(), { name: 'Unknown', symbol: 'UNK' });
        }
      }
    }
  } catch (error: any) {
    if (verbose) {
      console.log(`${colors.dim}  getProgramAccounts not supported or failed: ${error.message}${colors.reset}`);
    }
  }

  return discoveredMints;
}

// ============================================================================
// Config File Management
// ============================================================================

/**
 * Load root token config to get creator wallet
 */
function loadRootToken(network: NetworkType): TokenConfig | null {
  const tokensDir = `${network}-tokens`;
  const rootPath = path.join(tokensDir, '01-root.json');

  // Try standard root file
  if (fs.existsSync(rootPath)) {
    return JSON.parse(fs.readFileSync(rootPath, 'utf-8'));
  }

  // Try to find any root token
  if (fs.existsSync(tokensDir)) {
    const files = fs.readdirSync(tokensDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const config = JSON.parse(fs.readFileSync(path.join(tokensDir, file), 'utf-8'));
      if (config.isRoot) {
        return config;
      }
    }
  }

  return null;
}

/**
 * Get existing token configs to avoid duplicates
 */
function getExistingMints(network: NetworkType): Set<string> {
  const mints = new Set<string>();
  const tokensDir = `${network}-tokens`;

  if (!fs.existsSync(tokensDir)) {
    return mints;
  }

  const files = fs.readdirSync(tokensDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(tokensDir, file), 'utf-8'));
      if (config.mint) {
        mints.add(config.mint);
      }
    } catch {
      // Skip invalid files
    }
  }

  return mints;
}

/**
 * Get next available index for new token config
 */
function getNextIndex(network: NetworkType): number {
  const tokensDir = `${network}-tokens`;

  if (!fs.existsSync(tokensDir)) {
    return 2; // Start at 02 (01 is root)
  }

  const files = fs.readdirSync(tokensDir).filter((f) => f.endsWith('.json'));
  let maxIndex = 1;

  for (const file of files) {
    const match = file.match(/^(\d+)-/);
    if (match) {
      const index = parseInt(match[1], 10);
      if (index > maxIndex) {
        maxIndex = index;
      }
    }
  }

  return maxIndex + 1;
}

/**
 * Write token config to file
 */
function writeTokenConfig(
  network: NetworkType,
  index: number,
  config: TokenConfig,
  dryRun: boolean
): string {
  const tokensDir = `${network}-tokens`;
  const symbol = config.symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
  const filename = `${String(index).padStart(2, '0')}-${symbol}.json`;
  const filepath = path.join(tokensDir, filename);

  if (dryRun) {
    console.log(`${colors.dim}  Would write: ${filepath}${colors.reset}`);
    return filepath;
  }

  // Ensure directory exists
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }

  fs.writeFileSync(filepath, JSON.stringify(config, null, 2) + '\n');
  return filepath;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const network = parseNetworkArg(args);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const verbose = args.includes('--verbose') || args.includes('-v');

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           ASDF-DAT Token Discovery                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`Network:  ${colors.cyan}${network}${colors.reset}`);
  console.log(`Dry Run:  ${dryRun ? colors.yellow + 'Yes' : colors.dim + 'No'}${colors.reset}`);
  console.log(`Force:    ${force ? colors.yellow + 'Yes' : colors.dim + 'No'}${colors.reset}`);
  console.log('');

  // Load network config
  const networkConfig = getNetworkConfig(args);

  // Load root token to get creator
  const rootToken = loadRootToken(network);
  if (!rootToken) {
    console.error(`${colors.red}Error: No root token found in ${network}-tokens/${colors.reset}`);
    console.log('Create a root token config first (01-root.json with isRoot: true)');
    process.exit(1);
  }

  const creatorWallet = rootToken.creator;
  console.log(`Creator:  ${colors.cyan}${creatorWallet}${colors.reset}`);
  console.log(`Root:     ${rootToken.symbol} (${rootToken.mint.slice(0, 8)}...)`);
  console.log('');

  // Get existing mints
  const existingMints = getExistingMints(network);
  console.log(`Existing configs: ${existingMints.size}`);

  // Setup connection
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

  // Discover tokens using program account scanning
  console.log(`\n${colors.cyan}Searching for tokens...${colors.reset}`);

  let discoveredMints: Map<string, { name: string; symbol: string }>;

  try {
    // Try getProgramAccounts first (more reliable)
    discoveredMints = await discoverFromProgramAccounts(connection, creatorWallet, verbose);

    // If no results, try vault transaction scanning
    if (discoveredMints.size === 0) {
      console.log(`${colors.dim}  No results from program accounts, scanning vault...${colors.reset}`);
      discoveredMints = await discoverTokensFromVault(connection, creatorWallet, verbose);
    }
  } catch (error: any) {
    console.error(`${colors.red}Error discovering tokens: ${error.message}${colors.reset}`);
    process.exit(1);
  }

  console.log(`Found ${discoveredMints.size} tokens from creator\n`);

  if (discoveredMints.size === 0) {
    console.log(`${colors.yellow}No tokens found. The creator may not have any pump.fun tokens.${colors.reset}`);
    process.exit(0);
  }

  // Process each discovered mint
  let newCount = 0;
  let skipCount = 0;
  let nextIndex = getNextIndex(network);

  console.log('Processing tokens:\n');

  for (const [mint, metadata] of discoveredMints) {
    const { name, symbol } = metadata;

    // Skip root token
    if (mint === rootToken.mint) {
      console.log(`  ${colors.dim}[SKIP] ${symbol} - Root token${colors.reset}`);
      skipCount++;
      continue;
    }

    // Skip existing unless force
    if (existingMints.has(mint) && !force) {
      console.log(`  ${colors.dim}[SKIP] ${symbol} - Already exists${colors.reset}`);
      skipCount++;
      continue;
    }

    // Derive addresses
    const mintPubkey = new PublicKey(mint);
    const bondingCurve = deriveBondingCurve(mintPubkey);
    const ammPool = deriveAmmPool(mintPubkey);

    // Detect pool type
    const poolType = await detectPoolType(connection, bondingCurve);
    const pool = poolType === 'bonding_curve' ? bondingCurve : ammPool;

    // Detect token program (Token2022 = mayhemMode)
    let isToken2022 = false;
    try {
      const mintInfo = await connection.getAccountInfo(mintPubkey);
      if (mintInfo) {
        const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
        isToken2022 = mintInfo.owner.equals(TOKEN_2022_PROGRAM);
      }
    } catch {
      // Default to SPL
    }

    // Build config
    const config: TokenConfig = {
      mint,
      bondingCurve: bondingCurve.toBase58(),
      pool: pool.toBase58(),
      creator: creatorWallet,
      name,
      symbol,
      uri: `https://pump.fun/coin/${mint}`,
      isRoot: false,
      mayhemMode: isToken2022,
      tokenProgram: isToken2022 ? 'Token2022' : 'SPL',
      poolType,
      network,
      discoveredAt: new Date().toISOString(),
    };

    // Write config
    const filepath = writeTokenConfig(network, nextIndex, config, dryRun);
    const poolTag = poolType === 'pumpswap_amm' ? 'AMM' : 'BC';
    const t2022Tag = isToken2022 ? ' T2022' : '';

    console.log(
      `  ${colors.green}[NEW]${colors.reset} ${symbol} (${mint.slice(0, 8)}...) ` +
        `${colors.dim}[${poolTag}${t2022Tag}]${colors.reset} → ${filepath}`
    );

    newCount++;
    nextIndex++;
  }

  // Summary
  console.log('\n' + '─'.repeat(60));
  console.log(`\nSummary:`);
  console.log(`  New:     ${colors.green}${newCount}${colors.reset}`);
  console.log(`  Skipped: ${colors.dim}${skipCount}${colors.reset}`);
  console.log(`  Total:   ${discoveredMints.size}`);

  if (dryRun && newCount > 0) {
    console.log(`\n${colors.yellow}Dry run - no files written. Remove --dry-run to write configs.${colors.reset}`);
  }

  console.log('');
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
