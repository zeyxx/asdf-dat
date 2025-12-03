#!/usr/bin/env ts-node
/**
 * Token2022 (Mayhem Mode) Cycle Test
 *
 * Tests Token2022 support in the DAT ecosystem:
 * 1. Verify mayhem token configuration
 * 2. Verify bonding curve has 82 bytes (mayhem flag)
 * 3. Execute full cycle on Token2022 token
 * 4. Test Token2022 in mixed ecosystem (SPL root + Token2022 secondary)
 *
 * Usage: npx ts-node scripts/test-mayhem-mode.ts --network devnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
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
  deriveCreatorVault,
  captureState,
  compareStates,
  generateVolume,
  waitForDaemonSync,
  startDaemon,
  stopDaemons,
  executeEcosystemCycle,
  printSummary,
  formatSol,
  getDevnetTokens,
  loadTokenConfig,
  loadAllTokenConfigs,
  TestResult,
  PROGRAM_ID,
  PUMP_PROGRAM,
} from '../lib/test-utils';
import { getTypedAccounts, TokenConfig } from '../lib/types';

const results: TestResult[] = [];

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('🔥 Token2022 (Mayhem Mode) Cycle Test');
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

  // Load all tokens
  const tokensDir = path.join(__dirname, '../devnet-tokens');
  const allConfigs = loadAllTokenConfigs(tokensDir);

  // Find mayhem (Token2022) token
  const mayhemToken = allConfigs.find((c) => c.tokenProgram === 'Token2022');
  const splTokens = allConfigs.filter((c) => c.tokenProgram === 'SPL');
  const rootToken = allConfigs.find((c) => c.isRoot);

  if (!mayhemToken) {
    console.error('❌ No Token2022 (mayhem) token found in devnet-tokens/');
    console.error('Please create a mayhem token first.');
    process.exit(1);
  }

  if (!rootToken) {
    console.error('❌ No root token found in devnet-tokens/');
    process.exit(1);
  }

  log(`Root token: ${rootToken.name} (${rootToken.symbol}) - ${rootToken.tokenProgram}`);
  log(`Mayhem token: ${mayhemToken.name} (${mayhemToken.symbol}) - Token2022`);
  log(`SPL secondaries: ${splTokens.filter((t) => !t.isRoot).length}`);

  const rootMint = new PublicKey(rootToken.mint);
  const pdas = derivePDAs(rootMint);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 1: Verify Mayhem Token Configuration');
  console.log('─'.repeat(70) + '\n');

  // Check token config
  log(`Mint: ${mayhemToken.mint}`);
  log(`Token Program: ${mayhemToken.tokenProgram}`);
  log(`Pool Type: ${mayhemToken.poolType}`);
  log(`Creator: ${mayhemToken.creator}`);
  log(`Bonding Curve: ${mayhemToken.bondingCurve}`);

  const isMayhemConfig = mayhemToken.tokenProgram === 'Token2022';
  logTest(results, 'Mayhem token configured', isMayhemConfig, `tokenProgram=${mayhemToken.tokenProgram}`);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 2: Verify Bonding Curve Structure');
  console.log('─'.repeat(70) + '\n');

  // Check bonding curve data (82 bytes for mayhem, 81 for standard)
  const bondingCurve = new PublicKey(mayhemToken.bondingCurve);
  const bcInfo = await connection.getAccountInfo(bondingCurve);

  if (bcInfo) {
    log(`Bonding curve data length: ${bcInfo.data.length} bytes`);
    log(`Owner: ${bcInfo.owner.toBase58()}`);

    // Mayhem mode tokens have 82 bytes (extra flag byte)
    const isMayhemBC = bcInfo.data.length === 82;
    const isStandardBC = bcInfo.data.length === 81;

    if (isMayhemBC) {
      // Check the mayhem flag (byte 81)
      const mayhemFlag = bcInfo.data[81];
      log(`Mayhem flag (byte 81): ${mayhemFlag}`);
      logTest(results, 'Bonding curve mayhem flag', mayhemFlag === 1, `flag=${mayhemFlag}`);
    } else if (isStandardBC) {
      log('Note: Standard 81-byte bonding curve (not mayhem format)');
      logTest(results, 'Bonding curve mayhem flag', false, 'Standard BC format, not 82 bytes');
    } else {
      logTest(results, 'Bonding curve mayhem flag', false, `Unexpected size: ${bcInfo.data.length}`);
    }
  } else {
    logTest(results, 'Bonding curve mayhem flag', false, 'Bonding curve not found');
  }

  // Verify token mint uses Token2022 program
  const mayhemMint = new PublicKey(mayhemToken.mint);
  const mintInfo = await connection.getAccountInfo(mayhemMint);

  if (mintInfo) {
    const isToken2022 = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    log(`Mint owner: ${mintInfo.owner.toBase58()}`);
    logTest(
      results,
      'Token uses Token2022 program',
      isToken2022,
      isToken2022 ? 'TOKEN_2022_PROGRAM_ID' : mintInfo.owner.toBase58().slice(0, 20)
    );
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 3: Generate Volume on Mayhem Token');
  console.log('─'.repeat(70) + '\n');

  // Stop any existing daemon
  stopDaemons();
  await sleep(2000);

  // Start daemon
  const daemon = startDaemon(network);
  await sleep(10000);

  // Find mayhem config path
  const mayhemConfigPath = fs
    .readdirSync(tokensDir)
    .find((f) => {
      const cfg = JSON.parse(fs.readFileSync(path.join(tokensDir, f), 'utf-8'));
      return cfg.mint === mayhemToken.mint;
    });

  if (mayhemConfigPath) {
    const fullPath = `devnet-tokens/${mayhemConfigPath}`;
    log(`Generating volume on ${mayhemToken.symbol}...`);

    // Generate 2 rounds of buy+sell
    await generateVolume(fullPath, 0.5, network);
    await sleep(2000);
    await generateVolume(fullPath, 0.5, network);
    await sleep(2000);

    logTest(results, 'Mayhem token volume generated', true, '2 rounds × 0.5 SOL');
  } else {
    logTest(results, 'Mayhem token volume generated', false, 'Config file not found');
  }

  // Wait for daemon sync
  await waitForDaemonSync(20);

  // Check pending fees
  const mayhemStatsPda = deriveTokenStatsPDA(mayhemMint);
  try {
    const stats = await accounts.tokenStats.fetch(mayhemStatsPda);
    log(`Mayhem token pending fees: ${formatSol(stats.pendingFeesLamports)} SOL`);
    logTest(
      results,
      'Mayhem fees accumulated',
      stats.pendingFeesLamports.gt(new BN(0)),
      formatSol(stats.pendingFeesLamports) + ' SOL'
    );
  } catch (e: any) {
    logTest(results, 'Mayhem fees accumulated', false, e.message?.slice(0, 80));
  }

  // Stop daemon
  stopDaemons();
  await sleep(2000);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 4: Execute Cycle Including Mayhem Token');
  console.log('─'.repeat(70) + '\n');

  // Capture state before cycle
  const beforeCycle = await captureState(connection, program, allConfigs);

  // Find root config path
  const rootConfigPath = fs
    .readdirSync(tokensDir)
    .find((f) => {
      const cfg = JSON.parse(fs.readFileSync(path.join(tokensDir, f), 'utf-8'));
      return cfg.isRoot;
    });

  if (rootConfigPath) {
    const cycleResult = await executeEcosystemCycle(`devnet-tokens/${rootConfigPath}`, network);

    if (cycleResult.success) {
      logTest(results, 'Ecosystem cycle executed', true, 'Includes mayhem token');
    } else {
      logTest(results, 'Ecosystem cycle executed', false, cycleResult.output.slice(0, 100));
    }
  }

  await sleep(5000);

  // Capture state after cycle
  const afterCycle = await captureState(connection, program, allConfigs);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 5: Verify Mayhem Token Burned via Token2022');
  console.log('─'.repeat(70) + '\n');

  // Check mayhem token stats
  const beforeMayhemStats = beforeCycle.tokenStats.get(mayhemToken.mint);
  const afterMayhemStats = afterCycle.tokenStats.get(mayhemToken.mint);

  if (beforeMayhemStats && afterMayhemStats) {
    const burned = afterMayhemStats.totalBurned.sub(beforeMayhemStats.totalBurned);
    const collected = afterMayhemStats.totalSolCollected.sub(beforeMayhemStats.totalSolCollected);
    const sentToRoot = afterMayhemStats.totalSolSentToRoot.sub(beforeMayhemStats.totalSolSentToRoot);

    log(`${mayhemToken.symbol} (Token2022):`);
    log(`  Tokens burned: ${burned.toString()}`);
    log(`  SOL collected: ${formatSol(collected)} SOL`);
    log(`  Sent to root: ${formatSol(sentToRoot)} SOL`);

    logTest(
      results,
      'Mayhem tokens burned',
      burned.gt(new BN(0)),
      `${burned.toString()} tokens via Token2022`
    );

    logTest(
      results,
      'Mayhem fees sent to root',
      sentToRoot.gt(new BN(0)),
      `${formatSol(sentToRoot)} SOL (44.8%)`
    );
  } else {
    logTest(results, 'Mayhem tokens burned', false, 'Stats not available');
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 6: Verify Mixed Ecosystem (SPL + Token2022)');
  console.log('─'.repeat(70) + '\n');

  // Check that root (SPL) received fees from mayhem (Token2022)
  const beforeRootStats = beforeCycle.tokenStats.get(rootToken.mint);
  const afterRootStats = afterCycle.tokenStats.get(rootToken.mint);

  if (beforeRootStats && afterRootStats) {
    const fromOthers = afterRootStats.totalSolReceivedFromOthers.sub(
      beforeRootStats.totalSolReceivedFromOthers
    );

    log(`Root token (${rootToken.tokenProgram}):`);
    log(`  Received from secondaries: ${formatSol(fromOthers)} SOL`);
    log(`  Token program: ${rootToken.tokenProgram}`);

    logTest(
      results,
      'Root received from Token2022 secondary',
      fromOthers.gt(new BN(0)),
      `${formatSol(fromOthers)} SOL across token programs`
    );
  }

  // Summary of token programs in ecosystem
  console.log('\n' + '─'.repeat(70));
  console.log('📊 Token Program Summary');
  console.log('─'.repeat(70) + '\n');

  console.log('Token          | Program   | Burned      | To Root');
  console.log('─'.repeat(60));

  for (const token of allConfigs) {
    const stats = afterCycle.tokenStats.get(token.mint);
    if (stats) {
      const name = `${token.symbol}`.padEnd(14);
      const prog = token.tokenProgram.padEnd(9);
      const burned = stats.totalBurned.toString().padStart(11);
      const toRoot = stats.isRootToken
        ? 'N/A (root)'.padStart(11)
        : formatSol(stats.totalSolSentToRoot).padStart(11);

      console.log(`${name} | ${prog} | ${burned} | ${toRoot}`);
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
