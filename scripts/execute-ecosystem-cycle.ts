/**
 * Execute Ecosystem Cycle - Complete orchestration of hierarchical token buyback
 *
 * This script orchestrates the complete ecosystem cycle:
 * 1. Query pending fees from all secondary tokens
 * 2. Collect all fees from creator vault (once)
 * 3. Calculate proportional distribution
 * 4. Execute buy for each secondary token with allocated amount
 * 5. Finalize each secondary token (reset pending_fees, increment cycles)
 * 6. Execute root token cycle with accumulated fees
 *
 * Architecture: Root token receives 44.8% from all secondaries
 *
 * Usage:
 *   npx ts-node scripts/execute-ecosystem-cycle.ts
 *
 * Requirements:
 *   - All tokens must be initialized with TokenStats
 *   - Root token must be configured (set_root_token)
 *   - Fee monitoring should be running (to populate pending_fees)
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Constants & Configuration
// ============================================================================

const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');
const DAT_STATE_SEED = Buffer.from('dat_v3');
const DAT_AUTHORITY_SEED = Buffer.from('auth_v3');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');
const ROOT_TREASURY_SEED = Buffer.from('root_treasury');

const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_GLOBAL_CONFIG = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ============================================================================
// Scalability Constants (aligned with lib.rs execute_buy)
// ============================================================================
// These values must match the on-chain constants for proper allocation validation
const RENT_EXEMPT_MINIMUM = 890_880;      // ~0.00089 SOL
const SAFETY_BUFFER = 50_000;             // ~0.00005 SOL
const ATA_RENT_RESERVE = 2_100_000;       // ~0.0021 SOL (for secondary ATA creation)
const MINIMUM_BUY_AMOUNT = 100_000;       // ~0.0001 SOL

// Fee split ratio: Secondary tokens send 44.8% to root, keeping 55.2% (fee_split_bps = 5520)
const SECONDARY_KEEP_RATIO = 0.552;

// Minimum allocation required per token type
const MIN_ALLOCATION_ROOT = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + MINIMUM_BUY_AMOUNT;
// = 890,880 + 50,000 + 100,000 = 1,040,880 lamports (~0.00104 SOL)

// CRITICAL FIX: MIN_ALLOCATION_SECONDARY must account for the 44.8% split to root treasury
// The allocated amount must be large enough that AFTER the split, there's enough for rent+buffer+ata+min_buy
const MIN_AFTER_SPLIT = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + ATA_RENT_RESERVE + MINIMUM_BUY_AMOUNT;
// = 890,880 + 50,000 + 2,100,000 + 100,000 = 3,140,880 lamports

const MIN_ALLOCATION_SECONDARY = Math.ceil(MIN_AFTER_SPLIT / SECONDARY_KEEP_RATIO);
// = 3,140,880 / 0.552 = 5,690,000 lamports (~0.00569 SOL)

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

// ============================================================================
// Types & Interfaces
// ============================================================================

interface TokenConfig {
  file: string;
  symbol: string;
  mint: PublicKey;
  bondingCurve: PublicKey;
  creator: PublicKey;
  isRoot: boolean;
  isToken2022: boolean;
}

interface TokenAllocation {
  token: TokenConfig;
  pendingFees: number;
  allocation: number;
  isRoot: boolean;
}

interface CycleResult {
  token: string;
  success: boolean;
  pendingFees?: number;
  allocation?: number;
  buyTx?: string;
  finalizeTx?: string;
  burnTx?: string;
  tokensBurned?: number;
  error?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function log(icon: string, message: string, color = colors.reset) {
  console.log(`${color}${icon} ${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(80)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(80)}${colors.reset}\n`);
}

function formatSOL(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Scalability Validation
// ============================================================================

interface EcosystemValidation {
  canProceed: boolean;
  secondaryCount: number;
  minRequired: number;
  available: number;
  message: string;
}

/**
 * Pre-flight validation to check if collected fees are sufficient for all tokens
 * This is an early warning system before attempting distribution
 */
function validateMinimumEcosystemFees(
  tokens: TokenConfig[],
  totalPending: number
): EcosystemValidation {
  const secondaryCount = tokens.filter(t => !t.isRoot).length;
  const minRequired = secondaryCount * MIN_ALLOCATION_SECONDARY;

  if (totalPending < minRequired) {
    return {
      canProceed: false,
      secondaryCount,
      minRequired,
      available: totalPending,
      message: `Pending fees (${formatSOL(totalPending)} SOL) < minimum required (${formatSOL(minRequired)} SOL) for ${secondaryCount} secondary tokens`
    };
  }

  return {
    canProceed: true,
    secondaryCount,
    minRequired,
    available: totalPending,
    message: `OK: ${formatSOL(totalPending)} SOL >= ${formatSOL(minRequired)} SOL minimum for ${secondaryCount} tokens`
  };
}

/**
 * Calculate minimum SOL needed for ecosystem with N secondary tokens
 */
function calculateMinimumEcosystemFees(secondaryCount: number): number {
  return secondaryCount * MIN_ALLOCATION_SECONDARY;
}

// ============================================================================
// Daemon Synchronization (Scalability Fix)
// ============================================================================

/**
 * Wait for validator daemon to sync all secondary tokens' pending_fees
 * This ensures all tokens have their fees registered before the cycle executes
 *
 * @param program - Anchor program instance
 * @param tokens - Array of token configs to check
 * @param maxWaitMs - Maximum time to wait (default 60s)
 * @returns true if all tokens have pending_fees > 0, false if timeout
 */
async function waitForDaemonSync(
  program: Program,
  tokens: TokenConfig[],
  maxWaitMs: number = 60000
): Promise<{ synced: boolean; tokensWithFees: string[]; tokensWithoutFees: string[] }> {
  logSection('PRE-FLIGHT: DAEMON SYNCHRONIZATION CHECK');

  const secondaryTokens = tokens.filter(t => !t.isRoot);
  const startTime = Date.now();
  let iteration = 0;

  while (Date.now() - startTime < maxWaitMs) {
    iteration++;
    const tokensWithFees: string[] = [];
    const tokensWithoutFees: string[] = [];

    for (const token of secondaryTokens) {
      try {
        const [tokenStatsPDA] = PublicKey.findProgramAddressSync(
          [TOKEN_STATS_SEED, token.mint.toBuffer()],
          program.programId
        );

        const tokenStats: any = await (program.account as any).tokenStats.fetch(tokenStatsPDA);
        const pendingFees = tokenStats.pendingFeesLamports.toNumber();

        if (pendingFees > 0) {
          tokensWithFees.push(token.symbol);
        } else {
          tokensWithoutFees.push(token.symbol);
        }
      } catch (error) {
        tokensWithoutFees.push(token.symbol);
      }
    }

    if (tokensWithoutFees.length === 0) {
      log('✅', `All ${secondaryTokens.length} secondary tokens have pending fees`, colors.green);
      for (const symbol of tokensWithFees) {
        log('  ✓', `${symbol}: pending_fees > 0`, colors.green);
      }
      return { synced: true, tokensWithFees, tokensWithoutFees };
    }

    if (iteration === 1) {
      log('⏳', `Waiting for daemon to sync ${tokensWithoutFees.length} token(s)...`, colors.yellow);
      for (const symbol of tokensWithoutFees) {
        log('  ⏳', `${symbol}: pending_fees = 0 (waiting)`, colors.yellow);
      }
      for (const symbol of tokensWithFees) {
        log('  ✓', `${symbol}: pending_fees > 0`, colors.green);
      }
    }

    await sleep(5000); // Wait 5s before retry
  }

  // Timeout - proceed with available tokens
  const finalTokensWithFees: string[] = [];
  const finalTokensWithoutFees: string[] = [];

  for (const token of secondaryTokens) {
    try {
      const [tokenStatsPDA] = PublicKey.findProgramAddressSync(
        [TOKEN_STATS_SEED, token.mint.toBuffer()],
        program.programId
      );
      const tokenStats: any = await (program.account as any).tokenStats.fetch(tokenStatsPDA);
      if (tokenStats.pendingFeesLamports.toNumber() > 0) {
        finalTokensWithFees.push(token.symbol);
      } else {
        finalTokensWithoutFees.push(token.symbol);
      }
    } catch {
      finalTokensWithoutFees.push(token.symbol);
    }
  }

  log('⚠️', `Timeout after ${maxWaitMs / 1000}s - proceeding with ${finalTokensWithFees.length}/${secondaryTokens.length} tokens`, colors.yellow);
  if (finalTokensWithoutFees.length > 0) {
    log('ℹ️', `Tokens without pending fees will be DEFERRED: ${finalTokensWithoutFees.join(', ')}`, colors.cyan);
  }

  return { synced: false, tokensWithFees: finalTokensWithFees, tokensWithoutFees: finalTokensWithoutFees };
}

// ============================================================================
// Token Configuration Loader
// ============================================================================

async function loadEcosystemTokens(connection: Connection): Promise<TokenConfig[]> {
  const tokenFiles = [
    { file: 'devnet-token-spl.json', symbol: 'DATSPL', isRoot: true, isToken2022: false },
    { file: 'devnet-token-secondary.json', symbol: 'DATS2', isRoot: false, isToken2022: false },
    { file: 'devnet-token-mayhem.json', symbol: 'DATM', isRoot: false, isToken2022: true },
  ];

  const tokens: TokenConfig[] = [];

  for (const config of tokenFiles) {
    const filePath = path.join(__dirname, '..', config.file);

    if (!fs.existsSync(filePath)) {
      log('⚠️', `Token file not found: ${config.file}`, colors.yellow);
      continue;
    }

    try {
      const tokenData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      tokens.push({
        file: config.file,
        symbol: config.symbol,
        mint: new PublicKey(tokenData.mint),
        bondingCurve: new PublicKey(tokenData.bondingCurve),
        creator: new PublicKey(tokenData.creator),
        isRoot: config.isRoot,
        isToken2022: config.isToken2022,
      });
      log('✓', `Loaded ${config.symbol} from ${config.file}`, colors.green);
    } catch (error) {
      log('❌', `Failed to load ${config.file}: ${(error as Error).message || String(error)}`, colors.red);
    }
  }

  if (tokens.length === 0) {
    throw new Error('No tokens loaded. Ensure token config files exist.');
  }

  // Verify we have exactly one root token
  const rootTokens = tokens.filter(t => t.isRoot);
  if (rootTokens.length === 0) {
    throw new Error('No root token found in configuration');
  }
  if (rootTokens.length > 1) {
    throw new Error('Multiple root tokens found. Only one root token is allowed.');
  }

  log('📊', `Loaded ${tokens.length} tokens: ${rootTokens.length} root, ${tokens.length - 1} secondary`, colors.cyan);
  return tokens;
}

// ============================================================================
// Step 1: Query Pending Fees
// ============================================================================

async function queryPendingFees(
  program: Program,
  tokens: TokenConfig[]
): Promise<TokenAllocation[]> {
  logSection('STEP 1: QUERY PENDING FEES');

  const allocations: TokenAllocation[] = [];

  for (const token of tokens) {
    if (token.isRoot) {
      // Root token doesn't have pending fees from this mechanism
      allocations.push({
        token,
        pendingFees: 0,
        allocation: 0,
        isRoot: true,
      });
      log('ℹ️', `${token.symbol} (ROOT): Skipped (will collect from root treasury)`, colors.cyan);
      continue;
    }

    try {
      // Derive TokenStats PDA
      const [tokenStatsPDA] = PublicKey.findProgramAddressSync(
        [TOKEN_STATS_SEED, token.mint.toBuffer()],
        program.programId
      );

      // Fetch TokenStats account
      const tokenStats: any = await (program.account as any).tokenStats.fetch(tokenStatsPDA);

      const pendingFees = tokenStats.pendingFeesLamports.toNumber();

      allocations.push({
        token,
        pendingFees,
        allocation: 0, // Will be calculated in next step
        isRoot: false,
      });

      log('💰', `${token.symbol}: ${formatSOL(pendingFees)} SOL pending (${pendingFees} lamports)`,
        pendingFees > 0 ? colors.green : colors.yellow);

    } catch (error) {
      log('❌', `${token.symbol}: Failed to query pending fees - ${(error as Error).message || String(error)}`, colors.red);
      throw error;
    }
  }

  // Calculate total pending fees
  const totalPending = allocations
    .filter(a => !a.isRoot)
    .reduce((sum, a) => sum + a.pendingFees, 0);

  log('📊', `Total pending fees: ${formatSOL(totalPending)} SOL (${totalPending} lamports)`, colors.bright);

  if (totalPending === 0) {
    log('⚠️', 'No pending fees found. Ensure fee monitoring is running and has accumulated fees.', colors.yellow);
  }

  return allocations;
}

// ============================================================================
// Step 2: Collect All Vault Fees
// ============================================================================

async function collectAllVaultFees(
  program: Program,
  rootToken: TokenConfig,
  adminKeypair: Keypair
): Promise<number> {
  logSection('STEP 2: COLLECT ALL VAULT FEES');

  const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
  const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], program.programId);
  const [tokenStats] = PublicKey.findProgramAddressSync(
    [TOKEN_STATS_SEED, rootToken.mint.toBuffer()],
    program.programId
  );

  // Use token creator from config (not admin, each token has its own creator)
  const creator = rootToken.creator;

  // Derive creator vault PDA (from PumpFun program)
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  );

  // Derive root treasury PDA
  const [rootTreasury] = PublicKey.findProgramAddressSync(
    [ROOT_TREASURY_SEED, rootToken.mint.toBuffer()],
    program.programId
  );

  // Derive pump event authority
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    PUMP_PROGRAM
  );

  // Check vault balance before collection
  const vaultBalanceBefore = await program.provider.connection.getBalance(creatorVault);
  log('💰', `Creator vault balance: ${formatSOL(vaultBalanceBefore)} SOL`, colors.cyan);

  if (vaultBalanceBefore === 0) {
    log('⚠️', 'Creator vault is empty. No fees to collect.', colors.yellow);
    return 0;
  }

  try {
    log('📝', 'Calling collect_fees(is_root_token=true, for_ecosystem=true)...', colors.cyan);

    // Call collect_fees with for_ecosystem=true to preserve pending_fees
    const tx = await program.methods
      .collectFees(true, true) // is_root_token=true, for_ecosystem=true
      .accounts({
        datState,
        tokenStats,
        tokenMint: rootToken.mint,
        datAuthority,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury,
        systemProgram: SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();

    log('✅', `Fees collected: ${tx}`, colors.green);

    // Check vault balance after collection
    const vaultBalanceAfter = await program.provider.connection.getBalance(creatorVault);
    const collected = vaultBalanceBefore - vaultBalanceAfter;

    log('💸', `Collected: ${formatSOL(collected)} SOL (${collected} lamports)`, colors.bright);

    return collected;

  } catch (error) {
    log('❌', `Failed to collect vault fees: ${(error as Error).message || String(error)}`, colors.red);
    throw error;
  }
}

// ============================================================================
// Step 3: Normalize Allocations (Scalable Version)
// ============================================================================

interface ScalableAllocationResult {
  viable: TokenAllocation[];
  skipped: TokenAllocation[];
  ratio: number;
}

function normalizeAllocations(
  allocations: TokenAllocation[],
  actualCollected: number
): ScalableAllocationResult {
  logSection('STEP 3: CALCULATE PROPORTIONAL DISTRIBUTION (SCALABLE)');

  const secondaries = allocations.filter(a => !a.isRoot);
  const totalPending = secondaries.reduce((sum, a) => sum + a.pendingFees, 0);

  if (totalPending === 0) {
    log('⚠️', 'No pending fees to distribute', colors.yellow);
    return { viable: [], skipped: [], ratio: 0 };
  }

  const ratio = actualCollected / totalPending;

  log('📊', `Total pending: ${formatSOL(totalPending)} SOL`, colors.cyan);
  log('💰', `Actual collected: ${formatSOL(actualCollected)} SOL`, colors.cyan);
  log('📐', `Distribution ratio: ${ratio.toFixed(6)}`, ratio >= 0.95 ? colors.green : colors.yellow);
  log('🔒', `Min allocation per secondary: ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL`, colors.cyan);

  if (ratio < 0.95) {
    log('⚠️', 'Collected amount is significantly less than pending fees', colors.yellow);
    log('ℹ️', 'This can happen if fees were spent or if pending_fees tracking is out of sync', colors.cyan);
  }

  // Phase 1: Calculate preliminary allocation for each secondary token
  const preliminary = secondaries.map(alloc => ({
    ...alloc,
    allocation: Math.floor(alloc.pendingFees * ratio),
  }));

  // Phase 2: Filter tokens that meet minimum allocation requirements
  const viable = preliminary.filter(a => a.allocation >= MIN_ALLOCATION_SECONDARY);
  const skipped = preliminary.filter(a => a.allocation < MIN_ALLOCATION_SECONDARY);

  // Phase 3: Redistribute skipped allocations to viable tokens proportionally
  if (viable.length > 0 && skipped.length > 0) {
    const skippedTotal = skipped.reduce((sum, a) => sum + a.allocation, 0);
    const viableTotal = viable.reduce((sum, a) => sum + a.allocation, 0);

    if (viableTotal > 0) {
      // Redistribute proportionally based on each viable token's share
      const redistributionRatio = (viableTotal + skippedTotal) / viableTotal;
      viable.forEach(a => {
        a.allocation = Math.floor(a.allocation * redistributionRatio);
      });
      log('🔄', `Redistributed ${formatSOL(skippedTotal)} SOL from ${skipped.length} deferred tokens`, colors.cyan);
    }
  }

  // Display allocation table with status
  console.log('\n' + colors.bright + 'Token Allocations:' + colors.reset);
  console.log('─'.repeat(90));
  console.log(`${'Token'.padEnd(12)} ${'Pending Fees'.padEnd(18)} ${'Allocated'.padEnd(18)} ${'Min Required'.padEnd(18)} ${'Status'.padEnd(12)}`);
  console.log('─'.repeat(90));

  for (const alloc of preliminary) {
    const isViable = alloc.allocation >= MIN_ALLOCATION_SECONDARY;
    const status = isViable ? '✅ VIABLE' : '⏭️ DEFERRED';
    const statusColor = isViable ? colors.green : colors.yellow;
    console.log(
      `${alloc.token.symbol.padEnd(12)} ${formatSOL(alloc.pendingFees).padEnd(18)} ` +
      `${formatSOL(alloc.allocation).padEnd(18)} ${formatSOL(MIN_ALLOCATION_SECONDARY).padEnd(18)} ` +
      `${statusColor}${status}${colors.reset}`
    );
  }
  console.log('─'.repeat(90));

  // Log deferred tokens for transparency
  if (skipped.length > 0) {
    console.log('');
    log('ℹ️', `${skipped.length} token(s) deferred - will accumulate and process in next cycle:`, colors.yellow);
    for (const s of skipped) {
      log('⏭️', `${s.token.symbol}: ${formatSOL(s.allocation)} SOL < ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL minimum`, colors.yellow);
    }
  }

  // Summary
  console.log('');
  log('📊', `Viable tokens: ${viable.length}/${secondaries.length}`, viable.length > 0 ? colors.green : colors.yellow);
  if (viable.length > 0) {
    const totalViableAllocation = viable.reduce((sum, a) => sum + a.allocation, 0);
    log('💰', `Total viable allocation: ${formatSOL(totalViableAllocation)} SOL`, colors.green);
  }

  return { viable, skipped, ratio };
}

// ============================================================================
// Step 4: Execute Secondary Cycles with DYNAMIC Allocation
// ============================================================================

/**
 * Get the actual datAuthority balance
 */
async function getDatAuthorityBalance(connection: Connection, programId: PublicKey): Promise<number> {
  const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], programId);
  const balance = await connection.getBalance(datAuthority);
  return balance;
}

/**
 * Calculate dynamic allocation based on actual remaining balance
 * This fixes the issue where pre-calculated allocations don't account for actual consumption
 */
function calculateDynamicAllocation(
  availableBalance: number,
  tokenPendingFees: number,
  totalRemainingPending: number,
  numRemainingTokens: number
): { allocation: number; viable: boolean; reason: string } {
  // Reserve rent-exempt minimum for datAuthority
  const RESERVE_FOR_ACCOUNT = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER;

  const distributable = availableBalance - RESERVE_FOR_ACCOUNT;

  if (distributable <= 0) {
    return { allocation: 0, viable: false, reason: 'No distributable balance after reserves' };
  }

  // Calculate proportional allocation
  const ratio = totalRemainingPending > 0 ? tokenPendingFees / totalRemainingPending : 1 / numRemainingTokens;
  const allocation = Math.floor(distributable * ratio);

  // Check if allocation meets minimum
  if (allocation < MIN_ALLOCATION_SECONDARY) {
    return {
      allocation,
      viable: false,
      reason: `Allocation ${formatSOL(allocation)} < minimum ${formatSOL(MIN_ALLOCATION_SECONDARY)}`
    };
  }

  return { allocation, viable: true, reason: 'OK' };
}

/**
 * Execute secondary tokens with dynamic balance checking
 * This replaces the pre-calculated allocation approach
 */
async function executeSecondaryTokensDynamic(
  program: Program,
  connection: Connection,
  secondaryAllocations: TokenAllocation[],
  adminKeypair: Keypair
): Promise<{ results: { [key: string]: CycleResult }; viable: TokenAllocation[]; deferred: TokenAllocation[] }> {
  logSection('STEP 4: EXECUTE SECONDARY TOKEN CYCLES (DYNAMIC)');

  const results: { [key: string]: CycleResult } = {};
  const viable: TokenAllocation[] = [];
  const deferred: TokenAllocation[] = [];

  // Sort by pending fees descending - process largest first
  const sorted = [...secondaryAllocations].sort((a, b) => b.pendingFees - a.pendingFees);

  // Track remaining tokens and their pending fees
  let remainingTokens = [...sorted];

  for (const allocation of sorted) {
    // Get ACTUAL balance before this cycle
    const actualBalance = await getDatAuthorityBalance(connection, program.programId);

    // Calculate remaining pending fees (excluding already processed tokens)
    const totalRemainingPending = remainingTokens.reduce((sum, t) => sum + t.pendingFees, 0);

    log('📊', `Balance check for ${allocation.token.symbol}:`, colors.cyan);
    log('  💰', `datAuthority balance: ${formatSOL(actualBalance)} SOL`, colors.cyan);
    log('  📋', `Remaining tokens: ${remainingTokens.length}`, colors.cyan);
    log('  📊', `Total remaining pending: ${formatSOL(totalRemainingPending)} SOL`, colors.cyan);

    // Calculate dynamic allocation
    const { allocation: dynamicAlloc, viable: isViable, reason } = calculateDynamicAllocation(
      actualBalance,
      allocation.pendingFees,
      totalRemainingPending,
      remainingTokens.length
    );

    // Update allocation with dynamic value
    allocation.allocation = dynamicAlloc;

    if (!isViable) {
      log('⏭️', `${allocation.token.symbol} DEFERRED: ${reason}`, colors.yellow);
      deferred.push(allocation);
      results[allocation.token.symbol] = {
        token: allocation.token.symbol,
        success: true, // Deferred is not a failure
        pendingFees: allocation.pendingFees,
        allocation: dynamicAlloc,
        error: `DEFERRED: ${reason}`,
      };
    } else {
      log('✅', `${allocation.token.symbol} VIABLE: allocation = ${formatSOL(dynamicAlloc)} SOL`, colors.green);

      // Execute the cycle
      const result = await executeSecondaryWithAllocation(program, allocation, adminKeypair);
      results[allocation.token.symbol] = result;

      if (result.success) {
        viable.push(allocation);
      }
    }

    // Remove from remaining tokens
    remainingTokens = remainingTokens.filter(t => t.token.symbol !== allocation.token.symbol);
    console.log(''); // Spacing
  }

  return { results, viable, deferred };
}

async function executeSecondaryWithAllocation(
  program: Program,
  allocation: TokenAllocation,
  adminKeypair: Keypair
): Promise<CycleResult> {
  const result: CycleResult = {
    token: allocation.token.symbol,
    success: false,
    pendingFees: allocation.pendingFees,
    allocation: allocation.allocation,
  };

  try {
    log('🔄', `Processing ${allocation.token.symbol}...`, colors.cyan);

    // Derive all required PDAs
    const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
    const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], program.programId);
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, allocation.token.mint.toBuffer()],
      program.programId
    );

    // Get state to determine root token and other params
    const state: any = await (program.account as any).datState.fetch(datState);
    const rootMint = state.rootTokenMint;

    if (!rootMint) {
      throw new Error('Root token not configured in DAT state');
    }

    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [ROOT_TREASURY_SEED, rootMint.toBuffer()],
      program.programId
    );

    // Derive other required accounts
    // Use the token's creator (DAT Authority), NOT the admin wallet
    const creator = allocation.token.creator;
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), creator.toBuffer()],
      PUMP_PROGRAM
    );

    const tokenProgram = allocation.token.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    // Derive ATA for DAT authority
    const [datAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        datAuthority.toBuffer(),
        tokenProgram.toBuffer(),
        allocation.token.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') // Associated Token Program
    );

    // Derive pool accounts
    const [poolAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        allocation.token.bondingCurve.toBuffer(),
        tokenProgram.toBuffer(),
        allocation.token.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    const wsolMint = new PublicKey('So11111111111111111111111111111111111111112');
    const [poolWsolAccount] = PublicKey.findProgramAddressSync(
      [
        allocation.token.bondingCurve.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        wsolMint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    // Protocol fee recipient (different for Mayhem vs SPL)
    const MAYHEM_FEE_RECIPIENT = new PublicKey('GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS');
    const SPL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');

    const protocolFeeRecipient = allocation.token.isToken2022 ? MAYHEM_FEE_RECIPIENT : SPL_FEE_RECIPIENT;
    const ataMint = allocation.token.isToken2022 ? wsolMint : allocation.token.mint;
    const ataTokenProgram = allocation.token.isToken2022 ? TOKEN_PROGRAM_ID : tokenProgram;

    const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
      [
        protocolFeeRecipient.toBuffer(),
        ataTokenProgram.toBuffer(),
        ataMint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    // PumpFun volume accumulator accounts
    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('global_volume_accumulator')],
      PUMP_PROGRAM
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
      PUMP_PROGRAM
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()],
      FEE_PROGRAM
    );

    // Step 4a: Execute buy with allocated amount
    log('  💸', `Executing buy with allocated ${formatSOL(allocation.allocation)} SOL...`, colors.cyan);

    const buyTx = await program.methods
      .executeBuy(true, new BN(allocation.allocation)) // is_secondary=true, allocated_lamports
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount,
        pool: allocation.token.bondingCurve,
        asdfMint: allocation.token.mint,
        poolAsdfAccount,
        poolWsolAccount,
        pumpGlobalConfig: PUMP_GLOBAL_CONFIG,
        protocolFeeRecipient,
        protocolFeeRecipientAta,
        creatorVault,
        pumpEventAuthority: PUMP_EVENT_AUTHORITY,
        pumpSwapProgram: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        rootTreasury,
        tokenProgram,
        systemProgram: SystemProgram.programId,
        rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
      })
      .signers([adminKeypair])
      .rpc();

    result.buyTx = buyTx;
    log('  ✅', `Buy completed: ${buyTx.slice(0, 16)}...`, colors.green);

    // Step 4b: Finalize allocated cycle (reset pending_fees, increment cycles_participated)
    // Pass true because this token actually participated in the cycle
    log('  🔄', 'Finalizing cycle (actually_participated=true)...', colors.cyan);

    const finalizeTx = await program.methods
      .finalizeAllocatedCycle(true) // Token participated - reset pending_fees
      .accounts({
        datState,
        tokenStats,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    result.finalizeTx = finalizeTx;
    log('  ✅', `Finalized: ${finalizeTx.slice(0, 16)}...`, colors.green);

    // Step 4c: Burn tokens
    log('  🔥', 'Burning tokens...', colors.cyan);

    const burnTx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        tokenStats,
        datAuthority,
        asdfMint: allocation.token.mint,
        datAsdfAccount,
        tokenProgram,
      })
      .signers([adminKeypair])
      .rpc();

    result.burnTx = burnTx;

    // Fetch final stats to get burned amount
    const finalStats: any = await (program.account as any).tokenStats.fetch(tokenStats);
    result.tokensBurned = finalStats.totalBurned.toNumber();

    log('  🔥', `Burned: ${burnTx.slice(0, 16)}...`, colors.green);
    log('  ✅', `${allocation.token.symbol} cycle complete!`, colors.bright);

    result.success = true;
    return result;

  } catch (error) {
    const errorMsg = (error as Error).message || String(error);
    result.error = errorMsg;
    log('  ❌', `Failed: ${errorMsg}`, colors.red);
    return result;
  }
}

// ============================================================================
// Step 4b: Finalize Deferred Tokens (preserve pending_fees)
// ============================================================================

/**
 * Finalize deferred tokens with actually_participated=false
 * This preserves their pending_fees for the next cycle
 */
async function finalizeDeferredTokens(
  program: Program,
  skippedAllocations: TokenAllocation[],
  adminKeypair: Keypair
): Promise<void> {
  if (skippedAllocations.length === 0) return;

  logSection('FINALIZE DEFERRED TOKENS (PRESERVE PENDING_FEES)');

  for (const allocation of skippedAllocations) {
    try {
      const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
      const [tokenStats] = PublicKey.findProgramAddressSync(
        [TOKEN_STATS_SEED, allocation.token.mint.toBuffer()],
        program.programId
      );

      log('⏭️', `Finalizing ${allocation.token.symbol} (deferred - preserving pending_fees)...`, colors.yellow);

      const finalizeTx = await program.methods
        .finalizeAllocatedCycle(false) // Token did NOT participate - preserve pending_fees
        .accounts({
          datState,
          tokenStats,
          admin: adminKeypair.publicKey,
        })
        .signers([adminKeypair])
        .rpc();

      log('  ✅', `${allocation.token.symbol}: pending_fees preserved, TX: ${finalizeTx.slice(0, 16)}...`, colors.green);

    } catch (error) {
      const errorMsg = (error as Error).message || String(error);
      log('  ⚠️', `${allocation.token.symbol}: Failed to finalize deferred - ${errorMsg}`, colors.yellow);
    }
  }
}

// ============================================================================
// Step 5: Execute Root Cycle
// ============================================================================

async function executeRootCycle(
  program: Program,
  rootToken: TokenConfig,
  adminKeypair: Keypair
): Promise<CycleResult> {
  logSection('STEP 5: EXECUTE ROOT TOKEN CYCLE');

  const result: CycleResult = {
    token: rootToken.symbol,
    success: false,
  };

  try {
    log('🔄', `Processing ${rootToken.symbol} (ROOT)...`, colors.cyan);

    // Derive PDAs
    const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
    const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], program.programId);
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, rootToken.mint.toBuffer()],
      program.programId
    );

    const creator = rootToken.creator;
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), creator.toBuffer()],
      PUMP_PROGRAM
    );

    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [ROOT_TREASURY_SEED, rootToken.mint.toBuffer()],
      program.programId
    );

    const tokenProgram = TOKEN_PROGRAM_ID; // Root is always standard SPL

    const [datAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        datAuthority.toBuffer(),
        tokenProgram.toBuffer(),
        rootToken.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    const [poolAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        rootToken.bondingCurve.toBuffer(),
        tokenProgram.toBuffer(),
        rootToken.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    const wsolMint = new PublicKey('So11111111111111111111111111111111111111112');
    const [poolWsolAccount] = PublicKey.findProgramAddressSync(
      [
        rootToken.bondingCurve.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        wsolMint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    const protocolFeeRecipient = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');
    const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
      [
        protocolFeeRecipient.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        WSOL_MINT.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('global_volume_accumulator')],
      PUMP_PROGRAM
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
      PUMP_PROGRAM
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()],
      FEE_PROGRAM
    );

    const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      PUMP_PROGRAM
    );

    // Step 5a: Collect fees from root treasury
    log('  💰', 'Collecting fees from root treasury...', colors.cyan);

    const collectTx = await program.methods
      .collectFees(true, false) // is_root_token=true, for_ecosystem=false
      .accounts({
        datState,
        tokenStats,
        tokenMint: rootToken.mint,
        datAuthority,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury,
        systemProgram: SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();

    log('  ✅', `Collected: ${collectTx.slice(0, 16)}...`, colors.green);

    // Step 5b: Execute buy (100% for buyback, no split)
    log('  💸', 'Executing buy (100% for buyback)...', colors.cyan);

    const buyTx = await program.methods
      .executeBuy(false, null) // is_secondary=false, no allocated_lamports (use balance)
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount,
        pool: rootToken.bondingCurve,
        asdfMint: rootToken.mint,
        poolAsdfAccount,
        poolWsolAccount,
        pumpGlobalConfig: PUMP_GLOBAL_CONFIG,
        protocolFeeRecipient,
        protocolFeeRecipientAta,
        creatorVault,
        pumpEventAuthority: PUMP_EVENT_AUTHORITY,
        pumpSwapProgram: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        rootTreasury,
        tokenProgram,
        systemProgram: SystemProgram.programId,
        rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
      })
      .signers([adminKeypair])
      .rpc();

    result.buyTx = buyTx;
    log('  ✅', `Buy completed: ${buyTx.slice(0, 16)}...`, colors.green);

    // Step 5c: Burn tokens
    log('  🔥', 'Burning tokens...', colors.cyan);

    const burnTx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        tokenStats,
        datAuthority,
        asdfMint: rootToken.mint,
        datAsdfAccount,
        tokenProgram,
      })
      .signers([adminKeypair])
      .rpc();

    result.burnTx = burnTx;

    const finalStats: any = await (program.account as any).tokenStats.fetch(tokenStats);
    result.tokensBurned = finalStats.totalBurned.toNumber();

    log('  🔥', `Burned: ${burnTx.slice(0, 16)}...`, colors.green);
    log('  ✅', `${rootToken.symbol} cycle complete!`, colors.bright);

    result.success = true;
    return result;

  } catch (error) {
    const errorMsg = (error as Error).message || String(error);
    result.error = errorMsg;
    log('  ❌', `Failed: ${errorMsg}`, colors.red);
    return result;
  }
}

// ============================================================================
// Step 6: Display Summary
// ============================================================================

function displayCycleSummary(
  normalized: { viable: TokenAllocation[]; skipped: TokenAllocation[]; ratio: number },
  results: { [key: string]: CycleResult },
  totalCollected: number
) {
  logSection('ECOSYSTEM CYCLE SUMMARY');

  // Overall stats
  console.log(colors.bright + '💰 Financial Summary:' + colors.reset);
  console.log(`   Total Collected: ${formatSOL(totalCollected)} SOL`);
  console.log(`   Distribution Ratio: ${normalized.ratio.toFixed(6)}`);
  console.log(`   Min Allocation (Secondary): ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL`);
  console.log('');

  // Scalability stats
  const totalSecondaries = normalized.viable.length + normalized.skipped.length;
  console.log(colors.bright + '📈 Scalability Report:' + colors.reset);
  console.log(`   Total Secondary Tokens: ${totalSecondaries}`);
  console.log(`   ${colors.green}Viable (processed): ${normalized.viable.length}${colors.reset}`);
  console.log(`   ${colors.yellow}Deferred (accumulating): ${normalized.skipped.length}${colors.reset}`);
  console.log('');

  // Cycle results table
  console.log(colors.bright + '🔄 Cycle Results:' + colors.reset);
  console.log('─'.repeat(110));
  console.log(
    `${'Token'.padEnd(12)} ${'Status'.padEnd(14)} ${'Allocated'.padEnd(15)} ` +
    `${'Buy Tx'.padEnd(18)} ${'Finalize Tx'.padEnd(18)} ${'Burn Tx'.padEnd(18)}`
  );
  console.log('─'.repeat(110));

  let successCount = 0;
  let failureCount = 0;
  let deferredCount = 0;

  for (const [symbol, result] of Object.entries(results)) {
    const isDeferred = result.error?.startsWith('DEFERRED:');
    let statusIcon: string;
    let statusText: string;
    let statusColor: string;

    if (isDeferred) {
      statusIcon = '⏭️';
      statusText = 'Deferred';
      statusColor = colors.yellow;
      deferredCount++;
    } else if (result.success) {
      statusIcon = '✅';
      statusText = 'Success';
      statusColor = colors.green;
      successCount++;
    } else {
      statusIcon = '❌';
      statusText = 'Failed';
      statusColor = colors.red;
      failureCount++;
    }

    const allocation = result.allocation ? formatSOL(result.allocation) : 'N/A';
    const buyTx = result.buyTx ? result.buyTx.slice(0, 16) + '...' : '-';
    const finalizeTx = result.finalizeTx ? result.finalizeTx.slice(0, 16) + '...' : '-';
    const burnTx = result.burnTx ? result.burnTx.slice(0, 16) + '...' : '-';

    console.log(
      statusColor +
      `${symbol.padEnd(12)} ${(statusIcon + ' ' + statusText).padEnd(14)} ` +
      `${allocation.padEnd(15)} ${buyTx.padEnd(18)} ${finalizeTx.padEnd(18)} ${burnTx.padEnd(18)}` +
      colors.reset
    );

    // Show error details for failures (not deferrals)
    if (!result.success && result.error && !isDeferred) {
      console.log(`     ${colors.red}Error: ${result.error}${colors.reset}`);
    }
  }

  console.log('─'.repeat(110));
  console.log('');

  // Summary stats
  console.log(colors.bright + '📊 Execution Summary:' + colors.reset);
  console.log(`   Total Tokens: ${Object.keys(results).length}`);
  console.log(`   ${colors.green}Successful: ${successCount}${colors.reset}`);
  console.log(`   ${colors.yellow}Deferred: ${deferredCount}${colors.reset}`);
  console.log(`   ${colors.red}Failed: ${failureCount}${colors.reset}`);
  console.log('');

  if (failureCount > 0) {
    console.log(colors.red + '❌ Some cycles failed. Review errors above.' + colors.reset);
  } else if (deferredCount > 0) {
    console.log(colors.yellow + '⏭️  Some tokens deferred due to insufficient allocation.' + colors.reset);
    console.log(colors.cyan + '   They will accumulate and process in next cycle.' + colors.reset);
  } else {
    console.log(colors.green + '✅ All cycles executed successfully!' + colors.reset);
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log(colors.bright + colors.magenta);
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    ECOSYSTEM CYCLE ORCHESTRATOR                             ║');
  console.log('║              Hierarchical Token Buyback & Burn System                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(colors.reset + '\n');

  // Setup connection and provider
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const walletPath = process.env.WALLET_PATH || 'devnet-wallet.json';
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet file not found: ${walletPath}`);
  }

  const adminKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );

  const provider = new AnchorProvider(
    connection,
    new Wallet(adminKeypair),
    { commitment: 'confirmed' }
  );

  // Load IDL
  const idlPath = path.join(__dirname, '../target/idl/asdf_dat.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const program = new Program(idl as any, provider);

  log('🔗', `Connected to: ${rpcUrl}`, colors.cyan);
  log('👤', `Admin: ${adminKeypair.publicKey.toBase58()}`, colors.cyan);
  log('📜', `Program: ${PROGRAM_ID.toBase58()}`, colors.cyan);
  console.log('');

  try {
    // Load all ecosystem tokens
    const tokens = await loadEcosystemTokens(connection);
    const rootToken = tokens.find(t => t.isRoot);
    const secondaryTokens = tokens.filter(t => !t.isRoot);

    if (!rootToken) {
      throw new Error('Root token not found');
    }

    // Execute the complete ecosystem cycle
    const startTime = Date.now();

    // Pre-flight: Wait for daemon synchronization (optional, 30s timeout)
    // This helps ensure all tokens have their pending_fees populated
    const syncResult = await waitForDaemonSync(program, tokens, 30000);
    if (!syncResult.synced && syncResult.tokensWithoutFees.length > 0) {
      log('ℹ️', `Proceeding with ${syncResult.tokensWithFees.length} synced tokens`, colors.cyan);
    }

    // Step 1: Query pending fees
    const allocations = await queryPendingFees(program, tokens);

    // Step 2: Collect all vault fees
    const totalCollected = await collectAllVaultFees(program, rootToken, adminKeypair);

    // Step 3: Calculate proportional distribution (for display and ratio only - actual allocation is dynamic)
    const { ratio } = normalizeAllocations(allocations, totalCollected);

    // Get secondary allocations for dynamic processing
    const secondaryAllocations = allocations.filter(a => !a.isRoot);

    if (secondaryAllocations.length === 0) {
      log('⚠️', 'No secondary tokens with pending fees. Skipping secondary cycles.', colors.yellow);
    }

    // Step 4: Execute secondary cycles with DYNAMIC allocation (balance-aware)
    const { results, viable: actualViable, deferred: actualDeferred } = await executeSecondaryTokensDynamic(
      program,
      connection,
      secondaryAllocations,
      adminKeypair
    );

    // Step 4b: Finalize deferred tokens (preserve their pending_fees for next cycle)
    await finalizeDeferredTokens(program, actualDeferred, adminKeypair);

    // Step 5: Execute root cycle
    const rootResult = await executeRootCycle(program, rootToken, adminKeypair);
    results[rootToken.symbol] = rootResult;

    // Step 6: Display summary
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    displayCycleSummary({ viable: actualViable, skipped: actualDeferred, ratio }, results, totalCollected);

    console.log(colors.bright + `⏱️  Total execution time: ${duration}s` + colors.reset);
    console.log('');

    // Exit with appropriate code
    const hasFailures = Object.values(results).some(r => !r.success);
    process.exit(hasFailures ? 1 : 0);

  } catch (error) {
    console.error(colors.red + '\n❌ Fatal error:' + colors.reset);
    console.error(colors.red + ((error as Error).message || String(error)) + colors.reset);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main as executeEcosystemCycle };
