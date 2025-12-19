/**
 * Flush Orchestrator V2 - Modular Architecture
 *
 * Uses refactored modules from src/cycle/ for clean separation of concerns:
 * - TokenLoader: Token discovery (priority cascade)
 * - TokenSelector: Probabilistic O(1) selection
 * - FeeAllocator: Proportional distribution
 * - DeadLetterQueue: Exponential backoff retry
 * - CycleValidator: Pre-flight checks
 * - DryRunReporter: Simulation mode
 *
 * This script ORCHESTRATES the cycle using modules and handles TRANSACTION EXECUTION.
 *
 * Usage:
 *   npx ts-node scripts/execute-ecosystem-cycle-v2.ts --network devnet
 *   npx ts-node scripts/execute-ecosystem-cycle-v2.ts --network devnet --dry-run
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, ComputeBudgetProgram, TransactionInstruction } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import * as fs from 'fs';

// Network & Config
import { getNetworkConfig, parseNetworkArg, printNetworkBanner, isMainnet } from '../src/network/config';
import { validateEnv } from '../src/utils/validate-env';
import { RpcManager } from '../src/managers/rpc-manager';

// Cycle Modules (Refactored Architecture)
import {
  TokenLoader,
  TokenSelector,
  FeeAllocator,
  DeadLetterQueue,
  CycleValidator,
  DryRunReporter,
  log,
  logSection,
  colors,
  formatSOL,
  formatNumber,
  loadAndValidateWallet,
  TokenAllocation,
} from '../src/cycle';

import type { TokenConfig } from '../src/cycle/types';

// Core types & utilities
import { DATState, TokenStats, getTypedAccounts } from '../src/core/types';
import { withRetryAndTimeout, confirmTransactionWithRetry, getRecommendedPriorityFee } from '../src/network/rpc-utils';
import { ExecutionLock, LockError } from '../src/utils/execution-lock';
import { getCycleLogger } from '../src/observability/logger';
import { withNewTrace, withSpan, getCurrentTraceId, addMetadata } from '../src/observability/tracing';
import { monitoring, OperationType } from '../src/observability/monitoring';
import { getAlerting, initAlerting } from '../src/observability/alerting';
import { validateAlertingEnv } from '../src/utils/env-validator';

// Pump.fun Integration
import {
  getBcCreatorVault,
  getAmmCreatorVaultAta,
  deriveAmmCreatorVaultAuthority,
} from '../src/pump/amm-utils';

// User rebate system
import {
  deriveRebatePoolPda,
  deriveUserStatsPda,
  getEligibleUsers,
  selectUserForRebate,
  calculateRebateAmount,
} from '../src/core/user-pool';

// ============================================================================
// Constants
// ============================================================================

const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const DAT_STATE_SEED = Buffer.from('dat_v3');
const DAT_AUTHORITY_SEED = Buffer.from('auth_v3');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');
const ROOT_TREASURY_SEED = Buffer.from('root_treasury');
const USER_STATS_SEED = Buffer.from('user_stats_v1');
const REBATE_POOL_SEED = Buffer.from('rebate_pool');

// Pump.fun / PumpSwap
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_SWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const PUMP_GLOBAL_CONFIG = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const PUMPSWAP_PROTOCOL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');
const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const GLOBAL_VOLUME_ACCUMULATOR = new PublicKey('Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PUMPSWAP_GLOBAL_CONFIG = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMPSWAP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');

// Dev sustainability wallet - receives 1% of secondary burns (99% burned)
const DEV_WALLET = new PublicKey('dcW5uy7wKdKFxkhyBfPv3MyvrCkDcv1rWucoat13KH4');

// Fee split ratio: Secondary tokens send 44.8% to root, keeping 55.2%
const SECONDARY_KEEP_RATIO = 0.552;

// Thresholds & Safety Margins
const RENT_EXEMPT_MINIMUM = 890_880; // ~0.00089 SOL
const SAFETY_BUFFER = 50_000; // ~0.00005 SOL
const OPERATIONAL_BUFFER = 190_000_000; // 0.19 SOL
const TX_FEE_RESERVE_PER_TOKEN = 100_000_000; // 0.1 SOL

// ============================================================================
// Types
// ============================================================================

// TokenConfig imported from ../src/cycle

interface CycleResult {
  token: string;
  success: boolean;
  pendingFees: number;
  allocation: number;
  tokensBurned?: number;
  error?: string;
  signature?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Print dry-run summary to console
 */
function printDryRunSummary(report: any): void {
  console.log('');
  console.log(colors.bright + '  DRY-RUN REPORT' + colors.reset);
  console.log('  ' + '═'.repeat(70));
  console.log(`  Status: ${report.status}`);
  console.log(`  Network: ${report.network}`);
  console.log(`  Total Pending: ${report.ecosystem.totalPendingFeesSOL} SOL`);
  console.log(`  Eligible Tokens: ${report.ecosystem.tokensEligible} / ${report.ecosystem.tokensTotal}`);
  console.log('  ' + '═'.repeat(70));
  console.log('');
}

// ============================================================================
// Transaction Execution Functions
// ============================================================================

/**
 * Query pending fees from on-chain TokenStats
 */
async function queryPendingFees(
  program: Program,
  tokens: TokenConfig[]
): Promise<TokenAllocation[]> {
  const allocations: TokenAllocation[] = [];

  for (const token of tokens) {
    try {
      const [tokenStatsPda] = PublicKey.findProgramAddressSync(
        [TOKEN_STATS_SEED, token.mint.toBuffer()],
        program.programId
      );

      const tokenStats = await (program.account as any).tokenStats.fetch(tokenStatsPda);
      const pendingFees = (tokenStats as any).pendingFeesLamports?.toNumber() || 0;

      allocations.push({
        token,
        pendingFees,
        allocation: 0, // Will be calculated by FeeAllocator
        isRoot: token.isRoot,
      });
    } catch (error) {
      log('⚠️', `Failed to query ${token.symbol}: ${(error as Error).message}`, colors.yellow);
      allocations.push({
        token,
        pendingFees: 0,
        allocation: 0,
        isRoot: token.isRoot,
      });
    }
  }

  return allocations;
}

/**
 * Execute cycle for selected token
 *
 * This is the TRANSACTION EXECUTION logic that was NOT extracted to modules.
 * It builds and signs Solana transactions for:
 * - Collecting fees from creator vault
 * - Buying tokens via Pump.fun/PumpSwap
 * - Burning tokens
 */
async function executeTokenCycle(
  program: Program,
  connection: Connection,
  adminKeypair: Keypair,
  allocation: TokenAllocation,
  datAuthority: PublicKey,
  datAuthorityBump: number
): Promise<CycleResult> {
  const { token, allocation: solAllocation } = allocation;

  const result: CycleResult = {
    token: token.symbol,
    success: false,
    pendingFees: allocation.pendingFees,
    allocation: solAllocation,
  };

  // Validate allocation before proceeding
  if (!solAllocation || solAllocation <= 0) {
    log('⚠️', `${token.symbol}: Invalid allocation (${solAllocation || 0}) - skipping`, colors.yellow);
    return result;
  }

  try {
    log('🔄', `Processing ${token.symbol} (BATCH TX)...`, colors.cyan);

    // Derive all required PDAs
    const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, token.mint.toBuffer()],
      program.programId
    );

    // Get state to determine root token
    const state = await getTypedAccounts(program).datState.fetch(datState);
    const rootMint = state.rootTokenMint;

    if (!rootMint) {
      throw new Error('Root token not configured in DAT state');
    }

    // Derive creator vault
    const creator = token.creator;
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), creator.toBuffer()],
      PUMP_PROGRAM
    );

    const tokenProgram = token.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    // Derive ATA for DAT authority
    const [datAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        datAuthority.toBuffer(),
        tokenProgram.toBuffer(),
        token.mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM
    );

    // Derive pool accounts
    const [poolAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        token.bondingCurve.toBuffer(),
        tokenProgram.toBuffer(),
        token.mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM
    );

    // Protocol fee recipient (different for Mayhem / Token2022 / SPL)
    const MAYHEM_FEE_RECIPIENT = new PublicKey('GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS');
    const TOKEN2022_FEE_RECIPIENT = new PublicKey('68yFSZxzLWJXkxxRGydZ63C6mHx1NLEDWmwN9Lb5yySg');
    const SPL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');

    const protocolFeeRecipient = token.mayhemMode
      ? MAYHEM_FEE_RECIPIENT
      : token.isToken2022
        ? TOKEN2022_FEE_RECIPIENT
        : SPL_FEE_RECIPIENT;

    // Derive root treasury PDA (required for secondary tokens)
    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [ROOT_TREASURY_SEED, rootMint.toBuffer()],
      program.programId
    );

    // Build instructions array for batch transaction
    const instructions: TransactionInstruction[] = [];

    // Get dynamic priority fee for better inclusion during congestion
    const priorityFee = await getRecommendedPriorityFee(connection);
    log('  💰', `Priority fee: ${priorityFee.toLocaleString()} microlamports`, colors.cyan);

    // Add compute budget for complex batch transaction (collect + buy + finalize + burn)
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
    );

    // Derive pump event authority for collect_fees
    const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      PUMP_PROGRAM
    );

    // Route based on pool type
    if (token.poolType === 'pumpswap_amm') {
      // ═══════════════════════════════════════════════════════════════════════
      // PumpSwap AMM: Collect + Unwrap + Wrap + Buy (optimized N+1 pattern)
      // ═══════════════════════════════════════════════════════════════════════
      log('  📦', `Building AMM batch (collect + unwrap + wrap + buy)...`, colors.cyan);

      // Derive AMM-specific PDAs
      const pool = token.bondingCurve; // For AMM, this is the pool address

      // DAT's WSOL account
      const [datWsolAccount] = PublicKey.findProgramAddressSync(
        [datAuthority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      // AMM creator vault accounts (for collect_fees_amm)
      const [creatorVaultAuthority] = deriveAmmCreatorVaultAuthority(creator);
      const creatorVaultAta = getAmmCreatorVaultAta(creator);

      // Pool's token accounts (base = token, quote = WSOL)
      const [poolBaseTokenAccount] = PublicKey.findProgramAddressSync(
        [pool.toBuffer(), tokenProgram.toBuffer(), token.mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      const [poolQuoteTokenAccount] = PublicKey.findProgramAddressSync(
        [pool.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      // Protocol fee recipient ATA (for WSOL)
      const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
        [PUMPSWAP_PROTOCOL_FEE_RECIPIENT.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      // Coin creator vault accounts (for buy)
      const [coinCreatorVaultAuthority] = deriveAmmCreatorVaultAuthority(creator);
      const coinCreatorVaultAta = getAmmCreatorVaultAta(creator);

      // Volume accumulator PDAs - required by PumpSwap AMM buy instruction
      const [userVolumeAccumulatorAmm] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
        PUMP_SWAP_PROGRAM
      );

      const [feeConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_config'), PUMP_SWAP_PROGRAM.toBuffer()],
        FEE_PROGRAM
      );

      // Step 1: Collect fees from AMM creator vault (WSOL → datWsolAccount)
      log('  📦', `Building collect_fees_amm instruction...`, colors.cyan);
      const collectAmmIx = await program.methods
        .collectFeesAmm()
        .accounts({
          datState,
          tokenStats,
          tokenMint: token.mint,
          datAuthority,
          datWsolAccount,
          creatorVaultAuthority,
          creatorVaultAta,
          wsolMint: WSOL_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          pumpSwapProgram: PUMP_SWAP_PROGRAM,
        })
        .instruction();

      instructions.push(collectAmmIx);

      // Step 2: Unwrap WSOL → SOL
      log('  📦', `Building unwrap_wsol instruction...`, colors.cyan);
      const unwrapIx = await program.methods
        .unwrapWsol()
        .accounts({
          datState,
          datAuthority,
          datWsolAccount,
          wsolMint: WSOL_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      instructions.push(unwrapIx);

      // Step 3: Wrap SOL → WSOL for AMM buy
      log('  📦', `Building wrap_wsol instruction (${formatSOL(solAllocation)} SOL)...`, colors.cyan);
      const wrapIx = await program.methods
        .wrapWsol(new BN(solAllocation))
        .accounts({
          datState,
          datAuthority,
          datWsolAccount,
          wsolMint: WSOL_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(wrapIx);

      // Step 4: Buy tokens with AMM
      const desiredTokens = new BN(1_000_000); // 1M tokens minimum
      const maxSolCost = new BN(solAllocation);

      const buyIx = await program.methods
        .executeBuyAmm(desiredTokens, maxSolCost)
        .accounts({
          datState,
          datAuthority,
          datTokenAccount: datAsdfAccount,
          pool,
          globalConfig: PUMPSWAP_GLOBAL_CONFIG,
          baseMint: token.mint,
          quoteMint: WSOL_MINT,
          datWsolAccount,
          poolBaseTokenAccount,
          poolQuoteTokenAccount,
          protocolFeeRecipient: PUMPSWAP_PROTOCOL_FEE_RECIPIENT,
          protocolFeeRecipientAta,
          baseTokenProgram: tokenProgram,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
          eventAuthority: PUMPSWAP_EVENT_AUTHORITY,
          pumpSwapProgram: PUMP_SWAP_PROGRAM,
          coinCreatorVaultAta,
          coinCreatorVaultAuthority,
          globalVolumeAccumulator: GLOBAL_VOLUME_ACCUMULATOR,
          userVolumeAccumulator: userVolumeAccumulatorAmm,
          feeConfig,
          feeProgram: FEE_PROGRAM,
        })
        .instruction();

      instructions.push(buyIx);

    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // Bonding Curve: Collect + Buy (optimized N+1 pattern)
      // ═══════════════════════════════════════════════════════════════════════

      // Step 1: Collect fees from creator vault → datAuthority
      log('  📦', `Building collect_fees instruction...`, colors.cyan);
      const collectIx = await program.methods
        .collectFees(false, true) // is_root_token=false, for_ecosystem=true
        .accounts({
          datState,
          tokenStats,
          tokenMint: token.mint,
          datAuthority,
          creatorVault,
          pumpEventAuthority,
          pumpSwapProgram: PUMP_PROGRAM,
          rootTreasury,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(collectIx);

      // Step 2: Buy tokens with proportional allocation
      log('  📦', `Building bonding curve buy instruction (${formatSOL(solAllocation)} SOL)...`, colors.cyan);

      // Volume accumulator PDAs - required by Pump.fun buy instruction
      const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
        PUMP_PROGRAM
      );

      const [feeConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()],
        FEE_PROGRAM
      );

      const buyIx = await program.methods
        .executeBuySecondary(new BN(solAllocation))
        .accounts({
          datState,
          datAuthority,
          datAsdfAccount,
          pool: token.bondingCurve,
          asdfMint: token.mint,
          poolAsdfAccount,
          pumpGlobalConfig: PUMP_GLOBAL_CONFIG,
          protocolFeeRecipient,
          creatorVault,
          pumpEventAuthority: PUMP_EVENT_AUTHORITY,
          pumpSwapProgram: PUMP_PROGRAM,
          globalVolumeAccumulator: GLOBAL_VOLUME_ACCUMULATOR,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
          rootTreasury,
          tokenProgram,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(buyIx);
    }

    // Finalize instruction
    log('  📦', 'Building finalize instruction...', colors.cyan);
    const finalizeIx = await program.methods
      .finalizeAllocatedCycle(true) // Token participated - reset pending_fees
      .accounts({
        datState,
        tokenStats,
        admin: adminKeypair.publicKey,
      })
      .instruction();

    instructions.push(finalizeIx);

    // Burn instruction
    log('  📦', 'Building burn instruction...', colors.cyan);
    const burnIx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        tokenStats,
        datAuthority,
        asdfMint: token.mint,
        datAsdfAccount,
        tokenProgram,
      })
      .instruction();

    instructions.push(burnIx);

    // Dev sustainability fee - 1% of secondary share (after split)
    log('  📦', 'Building dev fee instruction...', colors.cyan);
    const secondaryShareLamports = Math.floor(solAllocation * SECONDARY_KEEP_RATIO);
    const devFeeIx = await program.methods
      .transferDevFee(new BN(secondaryShareLamports))
      .accounts({
        datState,
        datAuthority,
        devWallet: DEV_WALLET,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    instructions.push(devFeeIx);

    // Create and send batch transaction
    log('  🚀', `Sending BATCH TX (${instructions.length} instructions)...`, colors.cyan);

    const tx = new Transaction();
    instructions.forEach(ix => tx.add(ix));

    // Get latest blockhash with retry (30s timeout for mainnet)
    const { blockhash, lastValidBlockHeight } = await withRetryAndTimeout(
      () => connection.getLatestBlockhash('confirmed'),
      { maxRetries: 3 },
      30000
    );
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = adminKeypair.publicKey;

    // Sign for simulation
    tx.sign(adminKeypair);

    // Simulate transaction BEFORE sending to detect instruction failures
    log('  🔍', 'Simulating transaction...', colors.cyan);
    const simulation = await withRetryAndTimeout(
      () => connection.simulateTransaction(tx),
      { maxRetries: 2, baseDelayMs: 500 },
      30000
    );

    if (simulation.value.err) {
      // Parse simulation error
      const errStr = JSON.stringify(simulation.value.err);
      const logs = simulation.value.logs || [];
      throw new Error(`Simulation failed: ${errStr}. Logs: ${logs.slice(-5).join(' | ')}`);
    }
    log('  ✅', 'Simulation passed, sending transaction...', colors.green);

    // Send with retry (45s timeout for mainnet) - skipPreflight since already simulated
    const signature = await withRetryAndTimeout(
      () => connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'confirmed',
      }),
      { maxRetries: 3, baseDelayMs: 1000 },
      45000
    );

    // Wait for confirmation with retry
    await confirmTransactionWithRetry(
      connection,
      signature,
      blockhash,
      lastValidBlockHeight,
      { maxRetries: 3 }
    );

    result.signature = signature;

    // Fetch final stats to get burned amount
    const finalStats = await getTypedAccounts(program).tokenStats.fetch(tokenStats);
    result.tokensBurned = finalStats.totalBurned.toNumber();

    log('  ✅', `BATCH TX confirmed: ${signature.slice(0, 20)}...`, colors.green);
    log('  ✅', `${token.symbol} cycle complete!`, colors.bright);

    result.success = true;
    return result;

  } catch (error) {
    const errorMsg = (error as Error).message || String(error);
    result.error = errorMsg;
    log('  ❌', `Failed: ${errorMsg}`, colors.red);
    return result;
  }
}

/**
 * Execute root token cycle (independent of secondaries)
 */
async function executeRootCycle(
  program: Program,
  connection: Connection,
  adminKeypair: Keypair,
  rootToken: TokenConfig,
  datAuthority: PublicKey,
  datAuthorityBump: number
): Promise<CycleResult> {
  logSection('ROOT CYCLE (INDEPENDENT)');

  const result: CycleResult = {
    token: rootToken.symbol,
    success: false,
    pendingFees: 0,
    allocation: 0,
  };

  try {
    const isAmm = rootToken.poolType === 'pumpswap_amm';
    log('🔄', `Processing ${rootToken.symbol} (ROOT - ${isAmm ? 'AMM' : 'BC'} BATCH TX)...`, colors.cyan);

    // Derive PDAs
    const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, rootToken.mint.toBuffer()],
      program.programId
    );

    // Use token creator if available, fallback to CREATOR env (all tokens share same vault)
    const creator = rootToken.creator ?? (process.env.CREATOR ? new PublicKey(process.env.CREATOR) : null);
    if (!creator) {
      throw new Error('Root token creator not found. Set CREATOR env variable.');
    }
    const creatorVault = getBcCreatorVault(creator);

    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [ROOT_TREASURY_SEED, rootToken.mint.toBuffer()],
      program.programId
    );

    // Dynamic token program selection for root (supports Token-2022/Mayhem as root)
    const tokenProgram = rootToken.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const poolAddress = rootToken.bondingCurve; // For AMM, this is the pool address

    const [datAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        datAuthority.toBuffer(),
        tokenProgram.toBuffer(),
        rootToken.mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM
    );

    const [poolAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        poolAddress.toBuffer(),
        tokenProgram.toBuffer(),
        rootToken.mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM
    );

    // Protocol fee recipient (different for Mayhem / Token2022 / SPL)
    const MAYHEM_FEE_RECIPIENT = new PublicKey('GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS');
    const TOKEN2022_FEE_RECIPIENT = new PublicKey('68yFSZxzLWJXkxxRGydZ63C6mHx1NLEDWmwN9Lb5yySg');
    const SPL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');
    const protocolFeeRecipient = rootToken.mayhemMode
      ? MAYHEM_FEE_RECIPIENT
      : rootToken.isToken2022
        ? TOKEN2022_FEE_RECIPIENT
        : SPL_FEE_RECIPIENT;

    // Select swap program based on pool type
    const swapProgram = isAmm ? PUMP_SWAP_PROGRAM : PUMP_PROGRAM;

    // Volume accumulator PDAs
    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
      swapProgram
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_config'), swapProgram.toBuffer()],
      FEE_PROGRAM
    );

    const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      PUMP_PROGRAM
    );

    // Build instructions array for batch transaction
    const instructions: TransactionInstruction[] = [];

    // Get dynamic priority fee
    const priorityFee = await getRecommendedPriorityFee(connection);
    log('  💰', `Priority fee: ${priorityFee.toLocaleString()} microlamports`, colors.cyan);

    // Add compute budget
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
    );

    if (isAmm) {
      // AMM: Wrap SOL → WSOL, then buy
      log('  📦', 'AMM: Building wrap_wsol + buy instructions...', colors.cyan);

      // Derive AMM-specific accounts
      const [datWsolAccount] = PublicKey.findProgramAddressSync(
        [datAuthority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      const [poolQuoteTokenAccount] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
        [PUMPSWAP_PROTOCOL_FEE_RECIPIENT.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      const [coinCreatorVaultAuthority] = deriveAmmCreatorVaultAuthority(rootToken.creator);
      const coinCreatorVaultAta = getAmmCreatorVaultAta(rootToken.creator);

      const [pumpSwapGlobalConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('global')],
        PUMP_SWAP_PROGRAM
      );

      // Get available SOL balance for wrap
      const datAuthorityBalance = await connection.getBalance(datAuthority);
      const availableForWrap = Math.max(0, datAuthorityBalance - RENT_EXEMPT_MINIMUM - SAFETY_BUFFER);

      if (availableForWrap > 0) {
        // Step 1: Wrap SOL → WSOL
        const wrapIx = await program.methods
          .wrapWsol(new BN(availableForWrap))
          .accounts({
            datState,
            datAuthority,
            datWsolAccount,
            wsolMint: WSOL_MINT,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction();

        instructions.push(wrapIx);
        log('  📦', `Wrap instruction added: ${formatSOL(availableForWrap)} SOL → WSOL`, colors.cyan);
      }

      // Step 2: Execute buy via AMM
      const desiredTokens = new BN(1_000_000);
      const maxSolCost = new BN(10_000_000_000); // 10 SOL max

      const buyIx = await program.methods
        .executeBuyAmm(desiredTokens, maxSolCost)
        .accounts({
          datState,
          datAuthority,
          datTokenAccount: datAsdfAccount,
          pool: poolAddress,
          globalConfig: pumpSwapGlobalConfig,
          baseMint: rootToken.mint,
          quoteMint: WSOL_MINT,
          datWsolAccount,
          poolBaseTokenAccount: poolAsdfAccount,
          poolQuoteTokenAccount,
          protocolFeeRecipient: PUMPSWAP_PROTOCOL_FEE_RECIPIENT,
          protocolFeeRecipientAta,
          baseTokenProgram: tokenProgram,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
          eventAuthority: PUMPSWAP_EVENT_AUTHORITY,
          pumpSwapProgram: PUMP_SWAP_PROGRAM,
          coinCreatorVaultAta,
          coinCreatorVaultAuthority,
          globalVolumeAccumulator: GLOBAL_VOLUME_ACCUMULATOR,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
        })
        .instruction();

      instructions.push(buyIx);

    } else {
      // Bonding Curve: Collect fees + execute buy
      log('  📦', 'Building collect fees instruction...', colors.cyan);
      const collectIx = await program.methods
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
        .instruction();

      instructions.push(collectIx);

      // Execute buy instruction
      log('  📦', 'Building buy instruction (100% buyback)...', colors.cyan);
      const buyIx = await program.methods
        .executeBuy(null) // No allocated_lamports = use full balance
        .accounts({
          datState,
          datAuthority,
          datAsdfAccount,
          pool: poolAddress,
          asdfMint: rootToken.mint,
          poolAsdfAccount,
          pumpGlobalConfig: PUMP_GLOBAL_CONFIG,
          protocolFeeRecipient,
          creatorVault,
          pumpEventAuthority: PUMP_EVENT_AUTHORITY,
          pumpSwapProgram: PUMP_PROGRAM,
          globalVolumeAccumulator: GLOBAL_VOLUME_ACCUMULATOR,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
          tokenProgram,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(buyIx);
    }

    // Finalize instruction
    log('  📦', 'Building finalize instruction...', colors.cyan);
    const finalizeIx = await program.methods
      .finalizeAllocatedCycle(true) // Token participated - reset pending_fees
      .accounts({
        datState,
        tokenStats,
        admin: adminKeypair.publicKey,
      })
      .instruction();
    instructions.push(finalizeIx);

    // Burn instruction
    log('  📦', 'Building burn instruction...', colors.cyan);
    const burnIx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        tokenStats,
        datAuthority,
        asdfMint: rootToken.mint,
        datAsdfAccount,
        tokenProgram,
      })
      .instruction();

    instructions.push(burnIx);

    // Create and send batch transaction
    log('  🚀', `Sending BATCH TX (${instructions.length} instructions)...`, colors.cyan);

    const tx = new Transaction();
    instructions.forEach(ix => tx.add(ix));

    // Get latest blockhash with retry
    const { blockhash, lastValidBlockHeight } = await withRetryAndTimeout(
      () => connection.getLatestBlockhash('confirmed'),
      { maxRetries: 3 },
      30000
    );
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = adminKeypair.publicKey;

    // Sign for simulation
    tx.sign(adminKeypair);

    // Simulate transaction BEFORE sending
    log('  🔍', 'Simulating transaction...', colors.cyan);
    const simulation = await withRetryAndTimeout(
      () => connection.simulateTransaction(tx),
      { maxRetries: 2, baseDelayMs: 500 },
      30000
    );

    if (simulation.value.err) {
      const errStr = JSON.stringify(simulation.value.err);
      const logs = simulation.value.logs || [];
      throw new Error(`Simulation failed: ${errStr}. Logs: ${logs.slice(-5).join(' | ')}`);
    }
    log('  ✅', 'Simulation passed, sending transaction...', colors.green);

    // Send with retry
    const signature = await withRetryAndTimeout(
      () => connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'confirmed',
      }),
      { maxRetries: 3, baseDelayMs: 1000 },
      45000
    );

    // Wait for confirmation
    await confirmTransactionWithRetry(
      connection,
      signature,
      blockhash,
      lastValidBlockHeight,
      { maxRetries: 3 }
    );

    result.signature = signature;

    const finalStats = await getTypedAccounts(program).tokenStats.fetch(tokenStats);
    result.tokensBurned = finalStats.totalBurned.toNumber();

    log('  ✅', `BATCH TX confirmed: ${signature.slice(0, 20)}...`, colors.green);
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

/**
 * Execute user rebate selection and distribution
 */
async function executeUserRebate(
  program: Program,
  connection: Connection,
  adminKeypair: Keypair
): Promise<void> {
  try {
    logSection('USER REBATE (PROBABILISTIC SELECTION)');

    // Get eligible users
    const eligibleUsers = await getEligibleUsers(program, PROGRAM_ID);

    if (eligibleUsers.length === 0) {
      log('ℹ️', 'No eligible users for rebate', colors.cyan);
      return;
    }

    // Probabilistic selection: currentSlot % eligible.length
    const currentSlot = await connection.getSlot();
    const selectedUser = selectUserForRebate(eligibleUsers, currentSlot);

    if (!selectedUser) {
      log('ℹ️', 'No user selected this cycle', colors.cyan);
      return;
    }

    log('🎯', `Selected user: ${selectedUser.pubkey.toBase58().slice(0, 8)}...`, colors.green);
    log('💰', `Pending: ${selectedUser.pendingContribution.toNumber() / 1e9} $ASDF`, colors.cyan);

    // Derive PDAs
    const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
    const [rebatePool] = deriveRebatePoolPda(program.programId);

    // Get ASDF mint from DAT state (not root token mint!)
    // On devnet: root=TROOT, but asdfMint=FROOT in DAT state
    const datStateAccount = await getTypedAccounts(program).datState.fetch(datState);
    const asdfMint = datStateAccount.asdfMint;
    const tokenProgram = TOKEN_PROGRAM_ID; // ASDF is always SPL Token

    // Get rebate pool ATA
    const rebatePoolAta = await getAssociatedTokenAddress(
      asdfMint,
      rebatePool,
      true // Allow owner off curve (PDA)
    );

    // Get user ATA
    const userAta = await getAssociatedTokenAddress(
      asdfMint,
      selectedUser.pubkey,
      false
    );

    // Calculate rebate amount (0.552% of pending)
    const rebateAmount = calculateRebateAmount(selectedUser.pendingContribution);
    log('🎁', `Rebate amount: ${rebateAmount.toNumber() / 1e9} $ASDF`, colors.cyan);

    // Build and execute rebate transaction
    log('📦', 'Building process_user_rebate transaction...', colors.cyan);

    const tx = await program.methods
      .processUserRebate()
      .accounts({
        datState,
        rebatePool,
        rebatePoolAta,
        userStats: selectedUser.statsPda,
        user: selectedUser.pubkey,
        userAta,
        admin: adminKeypair.publicKey,
        tokenProgram,
      })
      .signers([adminKeypair])
      .rpc();

    log('✅', `Rebate TX: ${tx.slice(0, 20)}...`, colors.green);
    log('✅', `User ${selectedUser.pubkey.toBase58().slice(0, 8)}... received ${rebateAmount.toNumber() / 1e9} $ASDF`, colors.green);

  } catch (error) {
    // Rebate processing is optional - don't fail the whole cycle
    log('⚠️', `User rebate failed (non-fatal): ${(error as Error).message}`, colors.yellow);
  }
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  console.log('');
  console.log(colors.bright + '═'.repeat(80) + colors.reset);
  console.log(colors.bright + '  🔥 ASDF BURN ENGINE V2 - Modular Architecture' + colors.reset);
  console.log(colors.bright + '═'.repeat(80) + colors.reset);
  console.log('');

  // Parse CLI args
  const networkArg = parseNetworkArg(process.argv);
  const dryRun = process.argv.includes('--dry-run');

  // Initialize network config
  const networkConfig = getNetworkConfig(process.argv);

  // Validate environment
  validateEnv(networkConfig.name === 'Mainnet' ? 'production' : 'development');
  let alertingConfig;
  if (!dryRun) {
    alertingConfig = validateAlertingEnv();
  }

  // Print network banner
  printNetworkBanner(networkConfig);
  const walletPath = `./${networkConfig.name.toLowerCase()}-wallet.json`;
  const adminKeypair = loadAndValidateWallet(walletPath);

  log('👤', `Admin: ${adminKeypair.publicKey.toBase58()}`, colors.cyan);
  log('🌐', `Network: ${networkConfig.name}`, colors.cyan);
  log('📡', `RPC: ${networkConfig.rpcUrls[0].slice(0, 50)}...`, colors.cyan);
  console.log('');

  // Create connection
  const connection = new Connection(networkConfig.rpcUrls[0], {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000,
  });

  // Initialize Anchor program
  const provider = new AnchorProvider(connection, new Wallet(adminKeypair), {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });

  const idl = JSON.parse(
    fs.readFileSync('./target/idl/asdf_burn_engine.json', 'utf-8')
  );
  const program = new Program(idl, provider);

  // Initialize RPC Manager
  const rpcManager = new RpcManager({ endpoints: networkConfig.rpcUrls });

  // Get DAT authority
  const [datAuthority, datAuthorityBump] = PublicKey.findProgramAddressSync(
    [DAT_AUTHORITY_SEED],
    PROGRAM_ID
  );

  // Initialize execution lock
  const executionLock = new ExecutionLock();
  if (!executionLock.acquire('ecosystem-cycle-v2')) {
    const status = executionLock.getStatus();
    log('⛔', `Cannot start: Another cycle is already running (PID: ${status.lockInfo?.pid})`, colors.red);
    log('ℹ️', `Started: ${new Date(status.lockInfo?.timestamp || 0).toISOString()}`, colors.cyan);
    process.exit(1);
  }
  log('🔒', 'Execution lock acquired', colors.green);

  // Initialize observability (if not dry-run)
  let alerting;
  if (!dryRun && alertingConfig) {
    alerting = initAlerting(alertingConfig as any);
  }

  try {
    // ========================================================================
    // ORCHESTRATION via Refactored Modules
    // ========================================================================

    // Initialize modules
    const tokenLoader = new TokenLoader(PROGRAM_ID);
    const tokenSelector = new TokenSelector();
    const feeAllocator = new FeeAllocator();
    const dlq = new DeadLetterQueue();
    const validator = new CycleValidator();
    const dryRunReporter = new DryRunReporter();

    // STEP 0: Validate operational buffer
    const adminBalance = await connection.getBalance(adminKeypair.publicKey);
    log('💰', `Admin balance: ${formatSOL(adminBalance)} SOL`, colors.cyan);

    if (adminBalance < OPERATIONAL_BUFFER) {
      throw new Error(`Insufficient balance: ${formatSOL(adminBalance)} < ${formatSOL(OPERATIONAL_BUFFER)} required`);
    }

    // STEP 1: Load tokens (priority cascade: API → State → JSON → On-chain)
    logSection('STEP 1: LOAD ECOSYSTEM TOKENS');
    const tokens = await tokenLoader.loadEcosystemTokens(connection, networkConfig);
    const rootToken = tokens.find((t) => t.isRoot);

    if (!rootToken) {
      throw new Error('Root token not found');
    }

    log('✅', `Loaded ${tokens.length} tokens (${tokens.filter(t => !t.isRoot).length} secondaries + root)`, colors.green);
    console.log('');

    // STEP 2: Process Dead-Letter Queue (auto-retry failed tokens)
    logSection('STEP 2: DEAD-LETTER QUEUE');
    const dlqStatus = dlq.process();

    if (dlqStatus.retryable.length > 0) {
      log('🔄', `${dlqStatus.retryable.length} tokens ready for retry`, colors.yellow);
    }
    if (dlqStatus.expired.length > 0) {
      log('⏰', `${dlqStatus.expired.length} tokens expired (manual review needed)`, colors.red);
    }
    if (dlqStatus.retryable.length === 0 && dlqStatus.expired.length === 0) {
      log('✅', 'DLQ empty', colors.green);
    }
    console.log('');

    // STEP 3: Pre-flight validation (daemon flush + sync)
    logSection('STEP 3: PRE-FLIGHT VALIDATION');

    const flushResult = await validator.triggerDaemonFlush();
    if (flushResult && flushResult.tokensFailed > 0) {
      log('⚠️', `Daemon flush: ${flushResult.tokensFailed} tokens failed`, colors.yellow);
    }

    const syncResult = await validator.waitForDaemonSync(program, tokens, 30000);
    if (syncResult.synced) {
      log('✅', 'All tokens synced with daemon', colors.green);
    } else {
      log('ℹ️', `Proceeding with ${syncResult.tokensWithFees.length}/${tokens.length} synced tokens`, colors.cyan);
    }
    console.log('');

    // STEP 4: Query pending fees from on-chain TokenStats
    logSection('STEP 4: QUERY PENDING FEES');
    const allocations = await queryPendingFees(program, tokens);

    const totalPending = allocations.reduce((sum, a) => sum + a.pendingFees, 0);
    log('📊', `Total pending fees: ${formatSOL(totalPending)} SOL`, colors.cyan);
    console.log('');

    // STEP 5: Dry-run mode (exit early if requested)
    if (dryRun) {
      logSection('DRY-RUN MODE');
      const report = dryRunReporter.generate(allocations, networkConfig.name, rootToken);
      printDryRunSummary(report);

      // Save report
      const reportDir = 'reports';
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }
      const reportFile = `${reportDir}/dry-run-${Date.now()}.json`;
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
      log('📄', `Report saved: ${reportFile}`, colors.green);

      executionLock.release();
      process.exit(0);
    }

    // STEP 6: Probabilistic token selection (O(1))
    logSection('STEP 6: PROBABILISTIC TOKEN SELECTION');

    const secondaryAllocations = allocations.filter(a => !a.isRoot);
    const eligibleTokens = tokenSelector.getEligibleTokens(secondaryAllocations);
    const currentSlot = await connection.getSlot();
    const selectedToken = tokenSelector.selectForCycle(eligibleTokens, currentSlot);

    log('📊', `Secondary tokens: ${secondaryAllocations.length}`, colors.cyan);
    log('✅', `Eligible tokens: ${eligibleTokens.length}`, colors.cyan);
    log('🎰', `Current slot: ${currentSlot}`, colors.cyan);

    if (selectedToken) {
      const selectedIndex = currentSlot % eligibleTokens.length;
      log('🎯', `SELECTED: ${selectedToken.token.symbol} (index ${selectedIndex})`, colors.green);
      log('  💰', `Pending fees: ${formatSOL(selectedToken.pendingFees)} SOL`, colors.cyan);
    } else {
      log('⚠️', 'No eligible tokens for this cycle', colors.yellow);
    }
    console.log('');

    // STEP 7: Execute selected token cycle (TX execution)
    const results: { [key: string]: CycleResult } = {};
    let tokensBurnedTotal = 0;

    if (selectedToken) {
      logSection('STEP 7: EXECUTE SELECTED TOKEN CYCLE');

      const result = await executeTokenCycle(
        program,
        connection,
        adminKeypair,
        selectedToken,
        datAuthority,
        datAuthorityBump
      );

      results[selectedToken.token.symbol] = result;
      tokensBurnedTotal += result.tokensBurned || 0;

      // Mark other eligible tokens as WAITING
      for (const token of eligibleTokens) {
        if (token.token.symbol !== selectedToken.token.symbol) {
          results[token.token.symbol] = {
            token: token.token.symbol,
            success: true,
            pendingFees: token.pendingFees,
            allocation: 0,
            error: 'WAITING: Will be selected in future cycle',
          };
        }
      }
    }

    // STEP 8: Execute root cycle (independent)
    const rootResult = await executeRootCycle(
      program,
      connection,
      adminKeypair,
      rootToken,
      datAuthority,
      datAuthorityBump
    );
    results[rootToken.symbol] = rootResult;
    tokensBurnedTotal += rootResult.tokensBurned || 0;

    // STEP 9: User rebate selection and distribution
    await executeUserRebate(program, connection, adminKeypair);

    // STEP 10: Summary
    logSection('CYCLE COMPLETE');

    const tokensProcessed = Object.values(results).filter(r => r.success && r.allocation > 0).length;
    const tokensDeferred = Object.values(results).filter(r => r.error?.startsWith('WAITING') || r.error?.startsWith('DEFERRED')).length;
    const tokensFailed = Object.values(results).filter(r => !r.success).length;

    log('📊', 'Cycle Summary:', colors.bright);
    log('  ✅', `Processed: ${tokensProcessed} tokens`, colors.green);
    log('  ⏳', `Deferred: ${tokensDeferred} tokens`, colors.yellow);
    log('  ❌', `Failed: ${tokensFailed} tokens`, colors.red);
    log('  🔥', `Total burned: ${formatNumber(tokensBurnedTotal)} tokens`, colors.green);
    console.log('');

    // Send alert (if configured)
    if (alerting) {
      const cycleSummary = {
        success: tokensFailed === 0,
        tokensProcessed,
        tokensDeferred,
        totalBurned: tokensBurnedTotal,
        totalFeesSOL: totalPending / LAMPORTS_PER_SOL,
        durationMs: Date.now(),
        network: networkConfig.name,
      };

      await alerting.sendCycleSuccess(cycleSummary).catch((err) => {
        log('⚠️', `Failed to send cycle success alert: ${err.message}`, colors.yellow);
      });
    }

    log('✅', 'Cycle complete', colors.green);
  } catch (error) {
    log('❌', `Cycle failed: ${(error as Error).message}`, colors.red);
    console.error(error);

    if (alerting) {
      const errorMessage = (error as Error).message || String(error);
      await alerting.sendCycleFailure(errorMessage, {
        network: networkConfig.name,
        stack: (error as Error).stack?.slice(0, 500),
      }).catch((alertErr) => {
        console.error(`Failed to send cycle failure alert: ${alertErr.message}`);
      });
    }

    process.exit(1);
  } finally {
    executionLock.release();
    log('🔓', 'Execution lock released', colors.green);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
