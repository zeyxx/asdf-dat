/**
 * Test Utilities for ASDF-DAT Integration Tests
 *
 * Shared functions for devnet integration tests.
 * All tests run on real devnet with actual transactions.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  TransactionSignature,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import { AnchorProvider, Program, Wallet, Idl } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import BN from 'bn.js';
import { execSync, spawn, ChildProcess } from 'child_process';
import { TokenConfig, DATState, TokenStats, getTypedAccounts } from './types';
import { getNetworkConfig } from './network-config';

// Program constants
export const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
export const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMPSWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Test constants
export const MIN_FEES_TO_CLAIM = 10_000_000; // 0.01 SOL
export const MIN_ALLOCATION_SECONDARY = 5_690_000; // ~0.00569 SOL
export const MIN_FEES_FOR_SPLIT = 5_500_000; // ~0.0055 SOL
export const SECONDARY_KEEP_RATIO = 0.552; // 55.2%
export const ROOT_RATIO = 0.448; // 44.8%

/**
 * Test result tracking
 */
export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
  duration?: number;
}

/**
 * State snapshot for comparison
 */
export interface StateSnapshot {
  timestamp: number;
  datState: DATState;
  tokenStats: Map<string, TokenStats>;
  balances: Map<string, number>;
  rootTreasuryBalance: number;
  datAuthorityBalance: number;
}

/**
 * State comparison result
 */
export interface StateComparison {
  feesCollected: number;
  tokensBurned: Map<string, BN>;
  solSentToRoot: number;
  treasuryDelta: number;
  authorityDelta: number;
}

/**
 * Logger with timestamp
 */
export function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

/**
 * Log test result
 */
export function logTest(results: TestResult[], name: string, passed: boolean, details?: string): void {
  results.push({ name, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${status}: ${name}`);
  if (details) {
    console.log(`         ${details}`);
  }
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load IDL from target directory
 */
export function loadIdl(): Idl {
  const idlPath = path.join(__dirname, '../target/idl/asdf_dat.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8')) as Idl;
  if (idl.metadata) {
    (idl.metadata as any).address = PROGRAM_ID.toString();
  } else {
    (idl as any).metadata = { address: PROGRAM_ID.toString() };
  }
  return idl;
}

/**
 * Load token configuration from JSON file
 */
export function loadTokenConfig(filePath: string): TokenConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Token config not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Load all token configs from a directory
 */
export function loadAllTokenConfigs(directory: string): TokenConfig[] {
  const files = fs.readdirSync(directory).filter((f) => f.endsWith('.json'));
  return files.map((f) => loadTokenConfig(path.join(directory, f)));
}

/**
 * Get devnet test tokens configuration
 */
export function getDevnetTokens(): { root: TokenConfig; secondaries: TokenConfig[] } {
  const dir = path.join(__dirname, '../devnet-tokens');
  const configs = loadAllTokenConfigs(dir);
  const root = configs.find((c) => c.isRoot);
  const secondaries = configs.filter((c) => !c.isRoot);

  if (!root) {
    throw new Error('No root token found in devnet-tokens/');
  }

  return { root, secondaries };
}

/**
 * Setup Anchor provider and program
 */
export function setupProvider(network: 'devnet' | 'mainnet' = 'devnet'): {
  connection: Connection;
  provider: AnchorProvider;
  program: Program<Idl>;
  adminKeypair: Keypair;
} {
  const networkConfig = getNetworkConfig(['--network', network]);
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

  const walletData = JSON.parse(fs.readFileSync(networkConfig.wallet, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(walletData));

  const provider = new AnchorProvider(connection, new Wallet(adminKeypair), {
    commitment: 'confirmed',
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  return { connection, provider, program, adminKeypair };
}

/**
 * Derive DAT PDAs
 */
export function derivePDAs(rootMint?: PublicKey): {
  datState: PublicKey;
  datAuthority: PublicKey;
  rootTreasury?: PublicKey;
} {
  const [datState] = PublicKey.findProgramAddressSync([Buffer.from('dat_v3')], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([Buffer.from('auth_v3')], PROGRAM_ID);

  let rootTreasury: PublicKey | undefined;
  if (rootMint) {
    [rootTreasury] = PublicKey.findProgramAddressSync(
      [Buffer.from('root_treasury'), rootMint.toBuffer()],
      PROGRAM_ID
    );
  }

  return { datState, datAuthority, rootTreasury };
}

/**
 * Derive token stats PDA
 */
export function deriveTokenStatsPDA(mint: PublicKey): PublicKey {
  const [tokenStats] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_stats_v1'), mint.toBuffer()],
    PROGRAM_ID
  );
  return tokenStats;
}

/**
 * Derive creator vault PDA (bonding curve)
 */
export function deriveCreatorVault(creator: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  );
  return vault;
}

/**
 * Derive creator vault PDA (AMM - underscore)
 */
export function deriveCreatorVaultAMM(creator: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), creator.toBuffer()],
    PUMPSWAP_PROGRAM
  );
  return vault;
}

/**
 * Capture current state snapshot
 */
export async function captureState(
  connection: Connection,
  program: Program<Idl>,
  tokens: TokenConfig[]
): Promise<StateSnapshot> {
  const pdas = derivePDAs();
  const accounts = getTypedAccounts(program);

  // Fetch DAT state
  const datState = await accounts.datState.fetch(pdas.datState);

  // Fetch token stats
  const tokenStats = new Map<string, TokenStats>();
  for (const token of tokens) {
    const mint = new PublicKey(token.mint);
    const pda = deriveTokenStatsPDA(mint);
    try {
      const stats = await accounts.tokenStats.fetch(pda);
      tokenStats.set(token.mint, stats);
    } catch {
      // Token stats may not exist yet
    }
  }

  // Get balances
  const balances = new Map<string, number>();
  for (const token of tokens) {
    const vault = deriveCreatorVault(new PublicKey(token.creator));
    const info = await connection.getAccountInfo(vault);
    balances.set(token.mint, info?.lamports || 0);
  }

  // Get authority balance
  const authorityInfo = await connection.getAccountInfo(pdas.datAuthority);
  const datAuthorityBalance = authorityInfo?.lamports || 0;

  // Get root treasury balance
  let rootTreasuryBalance = 0;
  if (datState.rootTokenMint) {
    const [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from('root_treasury'), datState.rootTokenMint.toBuffer()],
      PROGRAM_ID
    );
    const treasuryInfo = await connection.getAccountInfo(treasury);
    rootTreasuryBalance = treasuryInfo?.lamports || 0;
  }

  return {
    timestamp: Date.now(),
    datState,
    tokenStats,
    balances,
    rootTreasuryBalance,
    datAuthorityBalance,
  };
}

/**
 * Compare two state snapshots
 */
export function compareStates(before: StateSnapshot, after: StateSnapshot): StateComparison {
  const tokensBurned = new Map<string, BN>();

  // Calculate burned tokens per token
  for (const [mint, afterStats] of after.tokenStats) {
    const beforeStats = before.tokenStats.get(mint);
    if (beforeStats) {
      tokensBurned.set(mint, afterStats.totalBurned.sub(beforeStats.totalBurned));
    }
  }

  // Calculate SOL sent to root
  let solSentToRoot = 0;
  for (const [mint, afterStats] of after.tokenStats) {
    const beforeStats = before.tokenStats.get(mint);
    if (beforeStats && !afterStats.isRootToken) {
      solSentToRoot += afterStats.totalSolSentToRoot.sub(beforeStats.totalSolSentToRoot).toNumber();
    }
  }

  return {
    feesCollected: after.datState.totalSolCollected.sub(before.datState.totalSolCollected).toNumber(),
    tokensBurned,
    solSentToRoot,
    treasuryDelta: after.rootTreasuryBalance - before.rootTreasuryBalance,
    authorityDelta: after.datAuthorityBalance - before.datAuthorityBalance,
  };
}

/**
 * Generate trading volume on a token (buy + sell cycle)
 */
export async function generateVolume(
  tokenConfigPath: string,
  amount: number = 0.5,
  network: string = 'devnet'
): Promise<{ buyTx: string | null; sellTx: string | null }> {
  log(`Generating ${amount} SOL volume on ${tokenConfigPath}...`);

  let buyTx: string | null = null;
  let sellTx: string | null = null;

  // Buy
  try {
    const buyOutput = execSync(
      `npx ts-node scripts/generate-volume.ts ${tokenConfigPath} 1 ${amount} --network ${network} 2>&1`,
      { encoding: 'utf-8', timeout: 60000 }
    );
    const buyMatch = buyOutput.match(/TX: ([A-Za-z0-9]+)/);
    buyTx = buyMatch ? buyMatch[1] : 'completed';
    log(`  Buy: ${buyTx}`);
  } catch (e: any) {
    log(`  Buy failed: ${e.message?.slice(0, 100)}`);
  }

  await sleep(2000);

  // Sell
  const config = loadTokenConfig(tokenConfigPath);
  const sellScript =
    config.tokenProgram === 'Token2022' ? 'sell-mayhem-tokens.ts' : 'sell-spl-tokens-simple.ts';

  try {
    const sellOutput = execSync(
      `npx ts-node scripts/${sellScript} ${tokenConfigPath} --network ${network} 2>&1`,
      { encoding: 'utf-8', timeout: 60000 }
    );
    const sellMatch = sellOutput.match(/TX: ([A-Za-z0-9]+)/);
    sellTx = sellMatch ? sellMatch[1] : 'completed';
    log(`  Sell: ${sellTx}`);
  } catch (e: any) {
    log(`  Sell failed: ${e.message?.slice(0, 100)}`);
  }

  return { buyTx, sellTx };
}

/**
 * Wait for daemon to sync fees
 */
export async function waitForDaemonSync(seconds: number = 15): Promise<void> {
  log(`Waiting ${seconds}s for daemon sync...`);
  await sleep(seconds * 1000);
}

/**
 * Start fee monitor daemon in background
 */
export function startDaemon(network: string = 'devnet'): ChildProcess {
  log('Starting fee monitor daemon...');

  // Kill any existing daemon
  try {
    execSync('pkill -f "monitor-ecosystem-fees" 2>/dev/null || true');
  } catch {
    // Ignore
  }

  const daemon = spawn('npx', ['ts-node', 'scripts/monitor-ecosystem-fees.ts', '--network', network], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
  });

  return daemon;
}

/**
 * Stop all daemons
 */
export function stopDaemons(): void {
  log('Stopping all daemons...');
  try {
    execSync('pkill -f "monitor-ecosystem-fees" 2>/dev/null || true');
  } catch {
    // Ignore - no process found is OK
  }
}

/**
 * Assert fee split is correct
 */
export function assertFeeSplit(
  totalFees: number,
  actualKeep: number,
  actualToRoot: number,
  tolerance: number = 0.01
): { passed: boolean; details: string } {
  const expectedKeep = totalFees * SECONDARY_KEEP_RATIO;
  const expectedToRoot = totalFees * ROOT_RATIO;

  const keepDiff = Math.abs(actualKeep - expectedKeep) / totalFees;
  const rootDiff = Math.abs(actualToRoot - expectedToRoot) / totalFees;

  const passed = keepDiff <= tolerance && rootDiff <= tolerance;
  const details = `Keep: ${(actualKeep / LAMPORTS_PER_SOL).toFixed(6)} SOL (expected ${(expectedKeep / LAMPORTS_PER_SOL).toFixed(6)}), ` +
    `ToRoot: ${(actualToRoot / LAMPORTS_PER_SOL).toFixed(6)} SOL (expected ${(expectedToRoot / LAMPORTS_PER_SOL).toFixed(6)})`;

  return { passed, details };
}

/**
 * Print test summary
 */
export function printSummary(results: TestResult[]): number {
  console.log('\n' + '═'.repeat(70));
  console.log('📊 Test Summary');
  console.log('═'.repeat(70) + '\n');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  • ${r.name}: ${r.details || r.error || 'No details'}`);
      });
  }

  console.log('\n' + '═'.repeat(70));
  console.log(failed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
  console.log('═'.repeat(70) + '\n');

  return failed === 0 ? 0 : 1;
}

/**
 * Get token program ID from config
 */
export function getTokenProgramId(tokenProgram: string): PublicKey {
  return tokenProgram === 'Token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

/**
 * Format lamports as SOL string
 */
export function formatSol(lamports: number | BN): string {
  const value = typeof lamports === 'number' ? lamports : lamports.toNumber();
  return (value / LAMPORTS_PER_SOL).toFixed(6);
}

/**
 * Check if pending fees meet minimum threshold
 */
export function meetsMinimumFees(pendingFees: BN): boolean {
  return pendingFees.gte(new BN(MIN_ALLOCATION_SECONDARY));
}

/**
 * Execute ecosystem cycle via script
 */
export async function executeEcosystemCycle(
  rootTokenPath: string,
  network: string = 'devnet'
): Promise<{ success: boolean; output: string }> {
  log(`Executing ecosystem cycle with ${rootTokenPath}...`);

  try {
    const output = execSync(
      `npx ts-node scripts/execute-ecosystem-cycle.ts ${rootTokenPath} --network ${network} 2>&1`,
      { encoding: 'utf-8', timeout: 120000 }
    );
    return { success: true, output };
  } catch (e: any) {
    return { success: false, output: e.message || 'Unknown error' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// E2E TEST UTILITIES
// Additional helpers for production-grade E2E validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verification result for E2E tests
 */
export interface VerificationResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  details?: string;
}

/**
 * E2E State snapshot with comprehensive data
 */
export interface E2EStateSnapshot {
  network: 'devnet' | 'mainnet';
  capturedAt: string;
  tokens: Array<{
    mint: string;
    symbol: string;
    isRoot: boolean;
    pendingFeesLamports: number;
    totalBurned: number;
    totalSolCollected: number;
    totalSolSentToRoot: number;
    totalSolReceivedFromOthers: number;
    cyclesParticipated: number;
    creatorVaultBalance: number;
  }>;
  rootTreasuryBalance: number;
  rebatePool: {
    totalDeposited: number;
    totalDistributed: number;
    rebatesCount: number;
  } | null;
  datAuthorityBalance: number;
  walletBalance: number;
}

/**
 * Diff between two E2E states
 */
export interface E2EStateDiff {
  duration: string;
  tokens: Array<{
    symbol: string;
    mint: string;
    isRoot: boolean;
    pendingFeesDelta: number;
    totalBurnedDelta: number;
    totalSolCollectedDelta: number;
    totalSolSentToRootDelta: number;
    cyclesParticipatedDelta: number;
  }>;
  rootTreasuryDelta: number;
  rebatePoolDelta: {
    depositedDelta: number;
    distributedDelta: number;
    rebatesCountDelta: number;
  } | null;
  datAuthorityDelta: number;
  walletDelta: number;
}

/**
 * Derive Rebate Pool PDA
 */
export function deriveRebatePoolPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rebate_pool')],
    PROGRAM_ID
  );
}

/**
 * Derive Root Treasury PDA
 */
export function deriveRootTreasuryPDA(rootMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('root_treasury'), rootMint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Capture comprehensive E2E state
 */
export async function captureE2EState(
  connection: Connection,
  program: Program<Idl>,
  tokens: TokenConfig[],
  walletPubkey: PublicKey,
  network: 'devnet' | 'mainnet'
): Promise<E2EStateSnapshot> {
  const accounts = getTypedAccounts(program);
  const now = new Date().toISOString();

  // Find root token
  const rootToken = tokens.find((t) => t.isRoot);
  if (!rootToken) {
    throw new Error('No root token found in configs');
  }
  const rootMint = new PublicKey(rootToken.mint);

  // Derive common PDAs
  const pdas = derivePDAs(rootMint);
  const [rebatePoolPda] = deriveRebatePoolPDA();

  // Fetch common accounts in parallel
  const [datAuthorityInfo, rootTreasuryInfo, walletBalance] = await Promise.all([
    connection.getAccountInfo(pdas.datAuthority),
    pdas.rootTreasury ? connection.getAccountInfo(pdas.rootTreasury) : Promise.resolve(null),
    connection.getBalance(walletPubkey),
  ]);

  // Fetch rebate pool if exists
  let rebatePool: E2EStateSnapshot['rebatePool'] = null;
  try {
    const rebateData = await accounts.rebatePool.fetch(rebatePoolPda);
    rebatePool = {
      totalDeposited: new BN(rebateData.totalDeposited).toNumber(),
      totalDistributed: new BN(rebateData.totalDistributed).toNumber(),
      rebatesCount: new BN(rebateData.rebatesCount).toNumber(),
    };
  } catch {
    // Rebate pool not initialized yet
  }

  // Capture state for each token
  const tokenStates: E2EStateSnapshot['tokens'] = [];
  for (const token of tokens) {
    const mint = new PublicKey(token.mint);
    const creator = new PublicKey(token.creator);
    const tokenStatsPda = deriveTokenStatsPDA(mint);

    // Determine vault PDA based on pool type
    let creatorVault: PublicKey;
    if (token.poolType === 'pumpswap_amm') {
      creatorVault = deriveCreatorVaultAMM(creator);
    } else {
      creatorVault = deriveCreatorVault(creator);
    }

    // Fetch data
    const [statsData, vaultInfo] = await Promise.all([
      accounts.tokenStats.fetch(tokenStatsPda).catch(() => null),
      connection.getAccountInfo(creatorVault),
    ]);

    tokenStates.push({
      mint: token.mint,
      symbol: token.symbol,
      isRoot: token.isRoot || false,
      pendingFeesLamports: statsData ? new BN(statsData.pendingFeesLamports).toNumber() : 0,
      totalBurned: statsData ? new BN(statsData.totalBurned).toNumber() : 0,
      totalSolCollected: statsData ? new BN(statsData.totalSolCollected).toNumber() : 0,
      totalSolSentToRoot: statsData ? new BN(statsData.totalSolSentToRoot).toNumber() : 0,
      totalSolReceivedFromOthers: statsData
        ? new BN(statsData.totalSolReceivedFromOthers).toNumber()
        : 0,
      cyclesParticipated: statsData ? new BN(statsData.cyclesParticipated).toNumber() : 0,
      creatorVaultBalance: vaultInfo ? vaultInfo.lamports : 0,
    });
  }

  return {
    network,
    capturedAt: now,
    tokens: tokenStates,
    rootTreasuryBalance: rootTreasuryInfo ? rootTreasuryInfo.lamports : 0,
    rebatePool,
    datAuthorityBalance: datAuthorityInfo ? datAuthorityInfo.lamports : 0,
    walletBalance,
  };
}

/**
 * Compare two E2E states and return diff
 */
export function compareE2EStates(
  before: E2EStateSnapshot,
  after: E2EStateSnapshot
): E2EStateDiff {
  const startTime = new Date(before.capturedAt).getTime();
  const endTime = new Date(after.capturedAt).getTime();
  const durationMs = endTime - startTime;
  const durationStr = `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;

  const tokenDiffs = after.tokens.map((afterToken) => {
    const beforeToken = before.tokens.find((t) => t.mint === afterToken.mint);
    if (!beforeToken) {
      return {
        symbol: afterToken.symbol,
        mint: afterToken.mint,
        isRoot: afterToken.isRoot,
        pendingFeesDelta: afterToken.pendingFeesLamports,
        totalBurnedDelta: afterToken.totalBurned,
        totalSolCollectedDelta: afterToken.totalSolCollected,
        totalSolSentToRootDelta: afterToken.totalSolSentToRoot,
        cyclesParticipatedDelta: afterToken.cyclesParticipated,
      };
    }
    return {
      symbol: afterToken.symbol,
      mint: afterToken.mint,
      isRoot: afterToken.isRoot,
      pendingFeesDelta: afterToken.pendingFeesLamports - beforeToken.pendingFeesLamports,
      totalBurnedDelta: afterToken.totalBurned - beforeToken.totalBurned,
      totalSolCollectedDelta: afterToken.totalSolCollected - beforeToken.totalSolCollected,
      totalSolSentToRootDelta: afterToken.totalSolSentToRoot - beforeToken.totalSolSentToRoot,
      cyclesParticipatedDelta: afterToken.cyclesParticipated - beforeToken.cyclesParticipated,
    };
  });

  let rebatePoolDelta: E2EStateDiff['rebatePoolDelta'] = null;
  if (after.rebatePool && before.rebatePool) {
    rebatePoolDelta = {
      depositedDelta: after.rebatePool.totalDeposited - before.rebatePool.totalDeposited,
      distributedDelta: after.rebatePool.totalDistributed - before.rebatePool.totalDistributed,
      rebatesCountDelta: after.rebatePool.rebatesCount - before.rebatePool.rebatesCount,
    };
  } else if (after.rebatePool) {
    rebatePoolDelta = {
      depositedDelta: after.rebatePool.totalDeposited,
      distributedDelta: after.rebatePool.totalDistributed,
      rebatesCountDelta: after.rebatePool.rebatesCount,
    };
  }

  return {
    duration: durationStr,
    tokens: tokenDiffs,
    rootTreasuryDelta: after.rootTreasuryBalance - before.rootTreasuryBalance,
    rebatePoolDelta,
    datAuthorityDelta: after.datAuthorityBalance - before.datAuthorityBalance,
    walletDelta: after.walletBalance - before.walletBalance,
  };
}

/**
 * Run E2E verification checks
 */
export function runE2EVerifications(
  before: E2EStateSnapshot,
  after: E2EStateSnapshot,
  diff: E2EStateDiff
): VerificationResult[] {
  const results: VerificationResult[] = [];

  // 1. Burns occurred
  const totalBurnDelta = diff.tokens.reduce((sum, t) => sum + t.totalBurnedDelta, 0);
  results.push({
    name: 'Burns executed',
    passed: totalBurnDelta > 0,
    expected: '> 0 tokens burned',
    actual: `${totalBurnDelta.toLocaleString()} tokens burned`,
  });

  // 2. Pending fees processed
  const totalPendingBefore = before.tokens.reduce((sum, t) => sum + t.pendingFeesLamports, 0);
  const totalPendingAfter = after.tokens.reduce((sum, t) => sum + t.pendingFeesLamports, 0);
  const pendingReduced = totalPendingAfter < totalPendingBefore * 0.5;
  results.push({
    name: 'Pending fees processed',
    passed: pendingReduced || totalPendingAfter === 0,
    expected: 'Pending fees reduced by >50% or reset to 0',
    actual: `Before: ${formatSol(totalPendingBefore)} SOL, After: ${formatSol(totalPendingAfter)} SOL`,
  });

  // 3. Secondary tokens sent 44.8% to root
  for (const tokenDiff of diff.tokens.filter((t) => !t.isRoot)) {
    if (tokenDiff.totalSolCollectedDelta > 0) {
      const expectedToRoot = tokenDiff.totalSolCollectedDelta * ROOT_RATIO;
      const actualToRoot = tokenDiff.totalSolSentToRootDelta;
      const tolerance = 0.15; // 15% tolerance for fees/slippage
      const withinTolerance =
        actualToRoot >= expectedToRoot * (1 - tolerance) &&
        actualToRoot <= expectedToRoot * (1 + tolerance);

      results.push({
        name: `${tokenDiff.symbol}: 44.8% split to root`,
        passed: withinTolerance || tokenDiff.totalSolCollectedDelta === 0,
        expected: `~${formatSol(expectedToRoot)} SOL to root (44.8%)`,
        actual: `${formatSol(actualToRoot)} SOL to root`,
        details: `Collected: ${formatSol(tokenDiff.totalSolCollectedDelta)} SOL`,
      });
    }
  }

  // 4. Root token cycle completed
  const rootToken = diff.tokens.find((t) => t.isRoot);
  if (rootToken && rootToken.totalBurnedDelta > 0) {
    results.push({
      name: 'Root token cycle completed',
      passed: rootToken.cyclesParticipatedDelta > 0,
      expected: 'Root cycles incremented',
      actual: `+${rootToken.cyclesParticipatedDelta} cycles`,
    });
  }

  // 5. No negative deltas (sanity check)
  const hasNegativeBurns = diff.tokens.some((t) => t.totalBurnedDelta < 0);
  results.push({
    name: 'No data corruption',
    passed: !hasNegativeBurns,
    expected: 'No negative burn deltas',
    actual: hasNegativeBurns ? 'Negative burns detected!' : 'All deltas valid',
  });

  return results;
}

/**
 * Generate E2E markdown report
 */
export function generateE2EReport(
  before: E2EStateSnapshot,
  after: E2EStateSnapshot,
  diff: E2EStateDiff,
  verifications: VerificationResult[],
  txSignatures: Array<{ phase: string; token: string; signature: string }>,
  executionLogs: string[]
): string {
  const passedCount = verifications.filter((v) => v.passed).length;
  const totalCount = verifications.length;
  const allPassed = passedCount === totalCount;

  let md = `# E2E Cycle Validation Report

**Date:** ${after.capturedAt}
**Network:** ${after.network}
**Duration:** ${diff.duration}
**Status:** ${allPassed ? 'PASSED' : 'FAILED'} (${passedCount}/${totalCount} checks)

---

## Summary

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
`;

  // Token summaries
  for (const tokenDiff of diff.tokens) {
    const beforeToken = before.tokens.find((t) => t.mint === tokenDiff.mint)!;
    const afterToken = after.tokens.find((t) => t.mint === tokenDiff.mint)!;
    const burnDelta =
      tokenDiff.totalBurnedDelta > 0 ? `+${tokenDiff.totalBurnedDelta.toLocaleString()}` : '0';
    md += `| Total Burned (${tokenDiff.symbol}) | ${beforeToken.totalBurned.toLocaleString()} | ${afterToken.totalBurned.toLocaleString()} | ${burnDelta} |\n`;
  }

  // Root treasury
  md += `| Root Treasury | ${formatSol(before.rootTreasuryBalance)} SOL | ${formatSol(after.rootTreasuryBalance)} SOL | ${diff.rootTreasuryDelta >= 0 ? '+' : ''}${formatSol(diff.rootTreasuryDelta)} SOL |\n`;

  // Pending fees
  const totalPendingBefore = before.tokens.reduce((sum, t) => sum + t.pendingFeesLamports, 0);
  const totalPendingAfter = after.tokens.reduce((sum, t) => sum + t.pendingFeesLamports, 0);
  md += `| Pending Fees (Total) | ${formatSol(totalPendingBefore)} SOL | ${formatSol(totalPendingAfter)} SOL | ${formatSol(totalPendingAfter - totalPendingBefore)} SOL |\n`;

  md += `
---

## Verifications

`;

  for (const v of verifications) {
    const icon = v.passed ? '[x]' : '[ ]';
    md += `- ${icon} **${v.name}**\n`;
    md += `  - Expected: ${v.expected}\n`;
    md += `  - Actual: ${v.actual}\n`;
    if (v.details) {
      md += `  - Details: ${v.details}\n`;
    }
  }

  if (txSignatures.length > 0) {
    md += `
---

## Transactions

| Phase | Token | TX Signature | Explorer |
|-------|-------|--------------|----------|
`;

    for (const tx of txSignatures) {
      const shortSig = tx.signature.slice(0, 12) + '...';
      const explorerUrl = `https://solscan.io/tx/${tx.signature}?cluster=${after.network}`;
      md += `| ${tx.phase} | ${tx.token} | \`${shortSig}\` | [Solscan](${explorerUrl}) |\n`;
    }
  }

  md += `
---

## Token Details

`;

  for (const tokenDiff of diff.tokens) {
    const rootLabel = tokenDiff.isRoot ? '(ROOT)' : '(SECONDARY)';
    md += `### ${tokenDiff.symbol} ${rootLabel}

| Metric | Delta |
|--------|-------|
| Pending Fees | ${formatSol(tokenDiff.pendingFeesDelta)} SOL |
| Total Burned | +${tokenDiff.totalBurnedDelta.toLocaleString()} |
| SOL Collected | +${formatSol(tokenDiff.totalSolCollectedDelta)} SOL |
| Sent to Root | +${formatSol(tokenDiff.totalSolSentToRootDelta)} SOL |
| Cycles | +${tokenDiff.cyclesParticipatedDelta} |

`;
  }

  md += `---

*Generated by e2e-cycle-validation.ts*
*"Flush. Burn. Verify. This is fine."*
`;

  return md;
}

/**
 * Parse TX signatures from orchestrator output
 */
export function parseTxSignatures(
  output: string
): Array<{ phase: string; token: string; signature: string }> {
  const signatures: Array<{ phase: string; token: string; signature: string }> = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Match patterns like "TX: 5Sjt8XRb..." or "Signature: ABC123..."
    const txMatch = line.match(/(?:TX|Signature):\s*([A-Za-z0-9]{32,})/i);
    if (txMatch) {
      // Try to extract phase and token from context
      let phase = 'Cycle';
      let token = 'Unknown';

      if (line.toLowerCase().includes('buy')) phase = 'Buy';
      else if (line.toLowerCase().includes('burn')) phase = 'Burn';
      else if (line.toLowerCase().includes('collect')) phase = 'Collect';
      else if (line.toLowerCase().includes('volume')) phase = 'Volume';
      else if (line.toLowerCase().includes('rebate')) phase = 'Rebate';

      // Try to find token symbol in nearby context
      const symbolMatch = line.match(/\b([A-Z]{2,10})\b/);
      if (symbolMatch) {
        token = symbolMatch[1];
      }

      signatures.push({
        phase,
        token,
        signature: txMatch[1],
      });
    }
  }

  return signatures;
}
