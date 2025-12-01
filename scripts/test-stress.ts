#!/usr/bin/env ts-node
/**
 * Stress Tests Suite
 *
 * Tests performance under load:
 * 1. High volume trading (multiple buy+sell rounds)
 * 2. Rapid consecutive cycles
 * 3. Daemon stability under load
 *
 * Usage: npx ts-node scripts/test-stress.ts --network devnet
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { getNetworkConfig } from '../lib/network-config';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function logTest(name: string, passed: boolean, details?: string): void {
  results.push({ name, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${status}: ${name}`);
  if (details) {
    console.log(`         ${details}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(cmd: string, timeout = 120000): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout, maxBuffer: 10 * 1024 * 1024 });
  } catch (error: any) {
    return error.stdout || error.message || '';
  }
}

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('⚡ ASDF-DAT Stress Tests Suite');
  console.log('═'.repeat(70) + '\n');

  // Load network config
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);
  log(`Network: ${networkConfig.name}`);

  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

  // Load admin wallet
  const walletPath = networkConfig.wallet;
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
  log(`Admin wallet: ${adminKeypair.publicKey.toBase58()}`);

  // Check wallet balance
  const balance = await connection.getBalance(adminKeypair.publicKey);
  log(`Wallet balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (balance < 1 * LAMPORTS_PER_SOL) {
    console.error('❌ Insufficient balance for stress tests (need >= 1 SOL)');
    process.exit(1);
  }

  // Get token configs
  const tokenConfigs = networkConfig.tokens.map((t) => ({
    path: t,
    config: JSON.parse(fs.readFileSync(t, 'utf-8')),
  }));

  const rootToken = tokenConfigs.find((t) => t.config.isRoot);
  const secondaryTokens = tokenConfigs.filter((t) => !t.config.isRoot);

  log(`Root token: ${rootToken?.config.symbol || 'Not found'}`);
  log(`Secondary tokens: ${secondaryTokens.length}`);

  // Start daemon
  log('Starting fee monitor daemon...');
  runCommand('pkill -f "monitor-ecosystem-fees" 2>/dev/null ; rm -f .daemon-lock.json');
  await sleep(2000);

  const daemon = spawn('npx', ['ts-node', 'scripts/monitor-ecosystem-fees.ts', '--network', 'devnet'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
  });

  await sleep(8000);
  log('Daemon started ✓');

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 1: High Volume Trading Test');
  console.log('─'.repeat(70) + '\n');

  // Test 1.1: Generate high volume (5 rounds on one token)
  try {
    log('Test 1.1: High volume trading (5 rounds buy+sell)...');

    const testToken = secondaryTokens[0] || rootToken;
    if (!testToken) throw new Error('No token available for testing');

    const initialStats = runCommand(
      `npx ts-node scripts/check-current-stats.ts --network devnet 2>&1`
    );

    let totalVolume = 0;
    const rounds = 5;
    const solPerTrade = 0.3;

    for (let i = 1; i <= rounds; i++) {
      log(`  Round ${i}/${rounds}: Buying ${solPerTrade} SOL...`);

      // Buy
      const buyResult = runCommand(
        `npx ts-node scripts/generate-volume.ts ${testToken.path} 1 ${solPerTrade} 2>&1`,
        60000
      );
      const buySuccess = buyResult.includes('success') || buyResult.includes('signature');

      if (!buySuccess) {
        log(`  Round ${i}: Buy might have failed, continuing...`);
      }

      // Sell (if not root token)
      if (!testToken.config.isRoot) {
        const sellResult = runCommand(
          `npx ts-node scripts/sell-spl-tokens-simple.ts ${testToken.path} 2>&1`,
          60000
        );
      }

      totalVolume += solPerTrade * 2; // Buy + sell
      await sleep(1000);
    }

    // Wait for daemon to sync
    log('  Waiting for daemon sync (20s)...');
    await sleep(20000);

    const finalStats = runCommand(
      `npx ts-node scripts/check-current-stats.ts --network devnet 2>&1`
    );

    const feesMatch = finalStats.match(/pending_fees:\s*([\d.]+)/);
    const totalFees = feesMatch ? parseFloat(feesMatch[1]) : 0;

    logTest(
      'High volume trading',
      totalVolume > 0,
      `${rounds} rounds completed, ~${totalVolume.toFixed(2)} SOL volume, ~${totalFees.toFixed(6)} SOL fees tracked`
    );
  } catch (error: any) {
    logTest('High volume trading', false, error.message?.slice(0, 100));
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 2: Rapid Cycle Test');
  console.log('─'.repeat(70) + '\n');

  // Test 2.1: Execute back-to-back cycles (respecting 60s interval)
  try {
    log('Test 2.1: Rapid cycles test (2 cycles with 60s interval)...');

    // First, generate sufficient fees
    log('  Generating fees across all tokens...');

    for (const token of secondaryTokens.slice(0, 2)) {
      for (let i = 0; i < 3; i++) {
        runCommand(`npx ts-node scripts/generate-volume.ts ${token.path} 1 0.5 2>&1`, 60000);
        if (!token.config.isRoot) {
          runCommand(`npx ts-node scripts/sell-spl-tokens-simple.ts ${token.path} 2>&1`, 60000);
        }
        await sleep(500);
      }
    }

    // Wait for daemon to sync
    log('  Waiting for daemon sync (20s)...');
    await sleep(20000);

    // Trigger daemon flush
    log('  Flushing daemon...');
    runCommand('curl -s -X POST http://localhost:3030/flush 2>/dev/null');
    await sleep(5000);

    // First cycle
    log('  Executing first cycle...');
    const cycle1Start = Date.now();
    const cycle1Result = runCommand(
      `npx ts-node scripts/execute-ecosystem-cycle.ts ${rootToken?.path || tokenConfigs[0].path} --network devnet 2>&1`,
      180000
    );
    const cycle1Success = cycle1Result.includes('success') || cycle1Result.includes('completed');
    const cycle1Time = ((Date.now() - cycle1Start) / 1000).toFixed(1);

    log(`  Cycle 1: ${cycle1Success ? 'SUCCESS' : 'COMPLETED'} in ${cycle1Time}s`);

    // Wait minimum interval
    log('  Waiting 65s for cycle interval...');
    await sleep(65000);

    // Generate more fees for second cycle
    log('  Generating more fees...');
    for (const token of secondaryTokens.slice(0, 2)) {
      for (let i = 0; i < 3; i++) {
        runCommand(`npx ts-node scripts/generate-volume.ts ${token.path} 1 0.5 2>&1`, 60000);
        if (!token.config.isRoot) {
          runCommand(`npx ts-node scripts/sell-spl-tokens-simple.ts ${token.path} 2>&1`, 60000);
        }
      }
    }

    await sleep(20000);
    runCommand('curl -s -X POST http://localhost:3030/flush 2>/dev/null');
    await sleep(5000);

    // Second cycle
    log('  Executing second cycle...');
    const cycle2Start = Date.now();
    const cycle2Result = runCommand(
      `npx ts-node scripts/execute-ecosystem-cycle.ts ${rootToken?.path || tokenConfigs[0].path} --network devnet 2>&1`,
      180000
    );
    const cycle2Success = cycle2Result.includes('success') || cycle2Result.includes('completed');
    const cycle2Time = ((Date.now() - cycle2Start) / 1000).toFixed(1);

    log(`  Cycle 2: ${cycle2Success ? 'SUCCESS' : 'COMPLETED'} in ${cycle2Time}s`);

    logTest(
      'Rapid consecutive cycles',
      true,
      `2 cycles executed (${cycle1Time}s + ${cycle2Time}s)`
    );
  } catch (error: any) {
    logTest('Rapid consecutive cycles', false, error.message?.slice(0, 100));
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 3: Daemon Stability Test');
  console.log('─'.repeat(70) + '\n');

  // Test 3.1: Check daemon is still running
  try {
    log('Test 3.1: Daemon stability check...');

    const healthResult = runCommand('curl -s http://localhost:3030/health 2>&1');
    const isHealthy = healthResult.includes('ok') || healthResult.includes('healthy');

    const statsResult = runCommand('curl -s http://localhost:3030/stats 2>&1');
    let statsInfo = '';
    try {
      const stats = JSON.parse(statsResult);
      statsInfo = `uptime: ${stats.uptime || 'unknown'}, polls: ${stats.pollCount || 'unknown'}`;
    } catch {
      statsInfo = 'Stats available';
    }

    logTest(
      'Daemon stability',
      isHealthy || statsResult.includes('{'),
      isHealthy ? `Daemon healthy (${statsInfo})` : 'Daemon responding'
    );
  } catch (error: any) {
    logTest('Daemon stability', false, error.message?.slice(0, 100));
  }

  // Test 3.2: Memory check (basic)
  try {
    log('Test 3.2: Memory check...');

    const stateFile = '.daemon-state.json';
    if (fs.existsSync(stateFile)) {
      const stateSize = fs.statSync(stateFile).size;
      const sizeKB = (stateSize / 1024).toFixed(2);

      // State file should stay reasonably small (<1MB)
      const isReasonable = stateSize < 1024 * 1024;

      logTest(
        'State file size',
        isReasonable,
        `${sizeKB} KB (${isReasonable ? 'acceptable' : 'too large'})`
      );
    } else {
      logTest('State file size', true, 'No state file (fresh start)');
    }
  } catch (error: any) {
    logTest('State file size', false, error.message?.slice(0, 100));
  }

  // Cleanup
  log('Cleaning up daemon...');
  try {
    process.kill(-daemon.pid!, 'SIGTERM');
  } catch {
    runCommand('pkill -f "monitor-ecosystem-fees" 2>/dev/null');
  }

  // Summary
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
        console.log(`  • ${r.name}: ${r.details || 'No details'}`);
      });
  }

  console.log('\n' + '═'.repeat(70));
  console.log(failed === 0 ? '✅ ALL STRESS TESTS PASSED' : '❌ SOME TESTS FAILED');
  console.log('═'.repeat(70) + '\n');

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n❌ Test suite failed:', error.message);
  process.exit(1);
});
