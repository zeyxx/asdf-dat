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
const FEE_PROGRAM = new PublicKey('FeeMgVp374qBkTo7gFAhFWAYN1SAgEYbKvAH6r5vKFb');

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
// Step 3: Normalize Allocations
// ============================================================================

function normalizeAllocations(
  allocations: TokenAllocation[],
  actualCollected: number
): { secondaries: TokenAllocation[]; ratio: number } {
  logSection('STEP 3: CALCULATE PROPORTIONAL DISTRIBUTION');

  const secondaries = allocations.filter(a => !a.isRoot);
  const totalPending = secondaries.reduce((sum, a) => sum + a.pendingFees, 0);

  if (totalPending === 0) {
    log('⚠️', 'No pending fees to distribute', colors.yellow);
    return { secondaries: [], ratio: 0 };
  }

  const ratio = actualCollected / totalPending;

  log('📊', `Total pending: ${formatSOL(totalPending)} SOL`, colors.cyan);
  log('💰', `Actual collected: ${formatSOL(actualCollected)} SOL`, colors.cyan);
  log('📐', `Distribution ratio: ${ratio.toFixed(6)}`, ratio >= 0.95 ? colors.green : colors.yellow);

  if (ratio < 0.95) {
    log('⚠️', 'Collected amount is significantly less than pending fees', colors.yellow);
    log('ℹ️', 'This can happen if fees were spent or if pending_fees tracking is out of sync', colors.cyan);
  }

  // Calculate proportional allocation for each secondary token
  const normalized = secondaries.map(alloc => ({
    ...alloc,
    allocation: Math.floor(alloc.pendingFees * ratio),
  }));

  // Display allocation table
  console.log('\n' + colors.bright + 'Token Allocations:' + colors.reset);
  console.log('─'.repeat(80));
  console.log(`${'Token'.padEnd(12)} ${'Pending Fees'.padEnd(20)} ${'Allocated'.padEnd(20)} ${'Ratio'.padEnd(10)}`);
  console.log('─'.repeat(80));

  for (const alloc of normalized) {
    const tokenRatio = alloc.pendingFees > 0 ? (alloc.allocation / alloc.pendingFees) : 0;
    console.log(
      `${alloc.token.symbol.padEnd(12)} ${formatSOL(alloc.pendingFees).padEnd(20)} ` +
      `${formatSOL(alloc.allocation).padEnd(20)} ${tokenRatio.toFixed(4).padEnd(10)}`
    );
  }
  console.log('─'.repeat(80) + '\n');

  return { secondaries: normalized, ratio };
}

// ============================================================================
// Step 4: Execute Secondary Cycles with Allocation
// ============================================================================

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
    const creator = state.admin;
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

    // Protocol fee recipient
    const protocolFeeRecipient = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
    const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
      [
        protocolFeeRecipient.toBuffer(),
        tokenProgram.toBuffer(),
        allocation.token.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    // Fee program accounts
    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('volume_accumulator')],
      FEE_PROGRAM
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('volume_accumulator'), datAuthority.toBuffer()],
      FEE_PROGRAM
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_config')],
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
    log('  🔄', 'Finalizing cycle...', colors.cyan);

    const finalizeTx = await program.methods
      .finalizeAllocatedCycle()
      .accounts({
        tokenStats,
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

    const protocolFeeRecipient = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
    const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
      [
        protocolFeeRecipient.toBuffer(),
        tokenProgram.toBuffer(),
        rootToken.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('volume_accumulator')],
      FEE_PROGRAM
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('volume_accumulator'), datAuthority.toBuffer()],
      FEE_PROGRAM
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_config')],
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
  normalized: { secondaries: TokenAllocation[]; ratio: number },
  results: { [key: string]: CycleResult },
  totalCollected: number
) {
  logSection('ECOSYSTEM CYCLE SUMMARY');

  // Overall stats
  console.log(colors.bright + '💰 Financial Summary:' + colors.reset);
  console.log(`   Total Collected: ${formatSOL(totalCollected)} SOL`);
  console.log(`   Distribution Ratio: ${normalized.ratio.toFixed(6)}`);
  console.log('');

  // Cycle results table
  console.log(colors.bright + '🔄 Cycle Results:' + colors.reset);
  console.log('─'.repeat(100));
  console.log(
    `${'Token'.padEnd(12)} ${'Status'.padEnd(10)} ${'Allocated'.padEnd(15)} ` +
    `${'Buy Tx'.padEnd(18)} ${'Finalize Tx'.padEnd(18)} ${'Burn Tx'.padEnd(18)}`
  );
  console.log('─'.repeat(100));

  let successCount = 0;
  let failureCount = 0;

  for (const [symbol, result] of Object.entries(results)) {
    const statusIcon = result.success ? '✅' : '❌';
    const statusColor = result.success ? colors.green : colors.red;
    const allocation = result.allocation ? formatSOL(result.allocation) : 'N/A';
    const buyTx = result.buyTx ? result.buyTx.slice(0, 16) + '...' : '-';
    const finalizeTx = result.finalizeTx ? result.finalizeTx.slice(0, 16) + '...' : '-';
    const burnTx = result.burnTx ? result.burnTx.slice(0, 16) + '...' : '-';

    console.log(
      statusColor +
      `${symbol.padEnd(12)} ${(statusIcon + ' ' + (result.success ? 'Success' : 'Failed')).padEnd(18)} ` +
      `${allocation.padEnd(15)} ${buyTx.padEnd(18)} ${finalizeTx.padEnd(18)} ${burnTx.padEnd(18)}` +
      colors.reset
    );

    if (result.success) {
      successCount++;
    } else {
      failureCount++;
      if (result.error) {
        console.log(`     ${colors.red}Error: ${result.error}${colors.reset}`);
      }
    }
  }

  console.log('─'.repeat(100));
  console.log('');

  // Summary stats
  console.log(colors.bright + '📊 Execution Summary:' + colors.reset);
  console.log(`   Total Tokens: ${Object.keys(results).length}`);
  console.log(`   ${colors.green}Successful: ${successCount}${colors.reset}`);
  console.log(`   ${colors.red}Failed: ${failureCount}${colors.reset}`);
  console.log('');

  if (failureCount > 0) {
    console.log(colors.yellow + '⚠️  Some cycles failed. Review errors above.' + colors.reset);
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

    // Step 1: Query pending fees
    const allocations = await queryPendingFees(program, tokens);

    // Step 2: Collect all vault fees
    const totalCollected = await collectAllVaultFees(program, rootToken, adminKeypair);

    // Step 3: Calculate proportional distribution
    const { secondaries, ratio } = normalizeAllocations(allocations, totalCollected);

    if (secondaries.length === 0) {
      log('⚠️', 'No secondary tokens with pending fees. Skipping secondary cycles.', colors.yellow);
    }

    const results: { [key: string]: CycleResult } = {};

    // Step 4: Execute secondary cycles with allocation
    if (secondaries.length > 0) {
      logSection('STEP 4: EXECUTE SECONDARY TOKEN CYCLES');

      for (const allocation of secondaries) {
        const result = await executeSecondaryWithAllocation(program, allocation, adminKeypair);
        results[allocation.token.symbol] = result;
        console.log(''); // Spacing between tokens
      }
    }

    // Step 5: Execute root cycle
    const rootResult = await executeRootCycle(program, rootToken, adminKeypair);
    results[rootToken.symbol] = rootResult;

    // Step 6: Display summary
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    displayCycleSummary({ secondaries, ratio }, results, totalCollected);

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
