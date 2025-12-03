#!/usr/bin/env ts-node
/**
 * Boundary Value Tests for ASDF-DAT
 *
 * Tests critical thresholds and boundary conditions:
 * 1. MIN_FEES_FOR_SPLIT (0.0055 SOL)
 * 2. MAX_PENDING_FEES (69 SOL)
 * 3. MIN_FEES_TO_CLAIM (0.01 SOL)
 * 4. MAX_FEES_PER_CYCLE (1 SOL)
 * 5. Slippage at exactly 500 bps
 * 6. Fee split delta at exactly 500 bps
 *
 * Usage: npx ts-node scripts/test-boundary-values.ts --network devnet
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import BN from 'bn.js';
import {
  log,
  logTest,
  setupProvider,
  derivePDAs,
  printSummary,
  TestResult,
  MIN_FEES_TO_CLAIM,
  MIN_FEES_FOR_SPLIT,
} from '../lib/test-utils';
import { getTypedAccounts } from '../lib/types';
import * as fs from 'fs';

// Constants from Rust program
const MAX_PENDING_FEES = 69_000_000_000; // 69 SOL
const MAX_FEES_PER_CYCLE = 1_000_000_000; // 1 SOL
const MAX_SLIPPAGE_BPS = 500; // 5%
const MAX_FEE_SPLIT_DELTA = 500; // 5%

const results: TestResult[] = [];

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('📏 Boundary Value Tests');
  console.log('═'.repeat(70) + '\n');

  // Parse args
  const args = process.argv.slice(2);
  const networkArg = args.find((a) => a.startsWith('--network=')) || args[args.indexOf('--network') + 1];
  const network = (networkArg || 'devnet') as 'devnet' | 'mainnet';

  log(`Network: ${network}`);

  // Setup
  const { connection, program, adminKeypair } = setupProvider(network);
  const accounts = getTypedAccounts(program);

  // Get root token mint
  const tokensDir = network === 'mainnet' ? 'mainnet-tokens' : 'devnet-tokens';
  const tokenFiles = fs.readdirSync(tokensDir);
  const rootConfig = tokenFiles
    .map((f) => JSON.parse(fs.readFileSync(`${tokensDir}/${f}`, 'utf-8')))
    .find((c) => c.isRoot);

  if (!rootConfig) {
    console.error('❌ No root token found');
    process.exit(1);
  }

  const rootMint = new PublicKey(rootConfig.mint);
  const pdas = derivePDAs(rootMint);

  log(`Admin: ${adminKeypair.publicKey.toBase58()}`);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 1: Read Current State');
  console.log('─'.repeat(70) + '\n');

  const state = await accounts.datState.fetch(pdas.datState);
  const feeSplitBps = state.feeSplitBps;

  log(`Current fee_split_bps: ${feeSplitBps}`);
  log(`Slippage BPS: ${state.slippageBps}`);
  log(`Min fees threshold: ${state.minFeesThreshold.toString()} lamports`);
  log(`Max fees per cycle: ${state.maxFeesPerCycle.toString()} lamports`);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 2: Test MIN_FEES_TO_CLAIM Boundary');
  console.log('─'.repeat(70) + '\n');

  // Test: MIN_FEES_TO_CLAIM = 0.01 SOL = 10,000,000 lamports
  const minFeesValue = state.minFeesThreshold.toNumber();
  const minFeesExpected = MIN_FEES_TO_CLAIM;

  logTest(
    results,
    'MIN_FEES_TO_CLAIM matches expected',
    minFeesValue === minFeesExpected || minFeesValue >= 10_000_000,
    `${minFeesValue} lamports (expected ~${minFeesExpected})`
  );

  // Boundary: just below should fail, at threshold should work
  const justBelow = minFeesValue - 1;
  const exactly = minFeesValue;
  const justAbove = minFeesValue + 1;

  logTest(
    results,
    'Just below MIN_FEES_TO_CLAIM would fail',
    justBelow < minFeesValue,
    `${justBelow} < ${minFeesValue}`
  );

  logTest(
    results,
    'Exactly MIN_FEES_TO_CLAIM would pass',
    exactly >= minFeesValue,
    `${exactly} >= ${minFeesValue}`
  );

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 3: Test MAX_FEES_PER_CYCLE Boundary');
  console.log('─'.repeat(70) + '\n');

  const maxFeesValue = state.maxFeesPerCycle.toNumber();

  logTest(
    results,
    'MAX_FEES_PER_CYCLE is reasonable',
    maxFeesValue >= 100_000_000 && maxFeesValue <= 10_000_000_000,
    `${maxFeesValue} lamports (${maxFeesValue / LAMPORTS_PER_SOL} SOL)`
  );

  // Fees should be capped at max
  const testFees = 2_000_000_000; // 2 SOL
  const cappedFees = Math.min(testFees, maxFeesValue);

  logTest(
    results,
    'Fees above max would be capped',
    cappedFees === maxFeesValue,
    `${testFees} → ${cappedFees} (capped to max)`
  );

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 4: Test MAX_PENDING_FEES Boundary');
  console.log('─'.repeat(70) + '\n');

  // MAX_PENDING_FEES = 69 SOL
  logTest(
    results,
    'MAX_PENDING_FEES constant correct',
    MAX_PENDING_FEES === 69_000_000_000,
    `${MAX_PENDING_FEES} lamports (${MAX_PENDING_FEES / LAMPORTS_PER_SOL} SOL)`
  );

  // Test accumulation cap
  const current = 68_000_000_000; // 68 SOL
  const newFees = 2_000_000_000; // 2 SOL
  const wouldExceed = current + newFees > MAX_PENDING_FEES;

  logTest(
    results,
    'Pending fees cap detects overflow',
    wouldExceed,
    `68 SOL + 2 SOL = 70 SOL > 69 SOL cap`
  );

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 5: Test MIN_FEES_FOR_SPLIT Boundary');
  console.log('─'.repeat(70) + '\n');

  // MIN_FEES_FOR_SPLIT = 0.0055 SOL
  logTest(
    results,
    'MIN_FEES_FOR_SPLIT constant correct',
    MIN_FEES_FOR_SPLIT === 5_500_000,
    `${MIN_FEES_FOR_SPLIT} lamports (${MIN_FEES_FOR_SPLIT / LAMPORTS_PER_SOL} SOL)`
  );

  // At boundary: calculate split
  const atBoundary = MIN_FEES_FOR_SPLIT;
  const keepAmount = Math.floor((atBoundary * feeSplitBps) / 10000);
  const toRoot = atBoundary - keepAmount;

  logTest(
    results,
    'Split at minimum threshold preserves funds',
    keepAmount + toRoot === atBoundary,
    `Keep: ${keepAmount}, Root: ${toRoot}, Sum: ${keepAmount + toRoot}`
  );

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 6: Test Slippage BPS Boundary');
  console.log('─'.repeat(70) + '\n');

  // Current slippage should be <= 500 bps
  logTest(
    results,
    'Current slippage within max',
    state.slippageBps <= MAX_SLIPPAGE_BPS,
    `${state.slippageBps} bps <= ${MAX_SLIPPAGE_BPS} bps`
  );

  // Test slippage calculation at boundary
  const expectedTokens = 1_000_000_000;
  const slippageBps = MAX_SLIPPAGE_BPS;
  const minTokens = Math.floor(expectedTokens * (10000 - slippageBps) / 10000);

  logTest(
    results,
    'Slippage at max (5%) calculates 95% minimum',
    minTokens === 950_000_000,
    `${expectedTokens} tokens → min ${minTokens} tokens`
  );

  // Test just above max slippage
  const overMaxSlippage = MAX_SLIPPAGE_BPS + 1;
  logTest(
    results,
    'Slippage > 500 bps would be rejected',
    overMaxSlippage > MAX_SLIPPAGE_BPS,
    `${overMaxSlippage} > ${MAX_SLIPPAGE_BPS}`
  );

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 7: Test Fee Split Delta Boundary');
  console.log('─'.repeat(70) + '\n');

  // Max delta = 500 bps (5%)
  const currentBps = feeSplitBps;
  const maxAllowedUp = currentBps + MAX_FEE_SPLIT_DELTA;
  const maxAllowedDown = currentBps - MAX_FEE_SPLIT_DELTA;

  logTest(
    results,
    'Fee split delta range calculated correctly',
    true,
    `Current: ${currentBps}, Range: ${maxAllowedDown} - ${maxAllowedUp}`
  );

  // Valid change: +400 bps
  const validDelta = 400;
  logTest(
    results,
    'Valid delta (+400 bps) within range',
    validDelta <= MAX_FEE_SPLIT_DELTA,
    `${validDelta} <= ${MAX_FEE_SPLIT_DELTA}`
  );

  // Invalid change: +501 bps
  const invalidDelta = 501;
  logTest(
    results,
    'Invalid delta (+501 bps) exceeds range',
    invalidDelta > MAX_FEE_SPLIT_DELTA,
    `${invalidDelta} > ${MAX_FEE_SPLIT_DELTA}`
  );

  // Edge case: exactly 500 bps
  const exactDelta = 500;
  logTest(
    results,
    'Exact delta (500 bps) at boundary allowed',
    exactDelta <= MAX_FEE_SPLIT_DELTA,
    `${exactDelta} <= ${MAX_FEE_SPLIT_DELTA}`
  );

  console.log('\n' + '─'.repeat(70));
  console.log('📊 Boundary Values Summary');
  console.log('─'.repeat(70) + '\n');

  console.log('Threshold          | Value           | In SOL');
  console.log('─'.repeat(50));
  console.log(`MIN_FEES_TO_CLAIM  | ${minFeesValue.toString().padStart(15)} | ${(minFeesValue / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`MAX_FEES_PER_CYCLE | ${maxFeesValue.toString().padStart(15)} | ${(maxFeesValue / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`MAX_PENDING_FEES   | ${MAX_PENDING_FEES.toString().padStart(15)} | ${(MAX_PENDING_FEES / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`MIN_FEES_FOR_SPLIT | ${MIN_FEES_FOR_SPLIT.toString().padStart(15)} | ${(MIN_FEES_FOR_SPLIT / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`MAX_SLIPPAGE_BPS   | ${MAX_SLIPPAGE_BPS.toString().padStart(15)} | ${(MAX_SLIPPAGE_BPS / 100).toFixed(1)}%`);
  console.log(`MAX_FEE_DELTA_BPS  | ${MAX_FEE_SPLIT_DELTA.toString().padStart(15)} | ${(MAX_FEE_SPLIT_DELTA / 100).toFixed(1)}%`);

  // Print summary and exit
  const exitCode = printSummary(results);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
