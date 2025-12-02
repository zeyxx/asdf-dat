/**
 * Token Discovery Library
 *
 * Provides functions to discover tokens created by a specific creator wallet.
 * Used by both the CLI discovery script and the daemon hot-reload feature.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  PUMP_PROGRAM,
  PUMPSWAP_PROGRAM,
  WSOL_MINT,
  PoolType,
  getBcCreatorVault,
  deriveAmmCreatorVaultAuthority,
} from './amm-utils';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredToken {
  mint: string;
  bondingCurve: string;
  pool: string;
  creator: string;
  isCTO: boolean;
  name: string;
  symbol: string;
  poolType: PoolType;
  tokenProgram: 'SPL' | 'Token2022';
  discoveredAt: string;
}

export interface DiscoveryOptions {
  verbose?: boolean;
  maxTransactions?: number; // Limit vault scan depth
}

export interface DiscoveryResult {
  tokens: DiscoveredToken[];
  scannedTransactions: number;
  errors: string[];
}

// ============================================================================
// PDA Derivation
// ============================================================================

/**
 * Derive bonding curve address from mint
 * Seeds: ["bonding-curve", mint]
 */
export function deriveBondingCurve(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_PROGRAM
  )[0];
}

/**
 * Derive PumpSwap AMM pool address from mint
 * Seeds: ["pool", mint, wsol_mint]
 */
export function deriveAmmPool(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), mint.toBuffer(), WSOL_MINT.toBuffer()],
    PUMPSWAP_PROGRAM
  )[0];
}

// ============================================================================
// Pool Detection
// ============================================================================

/**
 * Detect pool type by checking if bonding curve account exists
 * If BC exists and has data → bonding_curve
 * Otherwise → pumpswap_amm
 */
export async function detectPoolType(
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

/**
 * Extract the active creator address from on-chain pool data
 *
 * For bonding_curve:
 *   - Creator is at offset 49 (after discriminator + mint + other fields)
 *
 * For pumpswap_amm (migrated tokens):
 *   - coin_creator at offset 49 (original creator)
 *   - cto_creator at offset 211 (CTO creator, if CTO approved)
 *   - If cto_creator is non-zero, it's the ACTIVE creator receiving fees
 */
export async function extractCreatorFromPool(
  connection: Connection,
  bondingCurve: PublicKey,
  ammPool: PublicKey,
  poolType: PoolType
): Promise<{ creator: string; isCTO: boolean }> {
  try {
    if (poolType === 'bonding_curve') {
      // Bonding curve: creator at offset 49
      const bcInfo = await connection.getAccountInfo(bondingCurve);
      if (bcInfo && bcInfo.data.length >= 81) {
        const creator = new PublicKey(bcInfo.data.slice(49, 81));
        return { creator: creator.toBase58(), isCTO: false };
      }
    } else {
      // PumpSwap AMM: check both coin_creator and cto_creator
      const poolInfo = await connection.getAccountInfo(ammPool);
      if (poolInfo && poolInfo.data.length >= 243) {
        const coinCreator = new PublicKey(poolInfo.data.slice(49, 81));
        const ctoCreator = new PublicKey(poolInfo.data.slice(211, 243));

        // Check if CTO exists (non-zero address at offset 211)
        const hasCTO = !ctoCreator.equals(PublicKey.default);

        return {
          creator: hasCTO ? ctoCreator.toBase58() : coinCreator.toBase58(),
          isCTO: hasCTO,
        };
      }
    }
  } catch {
    // Fall through
  }

  return { creator: '', isCTO: false };
}

/**
 * Detect token program (SPL vs Token2022)
 */
export async function detectTokenProgram(
  connection: Connection,
  mint: PublicKey
): Promise<'SPL' | 'Token2022'> {
  try {
    const mintInfo = await connection.getAccountInfo(mint);
    if (mintInfo) {
      // Token2022 has a different program owner
      const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      if (mintInfo.owner.equals(TOKEN_2022_PROGRAM)) {
        return 'Token2022';
      }
    }
    return 'SPL';
  } catch {
    return 'SPL';
  }
}

// ============================================================================
// Token Metadata
// ============================================================================

const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/**
 * Get token metadata from Metaplex
 */
export async function getTokenMetadata(
  connection: Connection,
  mint: string
): Promise<{ name: string; symbol: string }> {
  const mintPubkey = new PublicKey(mint);

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mintPubkey.toBuffer()],
    METADATA_PROGRAM
  );

  try {
    const metadataAccount = await connection.getAccountInfo(metadataPda);

    if (metadataAccount) {
      const data = metadataAccount.data;

      // Simplified metadata parser
      const nameOffset = 65;
      const nameLen = data.readUInt32LE(nameOffset);
      const name = data
        .slice(nameOffset + 4, nameOffset + 4 + Math.min(nameLen, 32))
        .toString('utf-8')
        .replace(/\0/g, '')
        .trim();

      const symbolOffset = nameOffset + 4 + 32;
      const symbolLen = data.readUInt32LE(symbolOffset);
      const symbol = data
        .slice(symbolOffset + 4, symbolOffset + 4 + Math.min(symbolLen, 10))
        .toString('utf-8')
        .replace(/\0/g, '')
        .trim();

      return { name: name || 'Unknown', symbol: symbol || 'UNK' };
    }
  } catch {
    // Fall through
  }

  return { name: 'Unknown', symbol: 'UNK' };
}

// ============================================================================
// Discovery Methods
// ============================================================================

/**
 * Extract mint from bonding curve account data
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
 * Discover tokens by scanning Pump.fun program accounts
 * Uses getProgramAccounts to find bonding curves owned by creator
 */
export async function discoverFromProgramAccounts(
  connection: Connection,
  creatorAddress: string,
  options: DiscoveryOptions = {}
): Promise<Map<string, { name: string; symbol: string }>> {
  const { verbose = false } = options;
  const discoveredMints = new Map<string, { name: string; symbol: string }>();

  if (verbose) {
    console.log('  Scanning Pump.fun program accounts...');
  }

  try {
    const accounts = await connection.getProgramAccounts(PUMP_PROGRAM, {
      filters: [
        {
          memcmp: {
            offset: 49, // Creator offset in bonding curve
            bytes: creatorAddress,
          },
        },
      ],
    });

    for (const { account } of accounts) {
      const mint = extractMintFromBondingCurve(account.data);
      if (mint && !discoveredMints.has(mint.toBase58())) {
        try {
          const metadata = await getTokenMetadata(connection, mint.toBase58());
          discoveredMints.set(mint.toBase58(), metadata);

          if (verbose) {
            console.log(`    Found: ${metadata.symbol} (${mint.toBase58().slice(0, 8)}...)`);
          }
        } catch {
          discoveredMints.set(mint.toBase58(), { name: 'Unknown', symbol: 'UNK' });
        }
      }
    }
  } catch (error: any) {
    if (verbose) {
      console.log(`  getProgramAccounts failed: ${error.message}`);
    }
  }

  return discoveredMints;
}

/**
 * Discover tokens by scanning vault transaction histories
 */
export async function discoverFromVaultHistory(
  connection: Connection,
  creatorAddress: string,
  options: DiscoveryOptions = {}
): Promise<{ mints: Map<string, { name: string; symbol: string }>; txCount: number }> {
  const { verbose = false, maxTransactions = 300 } = options;
  const creatorPubkey = new PublicKey(creatorAddress);
  const bcVault = getBcCreatorVault(creatorPubkey);
  const [ammVaultAuthority] = deriveAmmCreatorVaultAuthority(creatorPubkey);
  const ammVaultAta = getAssociatedTokenAddressSync(WSOL_MINT, ammVaultAuthority, true);

  const discoveredMints = new Map<string, { name: string; symbol: string }>();
  let totalTxns = 0;

  // Scan both vault types
  for (const { vault, name } of [
    { vault: bcVault, name: 'BC' },
    { vault: ammVaultAta, name: 'AMM' },
  ]) {
    let lastSig: string | undefined;

    while (totalTxns < maxTransactions) {
      const signatures = await connection.getSignaturesForAddress(vault, {
        limit: 100,
        before: lastSig,
      });

      if (signatures.length === 0) break;

      totalTxns += signatures.length;
      lastSig = signatures[signatures.length - 1].signature;

      for (const sig of signatures) {
        try {
          const tx = await connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (!tx?.meta?.postTokenBalances) continue;

          for (const balance of tx.meta.postTokenBalances) {
            if (balance.mint && !discoveredMints.has(balance.mint)) {
              if (balance.mint === WSOL_MINT.toBase58()) continue;

              try {
                const mintInfo = await getTokenMetadata(connection, balance.mint);
                discoveredMints.set(balance.mint, mintInfo);

                if (verbose) {
                  console.log(`    Found: ${mintInfo.symbol} (${balance.mint.slice(0, 8)}...)`);
                }
              } catch {
                // Skip
              }
            }
          }
        } catch {
          // Skip failed transactions
        }
      }

      if (verbose && totalTxns % 100 === 0) {
        console.log(`  ${name}: Scanned ${totalTxns} txns`);
      }
    }
  }

  return { mints: discoveredMints, txCount: totalTxns };
}

// ============================================================================
// Main Discovery Function
// ============================================================================

/**
 * Discover all tokens created by a specific creator
 *
 * @param connection Solana connection
 * @param creatorAddress Creator wallet address (DAT Authority)
 * @param existingMints Set of already known mints to skip
 * @param options Discovery options
 * @returns Array of discovered tokens
 */
export async function discoverCreatorTokens(
  connection: Connection,
  creatorAddress: string,
  existingMints: Set<string> = new Set(),
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const { verbose = false } = options;
  const errors: string[] = [];
  let scannedTransactions = 0;

  // Combine both discovery methods
  const allMints = new Map<string, { name: string; symbol: string }>();

  // Method 1: Program accounts (faster but may miss migrated tokens)
  try {
    const programMints = await discoverFromProgramAccounts(connection, creatorAddress, options);
    for (const [mint, metadata] of programMints) {
      if (!existingMints.has(mint)) {
        allMints.set(mint, metadata);
      }
    }
  } catch (error: any) {
    errors.push(`Program account scan failed: ${error.message}`);
  }

  // Method 2: Vault history (slower but catches all tokens with fees)
  try {
    const { mints: vaultMints, txCount } = await discoverFromVaultHistory(
      connection,
      creatorAddress,
      options
    );
    scannedTransactions = txCount;

    for (const [mint, metadata] of vaultMints) {
      if (!existingMints.has(mint) && !allMints.has(mint)) {
        allMints.set(mint, metadata);
      }
    }
  } catch (error: any) {
    errors.push(`Vault scan failed: ${error.message}`);
  }

  // Build full token configs for new mints
  const tokens: DiscoveredToken[] = [];

  for (const [mint, metadata] of allMints) {
    try {
      const mintPubkey = new PublicKey(mint);
      const bondingCurve = deriveBondingCurve(mintPubkey);
      const ammPool = deriveAmmPool(mintPubkey);

      // Detect pool type
      const poolType = await detectPoolType(connection, bondingCurve);

      // Extract creator from pool (verify it matches)
      const { creator, isCTO } = await extractCreatorFromPool(
        connection,
        bondingCurve,
        ammPool,
        poolType
      );

      // Skip if creator doesn't match
      if (creator && creator !== creatorAddress) {
        if (verbose) {
          console.log(`  Skipping ${metadata.symbol}: creator mismatch (${creator.slice(0, 8)}...)`);
        }
        continue;
      }

      // Detect token program
      const tokenProgram = await detectTokenProgram(connection, mintPubkey);

      tokens.push({
        mint,
        bondingCurve: bondingCurve.toBase58(),
        pool: poolType === 'pumpswap_amm' ? ammPool.toBase58() : bondingCurve.toBase58(),
        creator: creator || creatorAddress,
        isCTO,
        name: metadata.name,
        symbol: metadata.symbol,
        poolType,
        tokenProgram,
        discoveredAt: new Date().toISOString(),
      });
    } catch (error: any) {
      errors.push(`Failed to process ${mint}: ${error.message}`);
    }
  }

  return {
    tokens,
    scannedTransactions,
    errors,
  };
}
