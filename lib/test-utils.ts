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
