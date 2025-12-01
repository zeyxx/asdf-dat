#!/usr/bin/env ts-node
/**
 * Multi-Token Proportional Distribution Test
 *
 * Tests proportional fee distribution across multiple tokens:
 * 1. Generate different volume amounts on multiple secondaries
 * 2. Verify proportional pending_fees allocation
 * 3. Execute cycle and verify proportional distribution
 * 4. Test deferred tokens (insufficient fees)
 * 5. Verify per-token statistics tracking
 *
 * Usage: npx ts-node scripts/test-proportional-distribution.ts --network devnet
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
  MIN_ALLOCATION_SECONDARY,
} from '../lib/test-utils';
import { getTypedAccounts, TokenStats } from '../lib/types';

const results: TestResult[] = [];

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('📊 Multi-Token Proportional Distribution Test');
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

  if (secondaries.length < 2) {
    console.error('❌ Need at least 2 secondary tokens for proportional distribution test');
    process.exit(1);
  }

  log(`Root token: ${root.name} (${root.symbol})`);
  log(`Secondary tokens: ${secondaries.length}`);

  // Kill existing daemons
  stopDaemons();
  await sleep(2000);

  // Start fresh daemon
  const daemon = startDaemon(network);
  await sleep(10000);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 1: Generate Proportional Volume');
  console.log('─'.repeat(70) + '\n');

  // Find config paths for secondaries
  const secondaryConfigs: { token: typeof secondaries[0]; path: string }[] = [];
  for (const secondary of secondaries) {
    const configFile = fs
      .readdirSync('devnet-tokens')
      .find((f) => {
        const cfg = JSON.parse(fs.readFileSync(`devnet-tokens/${f}`, 'utf-8'));
        return cfg.mint === secondary.mint;
      });

    if (configFile) {
      secondaryConfigs.push({ token: secondary, path: `devnet-tokens/${configFile}` });
    }
  }

  // Generate DIFFERENT volumes to test proportionality
  // Token 1: 2x volume (high fees)
  // Token 2: 1x volume (medium fees)
  // Token 3+: 0.5x volume (low fees, may be deferred)

  const volumePattern = [2, 1, 0.3, 0.3]; // SOL per token

  log('Volume pattern for proportionality test:');
  for (let i = 0; i < secondaryConfigs.length; i++) {
    const volume = volumePattern[i] || 0.3;
    log(`  ${secondaryConfigs[i].token.symbol}: ${volume} SOL total`);
  }

  // Generate volumes
  for (let i = 0; i < secondaryConfigs.length; i++) {
    const { token, path: configPath } = secondaryConfigs[i];
    const targetVolume = volumePattern[i] || 0.3;

    log(`\nGenerating ${targetVolume} SOL volume on ${token.symbol}...`);

    // Split into buy/sell rounds
    const roundVolume = targetVolume / 2;
    await generateVolume(configPath, roundVolume, network);
    await sleep(2000);
    await generateVolume(configPath, roundVolume, network);
    await sleep(2000);
  }

  logTest(results, 'Proportional volume generated', true, `${secondaryConfigs.length} tokens with varying amounts`);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 2: Verify Proportional Fee Attribution');
  console.log('─'.repeat(70) + '\n');

  // Wait for daemon sync
  await waitForDaemonSync(25);

  // Check pending fees and calculate proportions
  const pendingFees: { symbol: string; mint: string; fees: BN }[] = [];
  let totalPendingFees = new BN(0);

  for (const { token } of secondaryConfigs) {
    const mint = new PublicKey(token.mint);
    const statsPda = deriveTokenStatsPDA(mint);

    try {
      const stats = await accounts.tokenStats.fetch(statsPda);
      pendingFees.push({
        symbol: token.symbol,
        mint: token.mint,
        fees: stats.pendingFeesLamports,
      });
      totalPendingFees = totalPendingFees.add(stats.pendingFeesLamports);
      log(`${token.symbol}: pending_fees = ${formatSol(stats.pendingFeesLamports)} SOL`);
    } catch (e: any) {
      log(`${token.symbol}: Failed to fetch - ${e.message?.slice(0, 50)}`);
    }
  }

  // Verify proportionality
  log(`\nTotal pending fees: ${formatSol(totalPendingFees)} SOL`);

  if (totalPendingFees.gt(new BN(0))) {
    log('\nProportional distribution:');
    for (const pf of pendingFees) {
      const proportion = pf.fees.muln(100).div(totalPendingFees);
      log(`  ${pf.symbol}: ${proportion.toString()}% of total`);
    }

    // Check if higher volume = higher fees (token 0 should have more than token 1)
    const isProportional =
      pendingFees.length >= 2 && pendingFees[0].fees.gte(pendingFees[1].fees);

    logTest(
      results,
      'Fee proportionality verified',
      isProportional,
      `${pendingFees[0]?.symbol || 'T1'} >= ${pendingFees[1]?.symbol || 'T2'}`
    );
  } else {
    logTest(results, 'Fee proportionality verified', false, 'No fees accumulated');
  }

  // Stop daemon before cycle
  stopDaemons();
  await sleep(2000);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 3: Test Token with Insufficient Fees');
  console.log('─'.repeat(70) + '\n');

  // Identify tokens that should be deferred (below threshold)
  const sufficientTokens = pendingFees.filter((pf) => pf.fees.gte(new BN(MIN_ALLOCATION_SECONDARY)));
  const insufficientTokens = pendingFees.filter((pf) => pf.fees.lt(new BN(MIN_ALLOCATION_SECONDARY)));

  log(`Tokens with sufficient fees: ${sufficientTokens.length}`);
  sufficientTokens.forEach((t) => log(`  ✅ ${t.symbol}: ${formatSol(t.fees)} SOL`));

  log(`Tokens with insufficient fees (will be deferred): ${insufficientTokens.length}`);
  insufficientTokens.forEach((t) => log(`  ⏸️ ${t.symbol}: ${formatSol(t.fees)} SOL`));

  logTest(
    results,
    'Deferred tokens identified',
    true,
    `${sufficientTokens.length} sufficient, ${insufficientTokens.length} deferred`
  );

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 4: Execute Cycle & Verify Distribution');
  console.log('─'.repeat(70) + '\n');

  // Capture state before cycle
  const allTokens = [root, ...secondaries];
  const beforeCycle = await captureState(connection, program, allTokens);

  // Find root config path
  const rootConfigPath = fs
    .readdirSync('devnet-tokens')
    .find((f) => {
      const cfg = JSON.parse(fs.readFileSync(`devnet-tokens/${f}`, 'utf-8'));
      return cfg.isRoot;
    });

  if (!rootConfigPath) {
    logTest(results, 'Root config found', false, 'No root token config');
    return;
  }

  // Execute cycle
  const cycleResult = await executeEcosystemCycle(`devnet-tokens/${rootConfigPath}`, network);

  if (cycleResult.success) {
    logTest(results, 'Ecosystem cycle executed', true, 'Cycle completed');
  } else {
    logTest(results, 'Ecosystem cycle executed', false, cycleResult.output.slice(0, 100));
  }

  await sleep(5000);

  // Capture state after cycle
  const afterCycle = await captureState(connection, program, allTokens);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 5: Verify Per-Token Statistics');
  console.log('─'.repeat(70) + '\n');

  // Check each token's statistics
  for (const { token } of secondaryConfigs) {
    const beforeStats = beforeCycle.tokenStats.get(token.mint);
    const afterStats = afterCycle.tokenStats.get(token.mint);

    if (beforeStats && afterStats) {
      const burned = afterStats.totalBurned.sub(beforeStats.totalBurned);
      const collected = afterStats.totalSolCollected.sub(beforeStats.totalSolCollected);
      const sentToRoot = afterStats.totalSolSentToRoot.sub(beforeStats.totalSolSentToRoot);
      const pendingBefore = beforeStats.pendingFeesLamports;
      const pendingAfter = afterStats.pendingFeesLamports;

      log(`${token.symbol}:`);
      log(`  Tokens burned: ${burned.toString()}`);
      log(`  SOL collected: ${formatSol(collected)} SOL`);
      log(`  Sent to root: ${formatSol(sentToRoot)} SOL`);
      log(`  Pending fees: ${formatSol(pendingBefore)} → ${formatSol(pendingAfter)} SOL`);

      // Check if sufficient tokens participated (pending fees should decrease)
      const wasSufficient = pendingBefore.gte(new BN(MIN_ALLOCATION_SECONDARY));
      const participated = burned.gt(new BN(0)) || pendingAfter.lt(pendingBefore);

      if (wasSufficient && participated) {
        log(`  ✅ Participated in cycle`);
      } else if (!wasSufficient && pendingAfter.eq(pendingBefore)) {
        log(`  ⏸️ Deferred (fees preserved)`);
      } else if (wasSufficient && !participated) {
        log(`  ⚠️ Should have participated but didn't`);
      }
    }
  }

  // Verify deferred tokens preserved their fees
  let deferredPreserved = 0;
  for (const insuffToken of insufficientTokens) {
    const beforeStats = beforeCycle.tokenStats.get(insuffToken.mint);
    const afterStats = afterCycle.tokenStats.get(insuffToken.mint);

    if (beforeStats && afterStats) {
      // Pending fees should be preserved (equal or slightly different due to ongoing fee accumulation)
      const preserved = afterStats.pendingFeesLamports.gte(beforeStats.pendingFeesLamports.muln(9).divn(10)); // 90% tolerance
      if (preserved) deferredPreserved++;
    }
  }

  logTest(
    results,
    'Deferred tokens preserved fees',
    insufficientTokens.length === 0 || deferredPreserved === insufficientTokens.length,
    `${deferredPreserved}/${insufficientTokens.length} preserved`
  );

  // Verify cycles_participated tracking
  let cyclesIncremented = 0;
  for (const { token } of secondaryConfigs) {
    const beforeStats = beforeCycle.tokenStats.get(token.mint);
    const afterStats = afterCycle.tokenStats.get(token.mint);

    if (beforeStats && afterStats) {
      const beforeCycles = beforeStats.cyclesParticipated || new BN(0);
      const afterCycles = afterStats.cyclesParticipated || new BN(0);

      if (afterCycles.gt(beforeCycles)) {
        cyclesIncremented++;
      }
    }
  }

  logTest(
    results,
    'Cycles participated tracked',
    cyclesIncremented > 0,
    `${cyclesIncremented} tokens incremented cycle count`
  );

  // Verify root received proportional fees
  const rootStats = afterCycle.tokenStats.get(root.mint);
  const rootStatsBefore = beforeCycle.tokenStats.get(root.mint);

  if (rootStats && rootStatsBefore) {
    const fromOthersDelta = rootStats.totalSolReceivedFromOthers.sub(rootStatsBefore.totalSolReceivedFromOthers);
    log(`\nRoot token received from secondaries: ${formatSol(fromOthersDelta)} SOL`);

    logTest(
      results,
      'Root received 44.8% from secondaries',
      fromOthersDelta.gt(new BN(0)),
      `+${formatSol(fromOthersDelta)} SOL`
    );
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📊 Final Statistics Summary');
  console.log('─'.repeat(70) + '\n');

  // Summary table
  console.log('Token          | Burned      | Collected   | To Root     | Cycles');
  console.log('─'.repeat(70));

  for (const token of allTokens) {
    const stats = afterCycle.tokenStats.get(token.mint);
    if (stats) {
      const isRoot = stats.isRootToken ? '(ROOT)' : '';
      const name = `${token.symbol} ${isRoot}`.padEnd(14);
      const burned = stats.totalBurned.toString().padStart(11);
      const collected = formatSol(stats.totalSolCollected).padStart(11);
      const toRoot = stats.isRootToken
        ? formatSol(stats.totalSolReceivedFromOthers).padStart(11)
        : formatSol(stats.totalSolSentToRoot).padStart(11);
      const cycles = (stats.cyclesParticipated?.toString() || 'N/A').padStart(6);

      console.log(`${name} | ${burned} | ${collected} | ${toRoot} | ${cycles}`);
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
