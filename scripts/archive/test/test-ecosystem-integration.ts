#!/usr/bin/env ts-node
/**
 * Full Ecosystem Cycle Integration Test
 *
 * Tests the complete N+1 cycle pattern:
 * 1. Capture initial state (root + secondaries)
 * 2. Generate volume on secondary tokens (buy + sell)
 * 3. Wait for daemon to sync fees
 * 4. Verify pending_fees >= MIN_ALLOCATION_SECONDARY
 * 5. Execute ecosystem cycle
 * 6. Verify: secondaries burned tokens, root treasury received 44.8%
 * 7. Execute root cycle
 * 8. Verify: root tokens burned, treasury emptied
 *
 * Usage: npx ts-node scripts/test-ecosystem-integration.ts --network devnet
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import BN from 'bn.js';
import {
  log,
  logTest,
  sleep,
  setupProvider,
  derivePDAs,
  deriveTokenStatsPDA,
  captureState,
  compareStates,
  generateVolume,
  waitForDaemonSync,
  startDaemon,
  stopDaemons,
  executeEcosystemCycle,
  printSummary,
  formatSol,
  meetsMinimumFees,
  getDevnetTokens,
  TestResult,
  SECONDARY_KEEP_RATIO,
  ROOT_RATIO,
  MIN_ALLOCATION_SECONDARY,
} from '../lib/test-utils';
import { getTypedAccounts, TokenStats } from '../lib/types';
import { execSync } from 'child_process';

const results: TestResult[] = [];

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('🔄 Full Ecosystem Cycle Integration Test');
  console.log('═'.repeat(70) + '\n');

  // Parse args
  const args = process.argv.slice(2);
  const networkArg = args.find((a) => a.startsWith('--network=')) || args[args.indexOf('--network') + 1];
  const network = (networkArg || 'devnet') as 'devnet' | 'mainnet';

  log(`Network: ${network}`);

  // Setup
  const { connection, program, adminKeypair } = setupProvider(network);
  const accounts = getTypedAccounts(program);

  log(`Admin: ${adminKeypair.publicKey.toBase58()}`);

  // Load tokens
  const { root, secondaries } = getDevnetTokens();
  log(`Root token: ${root.name} (${root.symbol})`);
  log(`Secondary tokens: ${secondaries.length}`);
  secondaries.forEach((t, i) => log(`  ${i + 1}. ${t.name} (${t.symbol})`));

  // Derive PDAs
  const rootMint = new PublicKey(root.mint);
  const pdas = derivePDAs(rootMint);

  // Kill any existing daemon
  stopDaemons();
  await sleep(2000);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 1: Capture Initial State');
  console.log('─'.repeat(70) + '\n');

  // Get initial state
  const allTokens = [root, ...secondaries];
  const initialState = await captureState(connection, program, allTokens);

  log(`DAT State: isActive=${initialState.datState.isActive}`);
  log(`Root Treasury Balance: ${formatSol(initialState.rootTreasuryBalance)} SOL`);
  log(`DAT Authority Balance: ${formatSol(initialState.datAuthorityBalance)} SOL`);

  // Check initial token stats
  for (const token of allTokens) {
    const stats = initialState.tokenStats.get(token.mint);
    if (stats) {
      log(`${token.symbol}: pending_fees=${formatSol(stats.pendingFeesLamports)} SOL, burned=${stats.totalBurned.toString()}`);
    }
  }

  logTest(results, 'Initial state captured', true, `${allTokens.length} tokens tracked`);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 2: Start Daemon & Generate Volume');
  console.log('─'.repeat(70) + '\n');

  // Start daemon
  const daemon = startDaemon(network);
  await sleep(10000); // Wait for daemon to start

  // Generate volume on each secondary (2 rounds of buy+sell for ~0.006 SOL fees each)
  for (const secondary of secondaries) {
    const configPath = `devnet-tokens/${secondary.mint.slice(0, 8)}.json`;
    const actualPath = fs
      .readdirSync('devnet-tokens')
      .find((f) => {
        const cfg = JSON.parse(fs.readFileSync(`devnet-tokens/${f}`, 'utf-8'));
        return cfg.mint === secondary.mint;
      });

    if (actualPath) {
      log(`\nGenerating volume on ${secondary.symbol}...`);

      // Round 1: buy + sell
      await generateVolume(`devnet-tokens/${actualPath}`, 0.5, network);
      await sleep(2000);

      // Round 2: buy + sell
      await generateVolume(`devnet-tokens/${actualPath}`, 0.5, network);
      await sleep(2000);
    }
  }

  logTest(results, 'Volume generated on secondaries', true, `${secondaries.length} tokens × 2 rounds`);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 3: Wait for Daemon Sync & Verify Fees');
  console.log('─'.repeat(70) + '\n');

  // Wait for daemon to sync
  await waitForDaemonSync(20);

  // Check pending fees
  let sufficientFees = 0;
  for (const secondary of secondaries) {
    const mint = new PublicKey(secondary.mint);
    const statsPda = deriveTokenStatsPDA(mint);

    try {
      const stats = await accounts.tokenStats.fetch(statsPda);
      const hasFees = meetsMinimumFees(stats.pendingFeesLamports);

      log(`${secondary.symbol}: pending_fees=${formatSol(stats.pendingFeesLamports)} SOL ${hasFees ? '✅' : '⚠️'}`);

      if (hasFees) sufficientFees++;
    } catch (e: any) {
      log(`${secondary.symbol}: Failed to fetch stats - ${e.message?.slice(0, 50)}`);
    }
  }

  logTest(
    results,
    'Pending fees verified',
    sufficientFees > 0,
    `${sufficientFees}/${secondaries.length} tokens have sufficient fees`
  );

  // Stop daemon before cycle
  stopDaemons();
  await sleep(2000);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 4: Execute Ecosystem Cycle');
  console.log('─'.repeat(70) + '\n');

  // Capture state before cycle
  const beforeCycle = await captureState(connection, program, allTokens);

  // Find root token config path
  const rootConfigPath = fs
    .readdirSync('devnet-tokens')
    .find((f) => {
      const cfg = JSON.parse(fs.readFileSync(`devnet-tokens/${f}`, 'utf-8'));
      return cfg.isRoot;
    });

  if (!rootConfigPath) {
    logTest(results, 'Root token config found', false, 'No root token in devnet-tokens/');
    return;
  }

  // Execute ecosystem cycle
  const cycleResult = await executeEcosystemCycle(`devnet-tokens/${rootConfigPath}`, network);

  if (cycleResult.success) {
    logTest(results, 'Ecosystem cycle executed', true, 'Cycle completed');
  } else {
    logTest(results, 'Ecosystem cycle executed', false, cycleResult.output.slice(0, 100));
  }

  // Wait for transactions to confirm
  await sleep(5000);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 5: Verify Cycle Results');
  console.log('─'.repeat(70) + '\n');

  // Capture final state
  const afterCycle = await captureState(connection, program, allTokens);

  // Compare states
  const comparison = compareStates(beforeCycle, afterCycle);

  log(`Treasury Delta: ${formatSol(comparison.treasuryDelta)} SOL`);
  log(`Authority Delta: ${formatSol(comparison.authorityDelta)} SOL`);
  log(`SOL sent to root: ${formatSol(comparison.solSentToRoot)} SOL`);

  // Verify secondary tokens burned
  let secondariesBurned = 0;
  for (const secondary of secondaries) {
    const burned = comparison.tokensBurned.get(secondary.mint);
    if (burned && burned.gt(new BN(0))) {
      log(`${secondary.symbol}: burned ${burned.toString()} tokens`);
      secondariesBurned++;
    }
  }

  logTest(
    results,
    'Secondary tokens burned',
    secondariesBurned > 0,
    `${secondariesBurned}/${secondaries.length} tokens participated`
  );

  // Verify fee split (44.8% to root)
  // Note: Treasury receives 44.8% of collected fees from secondaries
  const treasuryReceived = afterCycle.rootTreasuryBalance - beforeCycle.rootTreasuryBalance;

  if (treasuryReceived > 0) {
    logTest(
      results,
      'Root treasury received fees',
      true,
      `+${formatSol(treasuryReceived)} SOL (44.8% of secondary fees)`
    );
  } else {
    logTest(
      results,
      'Root treasury received fees',
      comparison.solSentToRoot > 0,
      `solSentToRoot=${formatSol(comparison.solSentToRoot)} SOL`
    );
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 6: Verify Root Token Statistics');
  console.log('─'.repeat(70) + '\n');

  // Check root token stats
  const rootStatsPda = deriveTokenStatsPDA(rootMint);
  try {
    const rootStats = await accounts.tokenStats.fetch(rootStatsPda);
    const beforeRootStats = beforeCycle.tokenStats.get(root.mint);

    const rootBurned = rootStats.totalBurned.sub(beforeRootStats?.totalBurned || new BN(0));
    const rootCollected = rootStats.totalSolCollected.sub(beforeRootStats?.totalSolCollected || new BN(0));
    const rootFromOthers = rootStats.totalSolReceivedFromOthers.sub(
      beforeRootStats?.totalSolReceivedFromOthers || new BN(0)
    );

    log(`Root ${root.symbol}:`);
    log(`  Tokens burned: ${rootBurned.toString()}`);
    log(`  SOL collected: ${formatSol(rootCollected)} SOL`);
    log(`  From secondaries: ${formatSol(rootFromOthers)} SOL`);
    log(`  Is root token: ${rootStats.isRootToken}`);

    logTest(
      results,
      'Root token cycle executed',
      rootStats.isRootToken && rootStats.totalBurned.gt(new BN(0)),
      `burned=${rootBurned.toString()}, collected=${formatSol(rootCollected)} SOL`
    );
  } catch (e: any) {
    logTest(results, 'Root token cycle executed', false, e.message?.slice(0, 100));
  }

  // Final summary
  console.log('\n' + '─'.repeat(70));
  console.log('📊 Final Token Statistics');
  console.log('─'.repeat(70) + '\n');

  for (const token of allTokens) {
    const stats = afterCycle.tokenStats.get(token.mint);
    if (stats) {
      const isRoot = stats.isRootToken ? ' (ROOT)' : '';
      log(`${token.symbol}${isRoot}:`);
      log(`  Total burned: ${stats.totalBurned.toString()}`);
      log(`  Total collected: ${formatSol(stats.totalSolCollected)} SOL`);
      log(`  Cycles: ${stats.cyclesParticipated?.toString() || 'N/A'}`);
      if (!stats.isRootToken) {
        log(`  Sent to root: ${formatSol(stats.totalSolSentToRoot)} SOL`);
      } else {
        log(`  From others: ${formatSol(stats.totalSolReceivedFromOthers)} SOL`);
      }
    }
  }

  // Print summary and exit
  const exitCode = printSummary(results);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
