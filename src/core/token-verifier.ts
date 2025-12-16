/**
 * Token Verifier Module
 *
 * "Don't trust, verify" - Core verification for token data
 *
 * This module provides trustless verification of token state by:
 * 1. DERIVING all addresses from mint (bondingCurve, ammPool, creatorVault)
 * 2. DETECTING pool type, token program, mayhem mode from on-chain data
 * 3. EXTRACTING creator from account data
 * 4. VERIFYING everything matches expected state
 *
 * No data is trusted from configuration or state files.
 * Everything is verified on-chain before operations.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  PUMP_PROGRAM,
  TOKEN_2022_PROGRAM,
} from "./constants";
import {
  deriveBondingCurve,
  deriveAMMPool,
  deriveCreatorVaultBC,
  deriveCreatorVaultAMM,
  deriveTokenStats,
} from "./pda-utils";
import {
  PoolType,
  TokenProgramType,
  VerifiedToken,
  StoredToken,
} from "../types";

// ============================================================================
// Account Layout Constants
// Based on pump.fun bonding curve and PumpSwap AMM account structures
// ============================================================================

/**
 * Bonding Curve Account Layout
 *
 * IMPORTANT: Two formats exist:
 * - OLD (81-82 bytes): Mint stored at offset 8, creator at offset 49
 * - NEW (151 bytes): Mint NOT stored, creator still at offset 49
 *
 * The new format (Token2022 tokens) doesn't store the mint in the BC.
 * Discovery of new-format tokens requires stored token configs.
 */
const BC_LAYOUT = {
  DISCRIMINATOR: { offset: 0, size: 8 },
  MINT: { offset: 8, size: 32 },  // Only valid for old format (81-82 bytes)
  CREATOR: { offset: 49, size: 32 },  // Valid for both formats
  IS_MAYHEM_MODE: { offset: 81, size: 1 },  // Only for old format

  SIZE_OLD_NORMAL: 81,
  SIZE_OLD_MAYHEM: 82,
  SIZE_NEW: 151,  // New format, no mint stored
};

/**
 * PumpSwap AMM Pool Account Layout
 * Size: 243 bytes (non-mayhem) or 244 bytes (mayhem)
 */
const POOL_LAYOUT = {
  DISCRIMINATOR: { offset: 0, size: 8 },
  // ... other fields
  COIN_CREATOR: { offset: 49, size: 32 },   // Original creator
  CTO_CREATOR: { offset: 211, size: 32 },   // CTO creator (if applicable)
  IS_MAYHEM_MODE: { offset: 243, size: 1 }, // Optional last byte

  SIZE_NORMAL: 243,
  SIZE_MAYHEM: 244,
};

/**
 * System Program Address (null pubkey indicator)
 */
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

// ============================================================================
// PDA Derivation Helpers
// Uses functions from pda-utils.ts - single source of truth
// ============================================================================

/**
 * Derive all token addresses from mint
 * Uses pda-utils.ts functions for derivation
 */
export function deriveTokenAddresses(mint: PublicKey): {
  bondingCurve: PublicKey;
  ammPool: PublicKey;
  tokenStatsPda: PublicKey;
} {
  const [bondingCurve] = deriveBondingCurve(mint);
  const [ammPool] = deriveAMMPool(mint);
  const [tokenStatsPda] = deriveTokenStats(mint);

  return { bondingCurve, ammPool, tokenStatsPda };
}

// ============================================================================
// On-Chain Detection Functions
// ============================================================================

/**
 * Detect pool type by checking if bonding curve account exists
 * - If BC account exists and has data → bonding_curve
 * - Otherwise → pumpswap_amm (migrated)
 */
export async function detectPoolType(
  connection: Connection,
  bondingCurve: PublicKey
): Promise<PoolType> {
  try {
    const accountInfo = await connection.getAccountInfo(bondingCurve);

    // BC exists if account has data (old format 81-82, new format 151)
    if (accountInfo && accountInfo.data.length >= BC_LAYOUT.SIZE_OLD_NORMAL) {
      return "bonding_curve";
    }

    return "pumpswap_amm";
  } catch {
    // If we can't fetch, assume migrated to AMM
    return "pumpswap_amm";
  }
}

/**
 * Detect token program by checking mint account owner
 * - TokenkegQfe... → SPL
 * - TokenzQdBN... → Token2022
 */
export async function detectTokenProgram(
  connection: Connection,
  mint: PublicKey
): Promise<TokenProgramType> {
  try {
    const accountInfo = await connection.getAccountInfo(mint);

    if (!accountInfo) {
      throw new Error(`Mint account not found: ${mint.toBase58()}`);
    }

    const owner = accountInfo.owner;

    if (owner.equals(TOKEN_2022_PROGRAM)) {
      return "Token2022";
    }

    return "SPL";
  } catch (error) {
    throw new Error(`Failed to detect token program: ${(error as Error).message}`);
  }
}

/**
 * Detect mayhem mode from pool/BC account
 * - Check account size (mayhem adds 1 byte)
 * - Read last byte if mayhem size
 */
export async function detectMayhemMode(
  connection: Connection,
  poolAccount: PublicKey,
  poolType: PoolType
): Promise<boolean> {
  try {
    const accountInfo = await connection.getAccountInfo(poolAccount);

    if (!accountInfo) {
      return false;
    }

    const data = accountInfo.data;

    if (poolType === "bonding_curve") {
      // Old BC format: 82 bytes = mayhem, read byte at offset 81
      // New BC format (151 bytes): mayhem mode detection different
      if (data.length === BC_LAYOUT.SIZE_OLD_MAYHEM) {
        return data[BC_LAYOUT.IS_MAYHEM_MODE.offset] === 1;
      }
      // New format doesn't have mayhem byte at offset 81
      // For new format, mayhem mode is determined differently
      return false;
    } else {
      // AMM Pool: 244 bytes = mayhem, read byte at offset 243
      if (data.length >= POOL_LAYOUT.SIZE_MAYHEM) {
        return data[POOL_LAYOUT.IS_MAYHEM_MODE.offset] === 1;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Extract creator from bonding curve or AMM pool account
 * Returns both creator and isCTO flag
 */
export async function extractCreator(
  connection: Connection,
  poolAccount: PublicKey,
  poolType: PoolType
): Promise<{ creator: PublicKey; isCTO: boolean }> {
  const accountInfo = await connection.getAccountInfo(poolAccount);

  if (!accountInfo) {
    throw new Error(`Pool account not found: ${poolAccount.toBase58()}`);
  }

  const data = accountInfo.data;

  if (poolType === "bonding_curve") {
    // Extract creator from BC at offset 49-81
    const creatorBytes = data.slice(
      BC_LAYOUT.CREATOR.offset,
      BC_LAYOUT.CREATOR.offset + BC_LAYOUT.CREATOR.size
    );
    const creator = new PublicKey(creatorBytes);

    return { creator, isCTO: false };
  } else {
    // AMM Pool: Check both coin_creator and cto_creator
    const coinCreatorBytes = data.slice(
      POOL_LAYOUT.COIN_CREATOR.offset,
      POOL_LAYOUT.COIN_CREATOR.offset + POOL_LAYOUT.COIN_CREATOR.size
    );
    const ctoCreatorBytes = data.slice(
      POOL_LAYOUT.CTO_CREATOR.offset,
      POOL_LAYOUT.CTO_CREATOR.offset + POOL_LAYOUT.CTO_CREATOR.size
    );

    const coinCreator = new PublicKey(coinCreatorBytes);
    const ctoCreator = new PublicKey(ctoCreatorBytes);

    // If CTO creator is not null (system program), token has undergone CTO
    const isCTO = !ctoCreator.equals(SYSTEM_PROGRAM);

    // Return effective creator (CTO if present, otherwise original)
    const creator = isCTO ? ctoCreator : coinCreator;

    return { creator, isCTO };
  }
}

/**
 * Check if TokenStats PDA exists and extract pending fees
 */
export async function getTokenStatsInfo(
  connection: Connection,
  tokenStatsPda: PublicKey
): Promise<{
  exists: boolean;
  pendingFeesLamports: bigint;
  totalBurnedTokens: bigint;
} | null> {
  try {
    const accountInfo = await connection.getAccountInfo(tokenStatsPda);

    if (!accountInfo || accountInfo.data.length === 0) {
      return { exists: false, pendingFeesLamports: 0n, totalBurnedTokens: 0n };
    }

    // TokenStats account layout (simplified read)
    // We could use Anchor deserialization, but for simple reads this works
    // pending_fees_lamports is at a specific offset in the account
    // For now, return exists=true and let caller fetch via Anchor if needed
    return {
      exists: true,
      pendingFeesLamports: 0n, // To be filled by Anchor fetch
      totalBurnedTokens: 0n,   // To be filled by Anchor fetch
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Full Verification Function
// ============================================================================

/**
 * Verify a token completely on-chain
 *
 * This is the main entry point for token verification.
 * It derives all addresses, detects all states, and returns a fully verified token.
 *
 * @param connection - Solana connection
 * @param storedToken - Minimal stored token data (mint + isRoot)
 * @param expectedCreator - Optional expected creator for validation
 * @returns VerifiedToken with all data verified on-chain
 */
export async function verifyToken(
  connection: Connection,
  storedToken: StoredToken,
  expectedCreator?: PublicKey
): Promise<VerifiedToken | null> {
  try {
    const mint = new PublicKey(storedToken.mint);
    const slot = await connection.getSlot();

    // 1. Derive all addresses
    const { bondingCurve, ammPool, tokenStatsPda } = deriveTokenAddresses(mint);

    // 2. Detect pool type
    const poolType = await detectPoolType(connection, bondingCurve);

    // 3. Get the active pool account
    const activePool = poolType === "bonding_curve" ? bondingCurve : ammPool;

    // 4. Extract creator
    const { creator, isCTO } = await extractCreator(connection, activePool, poolType);

    // 5. Validate creator if expected
    if (expectedCreator && !creator.equals(expectedCreator)) {
      console.warn(`Creator mismatch for ${mint.toBase58()}: expected ${expectedCreator.toBase58()}, got ${creator.toBase58()}`);
      return null;
    }

    // 6. Detect token program
    const tokenProgram = await detectTokenProgram(connection, mint);

    // 7. Detect mayhem mode
    const isMayhemMode = await detectMayhemMode(connection, activePool, poolType);

    // 8. Derive creator vault based on pool type
    const [creatorVault] = poolType === "bonding_curve"
      ? deriveCreatorVaultBC(creator)
      : deriveCreatorVaultAMM(creator);

    // 9. Check TokenStats
    const tokenStatsInfo = await getTokenStatsInfo(connection, tokenStatsPda);

    // 10. Build verified token
    const verified: VerifiedToken = {
      // From stored
      mint: storedToken.mint,
      isRoot: storedToken.isRoot,
      symbol: storedToken.symbol,
      name: storedToken.name,

      // Derived
      bondingCurve,
      ammPool,
      poolType,
      tokenProgram,
      creator,
      creatorVault,
      isMayhemMode,
      isCTO,

      // On-chain state
      hasTokenStats: tokenStatsInfo?.exists ?? false,
      pendingFeesLamports: tokenStatsInfo?.pendingFeesLamports ?? 0n,
      totalBurnedTokens: tokenStatsInfo?.totalBurnedTokens ?? 0n,

      // Metadata
      lastVerifiedAt: Date.now(),
      verificationSlot: slot,
    };

    return verified;
  } catch (error) {
    console.error(`Failed to verify token ${storedToken.mint}:`, (error as Error).message);
    return null;
  }
}

/**
 * Verify multiple tokens in parallel
 */
export async function verifyTokens(
  connection: Connection,
  storedTokens: StoredToken[],
  expectedCreator?: PublicKey
): Promise<VerifiedToken[]> {
  const results = await Promise.all(
    storedTokens.map(token => verifyToken(connection, token, expectedCreator))
  );

  return results.filter((t): t is VerifiedToken => t !== null);
}

// ============================================================================
// Discovery Functions
// ============================================================================

/**
 * Resolve mint from a bonding curve address by checking its token accounts.
 * Works for BOTH old and new BC formats (including Token2022).
 *
 * Pattern from asdf-validator: Instead of reading mint from BC data,
 * we check what token accounts the BC owns. The token account data
 * contains the mint in the first 32 bytes.
 *
 * @param connection - Solana connection
 * @param bondingCurve - Bonding curve address
 * @returns Mint and token program, or null if not found
 */
export async function resolveMintFromBC(
  connection: Connection,
  bondingCurve: PublicKey
): Promise<{ mint: PublicKey; tokenProgram: TokenProgramType } | null> {
  try {
    // Try SPL Token first
    let tokenAccounts = await connection.getTokenAccountsByOwner(bondingCurve, {
      programId: TOKEN_PROGRAM_ID,
    });

    let tokenProgram: TokenProgramType = "SPL";

    // If no SPL accounts, try Token2022
    if (tokenAccounts.value.length === 0) {
      tokenAccounts = await connection.getTokenAccountsByOwner(bondingCurve, {
        programId: TOKEN_2022_PROGRAM,
      });
      tokenProgram = "Token2022";
    }

    if (tokenAccounts.value.length === 0) {
      return null;
    }

    // Token account data: first 32 bytes = mint
    const data = tokenAccounts.value[0].account.data;
    const mint = new PublicKey(data.slice(0, 32));

    return { mint, tokenProgram };
  } catch {
    return null;
  }
}

/**
 * Discover tokens by creator using getProgramAccounts
 * Filters bonding curve accounts by creator at offset 49
 *
 * Supports BOTH old (81-82 bytes) and new (151 bytes) BC formats:
 * - Old format: Extract mint directly from BC data (offset 8)
 * - New format: Resolve mint via getTokenAccountsByOwner
 *
 * @param connection - Solana connection
 * @param creator - Creator public key to search for
 * @returns Array of mints belonging to this creator
 */
export async function discoverTokensByCreator(
  connection: Connection,
  creator: PublicKey
): Promise<PublicKey[]> {
  try {
    // Search bonding curve accounts filtered by creator
    const accounts = await connection.getProgramAccounts(PUMP_PROGRAM, {
      filters: [
        {
          memcmp: {
            offset: BC_LAYOUT.CREATOR.offset,
            bytes: creator.toBase58(),
          },
        },
      ],
    });

    const mints: PublicKey[] = [];
    const newFormatBCs: PublicKey[] = [];

    // First pass: extract mints from old format, collect new format BCs
    for (const { pubkey, account } of accounts) {
      const size = account.data.length;

      if (size === BC_LAYOUT.SIZE_OLD_NORMAL || size === BC_LAYOUT.SIZE_OLD_MAYHEM) {
        // Old format: mint at offset 8
        const mintBytes = account.data.slice(
          BC_LAYOUT.MINT.offset,
          BC_LAYOUT.MINT.offset + BC_LAYOUT.MINT.size
        );
        mints.push(new PublicKey(mintBytes));
      } else if (size === BC_LAYOUT.SIZE_NEW) {
        // New format: need to resolve via token accounts
        newFormatBCs.push(pubkey);
      }
    }

    // Second pass: resolve mints for new format BCs in batches to avoid rate limits
    if (newFormatBCs.length > 0) {
      const BATCH_SIZE = 5; // Process 5 at a time to avoid 429s

      for (let i = 0; i < newFormatBCs.length; i += BATCH_SIZE) {
        const batch = newFormatBCs.slice(i, i + BATCH_SIZE);
        const resolvePromises = batch.map(bc => resolveMintFromBC(connection, bc));
        const resolved = await Promise.all(resolvePromises);

        for (const result of resolved) {
          if (result) {
            mints.push(result.mint);
          }
        }

        // Small delay between batches if more to process
        if (i + BATCH_SIZE < newFormatBCs.length) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    return mints;
  } catch (error) {
    console.error("Failed to discover tokens:", (error as Error).message);
    return [];
  }
}

/**
 * Discover and verify all tokens for a creator
 * Combines discovery + verification in one call
 */
export async function discoverAndVerifyTokens(
  connection: Connection,
  creator: PublicKey,
  rootTokenMint?: PublicKey
): Promise<VerifiedToken[]> {
  // 1. Discover all mints
  const mints = await discoverTokensByCreator(connection, creator);

  if (mints.length === 0) {
    return [];
  }

  // 2. Convert to StoredToken format
  const storedTokens: StoredToken[] = mints.map(mint => ({
    mint: mint.toBase58(),
    isRoot: rootTokenMint ? mint.equals(rootTokenMint) : false,
  }));

  // 3. Verify all tokens
  return verifyTokens(connection, storedTokens, creator);
}
