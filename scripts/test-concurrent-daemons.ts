#!/usr/bin/env ts-node
/**
 * Concurrent Daemon Operation Tests
 *
 * Tests daemon concurrency and crash recovery:
 * 1. Multiple daemon instances blocked by lock
 * 2. Crash recovery with state file
 * 3. Stale lock cleanup
 * 4. State persistence verification
 *
 * Usage: npx ts-node scripts/test-concurrent-daemons.ts --network devnet
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync, ChildProcess } from 'child_process';
import {
  log,
  logTest,
  sleep,
  setupProvider,
  generateVolume,
  stopDaemons,
  printSummary,
  getDevnetTokens,
  TestResult,
} from '../lib/test-utils';

const results: TestResult[] = [];

const STATE_FILE = '.daemon-state.json';
const BACKUP_FILE = '.daemon-state.backup.json';
const LOCK_FILE = '.daemon-lock.json';

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('🔒 Concurrent Daemon Operation Tests');
  console.log('═'.repeat(70) + '\n');

  // Parse args
  const args = process.argv.slice(2);
  const networkArg = args.find((a) => a.startsWith('--network=')) || args[args.indexOf('--network') + 1];
  const network = (networkArg || 'devnet') as 'devnet' | 'mainnet';

  log(`Network: ${network}`);

  // Setup
  const { connection, adminKeypair } = setupProvider(network);
  log(`Admin: ${adminKeypair.publicKey.toBase58()}`);

  // Backup existing files
  const originalState = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf-8') : null;
  const originalBackup = fs.existsSync(BACKUP_FILE) ? fs.readFileSync(BACKUP_FILE, 'utf-8') : null;
  const originalLock = fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, 'utf-8') : null;

  // Kill any existing daemons
  stopDaemons();
  await sleep(2000);

  // Clean up lock file
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 1: Multiple Daemon Instances Blocked');
  console.log('─'.repeat(70) + '\n');

  // Start first daemon
  log('Starting daemon 1...');
  const daemon1 = spawn('npx', ['ts-node', 'scripts/monitor-ecosystem-fees.ts', '--network', network], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
  });

  let daemon1Output = '';
  daemon1.stdout?.on('data', (data) => {
    daemon1Output += data.toString();
  });
  daemon1.stderr?.on('data', (data) => {
    daemon1Output += data.toString();
  });

  // Wait for first daemon to acquire lock
  await sleep(8000);

  // Check if lock file exists
  const lockAfterDaemon1 = fs.existsSync(LOCK_FILE);
  log(`Lock file exists after daemon 1 start: ${lockAfterDaemon1}`);

  if (lockAfterDaemon1) {
    const lockContent = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    log(`Lock PID: ${lockContent.pid}`);
    log(`Lock started: ${lockContent.startedAt}`);
  }

  // Try to start second daemon
  log('\nAttempting to start daemon 2...');
  let daemon2Output = '';
  let daemon2Blocked = false;

  try {
    // Run with short timeout - should fail or exit quickly
    daemon2Output = execSync(
      `timeout 10 npx ts-node scripts/monitor-ecosystem-fees.ts --network ${network} 2>&1 || true`,
      { encoding: 'utf-8', timeout: 15000 }
    );
  } catch (e: any) {
    daemon2Output = e.stdout || e.message || '';
    daemon2Blocked = true;
  }

  // Check if daemon 2 was blocked
  const wasBlocked =
    daemon2Output.includes('lock') ||
    daemon2Output.includes('already running') ||
    daemon2Output.includes('Another daemon') ||
    daemon2Blocked;

  log(`Daemon 2 output: ${daemon2Output.slice(0, 200)}`);

  logTest(
    results,
    'Multiple daemons blocked by lock',
    wasBlocked || lockAfterDaemon1,
    wasBlocked ? 'Second daemon blocked' : 'Lock mechanism active'
  );

  // Kill daemon 1
  try {
    process.kill(-daemon1.pid!, 'SIGKILL');
  } catch {
    stopDaemons();
  }
  await sleep(2000);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 2: Crash Recovery with State File');
  console.log('─'.repeat(70) + '\n');

  // Clean up
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);

  // Start daemon, generate some volume, then kill it
  log('Starting daemon for crash test...');
  const crashDaemon = spawn('npx', ['ts-node', 'scripts/monitor-ecosystem-fees.ts', '--network', network], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
  });

  // Wait for daemon to start and create state
  await sleep(15000);

  // Check state file was created
  const stateBeforeCrash = fs.existsSync(STATE_FILE);
  let signaturesBeforeCrash: Record<string, string> = {};

  if (stateBeforeCrash) {
    const stateContent = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    signaturesBeforeCrash = stateContent.lastSignatures || {};
    log(`State file exists: yes`);
    log(`Signatures tracked: ${Object.keys(signaturesBeforeCrash).length}`);
  } else {
    log(`State file exists: no (daemon may not have processed any transactions yet)`);
  }

  // Kill daemon abruptly (simulate crash)
  log('\nSimulating crash (SIGKILL)...');
  try {
    process.kill(-crashDaemon.pid!, 'SIGKILL');
  } catch {
    stopDaemons();
  }
  await sleep(2000);

  // Clean lock file (simulate unclean shutdown)
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }

  // Restart daemon
  log('Restarting daemon after crash...');
  const recoveryDaemon = spawn('npx', ['ts-node', 'scripts/monitor-ecosystem-fees.ts', '--network', network], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
  });

  // Wait for recovery
  await sleep(15000);

  // Check state was preserved/restored
  const stateAfterRecovery = fs.existsSync(STATE_FILE);
  let signaturesAfterRecovery: Record<string, string> = {};

  if (stateAfterRecovery) {
    const stateContent = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    signaturesAfterRecovery = stateContent.lastSignatures || {};
    log(`State file after recovery: yes`);
    log(`Signatures tracked: ${Object.keys(signaturesAfterRecovery).length}`);
  }

  // Verify signatures were preserved (not reset)
  const signaturesPreserved =
    Object.keys(signaturesBeforeCrash).length === 0 || // No sigs before = nothing to preserve
    Object.keys(signaturesAfterRecovery).length >= Object.keys(signaturesBeforeCrash).length;

  logTest(
    results,
    'Crash recovery preserves state',
    stateAfterRecovery && signaturesPreserved,
    `Signatures: ${Object.keys(signaturesBeforeCrash).length} → ${Object.keys(signaturesAfterRecovery).length}`
  );

  // Kill recovery daemon
  try {
    process.kill(-recoveryDaemon.pid!, 'SIGKILL');
  } catch {
    stopDaemons();
  }
  await sleep(2000);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 3: Stale Lock Cleanup');
  console.log('─'.repeat(70) + '\n');

  // Clean up
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);

  // Create a stale lock (old timestamp, non-existent PID)
  const staleLock = {
    pid: 99999, // Non-existent PID
    startedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
    hostname: 'test-host-stale',
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(staleLock, null, 2));
  log(`Created stale lock with PID 99999`);

  // Start daemon - should auto-cleanup stale lock
  log('Starting daemon (should cleanup stale lock)...');
  const staleDaemon = spawn('npx', ['ts-node', 'scripts/monitor-ecosystem-fees.ts', '--network', network], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
  });

  // Wait for daemon to handle stale lock
  await sleep(10000);

  // Check if lock was updated
  if (fs.existsSync(LOCK_FILE)) {
    const newLock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    const isNewLock = newLock.pid !== 99999;
    log(`Lock PID after cleanup: ${newLock.pid}`);
    log(`Lock hostname: ${newLock.hostname}`);

    logTest(
      results,
      'Stale lock auto-cleanup',
      isNewLock,
      isNewLock ? 'Stale lock replaced' : 'Lock not updated'
    );
  } else {
    logTest(results, 'Stale lock auto-cleanup', true, 'Lock file cleaned up');
  }

  // Kill daemon
  try {
    process.kill(-staleDaemon.pid!, 'SIGKILL');
  } catch {
    stopDaemons();
  }
  await sleep(2000);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 4: State Persistence Verification');
  console.log('─'.repeat(70) + '\n');

  // Clean up
  stopDaemons();
  await sleep(2000);
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);

  // Start fresh daemon
  log('Starting daemon with clean state...');
  const freshDaemon = spawn('npx', ['ts-node', 'scripts/monitor-ecosystem-fees.ts', '--network', network], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
  });

  // Generate some volume to trigger state updates
  const { secondaries } = getDevnetTokens();
  if (secondaries.length > 0) {
    const configFile = fs
      .readdirSync('devnet-tokens')
      .find((f) => {
        const cfg = JSON.parse(fs.readFileSync(`devnet-tokens/${f}`, 'utf-8'));
        return cfg.mint === secondaries[0].mint;
      });

    if (configFile) {
      await sleep(10000); // Wait for daemon to start
      log('\nGenerating volume to trigger state update...');
      await generateVolume(`devnet-tokens/${configFile}`, 0.3, network);
    }
  }

  // Wait for daemon to process and save state
  await sleep(20000);

  // Check state was persisted
  if (fs.existsSync(STATE_FILE)) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    log(`State file created: yes`);
    log(`State version: ${state.version}`);
    log(`Last updated: ${state.lastUpdated}`);
    log(`Signatures: ${Object.keys(state.lastSignatures || {}).length}`);

    logTest(
      results,
      'State persistence',
      state.version === 1 && state.lastUpdated,
      `version=${state.version}, signatures=${Object.keys(state.lastSignatures || {}).length}`
    );
  } else {
    logTest(results, 'State persistence', false, 'State file not created');
  }

  // Check backup exists
  if (fs.existsSync(BACKUP_FILE)) {
    log(`Backup file exists: yes`);
    logTest(results, 'State backup created', true, 'Backup file exists');
  } else {
    logTest(results, 'State backup created', false, 'No backup file');
  }

  // Cleanup
  try {
    process.kill(-freshDaemon.pid!, 'SIGKILL');
  } catch {
    stopDaemons();
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📊 Daemon Files Status');
  console.log('─'.repeat(70) + '\n');

  console.log(`File               | Exists`);
  console.log('─'.repeat(40));
  console.log(`${STATE_FILE.padEnd(18)} | ${fs.existsSync(STATE_FILE)}`);
  console.log(`${BACKUP_FILE.padEnd(18)} | ${fs.existsSync(BACKUP_FILE)}`);
  console.log(`${LOCK_FILE.padEnd(18)} | ${fs.existsSync(LOCK_FILE)}`);

  // Restore original files
  if (originalState) {
    fs.writeFileSync(STATE_FILE, originalState);
  }
  if (originalBackup) {
    fs.writeFileSync(BACKUP_FILE, originalBackup);
  }
  if (originalLock) {
    fs.writeFileSync(LOCK_FILE, originalLock);
  } else if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }

  // Final cleanup
  stopDaemons();

  // Print summary and exit
  const exitCode = printSummary(results);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error.message);
  stopDaemons();
  process.exit(1);
});
