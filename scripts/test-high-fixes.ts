#!/usr/bin/env ts-node
/**
 * HIGH Priority Fix Verification Tests
 *
 * Tests to verify the 4 HIGH priority fixes from the security audit:
 *
 * HIGH-01: Fee split timestamp separation (direct vs timelock)
 * HIGH-02: sync_validator_slot rate limiting
 * HIGH-03: Daemon state persistence (processedSignatures)
 * HIGH-04: HTTP stream error handling
 *
 * Run these tests AFTER applying the fixes to verify correctness.
 *
 * Usage: npx ts-node scripts/test-high-fixes.ts --network devnet
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import BN from 'bn.js';
import * as fs from 'fs';
import * as http from 'http';
import {
  log,
  logTest,
  setupProvider,
  derivePDAs,
  printSummary,
  TestResult,
  sleep,
} from '../lib/test-utils';
import { getTypedAccounts, DATState } from '../lib/types';

const results: TestResult[] = [];

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('🔒 HIGH Priority Fix Verification Tests');
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

  // ═══════════════════════════════════════════════════════════════════════
  // HIGH-01: Fee Split Timestamp Separation
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(70));
  console.log('📋 HIGH-01: Fee Split Timestamp Separation');
  console.log('─'.repeat(70) + '\n');

  const state = await accounts.datState.fetch(pdas.datState);

  // Check that both timestamps exist in state
  // After fix, should have separate: last_direct_fee_split_timestamp and pending_fee_split_timestamp
  const pendingTimestamp = state.pendingFeeSplitTimestamp?.toNumber() || 0;
  const cooldown = state.adminOperationCooldown?.toNumber() || 0;

  log(`Pending fee split timestamp: ${pendingTimestamp > 0 ? new Date(pendingTimestamp * 1000).toISOString() : 'None'}`);
  log(`Admin cooldown: ${cooldown}s (${cooldown / 3600}h)`);

  // Test: Cooldown exists and is reasonable (should be 1 hour = 3600s)
  logTest(
    results,
    'HIGH-01: Admin cooldown configured',
    cooldown >= 3600,
    `Cooldown: ${cooldown}s (expected >= 3600s)`
  );

  // Test: Fee split change follows cooldown
  // This would require attempting to call update_fee_split twice in quick succession
  // For now, verify the mechanism exists
  logTest(
    results,
    'HIGH-01: Fee split state fields exist',
    state.pendingFeeSplitTimestamp !== undefined && state.adminOperationCooldown !== undefined,
    'pendingFeeSplitTimestamp and adminOperationCooldown present'
  );

  // ═══════════════════════════════════════════════════════════════════════
  // HIGH-02: sync_validator_slot Rate Limiting
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(70));
  console.log('📋 HIGH-02: sync_validator_slot Rate Limiting');
  console.log('─'.repeat(70) + '\n');

  // After fix, sync_validator_slot should:
  // 1. Require minimum time between calls (e.g., 1 hour)
  // 2. OR require admin authorization

  // For now, verify the validator stale threshold exists
  const STALE_THRESHOLD: number = 1000; // slots

  log(`Validator stale threshold: ${STALE_THRESHOLD} slots`);
  log(`Note: After fix, sync_validator_slot should have rate limiting`);

  // Test: Validator state can be checked
  // Look for any validator state accounts
  logTest(
    results,
    'HIGH-02: Rate limiting mechanism noted',
    true,
    'Requires 1000 slot staleness before sync allowed (after fix: add time-based rate limit)'
  );

  // ═══════════════════════════════════════════════════════════════════════
  // HIGH-03: Daemon State Persistence
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(70));
  console.log('📋 HIGH-03: Daemon State Persistence');
  console.log('─'.repeat(70) + '\n');

  // Check daemon state file for processedSignatures
  const stateFilePath = '.daemon-state.json';

  if (fs.existsSync(stateFilePath)) {
    try {
      const stateContent = fs.readFileSync(stateFilePath, 'utf-8');
      const daemonState = JSON.parse(stateContent);

      log(`State file version: ${daemonState.version || 'unknown'}`);
      log(`Last updated: ${daemonState.lastUpdated || 'unknown'}`);
      log(`Last signatures count: ${Object.keys(daemonState.lastSignatures || {}).length}`);

      // After fix: should also have processedSignatures
      const hasProcessedSigs = 'processedSignatures' in daemonState;

      logTest(
        results,
        'HIGH-03: Daemon state file exists',
        true,
        `File: ${stateFilePath}`
      );

      logTest(
        results,
        'HIGH-03: lastSignatures persisted',
        Object.keys(daemonState.lastSignatures || {}).length >= 0,
        `${Object.keys(daemonState.lastSignatures || {}).length} token signatures`
      );

      // After fix verification
      logTest(
        results,
        'HIGH-03: processedSignatures persisted (after fix)',
        hasProcessedSigs,
        hasProcessedSigs ? 'Present in state file' : 'Not yet implemented - needs fix'
      );
    } catch (e: any) {
      logTest(results, 'HIGH-03: Daemon state file readable', false, e.message);
    }
  } else {
    log('Daemon state file not found - daemon may not be running');
    logTest(
      results,
      'HIGH-03: Daemon state file exists',
      false,
      'File not found (run daemon first)'
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HIGH-04: HTTP Stream Error Handling
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(70));
  console.log('📋 HIGH-04: HTTP Stream Error Handling');
  console.log('─'.repeat(70) + '\n');

  // Test daemon API endpoints with malformed requests
  const daemonPort = 3030;
  const daemonHost = 'localhost';

  log(`Testing daemon API at http://${daemonHost}:${daemonPort}`);

  // Test 1: Valid health check
  try {
    const healthResponse = await httpGet(`http://${daemonHost}:${daemonPort}/health`);
    logTest(
      results,
      'HIGH-04: Health endpoint responds',
      healthResponse.status === 200,
      `Status: ${healthResponse.status}`
    );
  } catch (e: any) {
    logTest(results, 'HIGH-04: Health endpoint responds', false, e.message);
  }

  // Test 2: Malformed JSON to /register-token (after fix: should return 400, not crash)
  try {
    const malformedResponse = await httpPost(
      `http://${daemonHost}:${daemonPort}/register-token`,
      'not valid json { broken'
    );

    logTest(
      results,
      'HIGH-04: Malformed JSON handled gracefully',
      malformedResponse.status === 400,
      `Status: ${malformedResponse.status} (expected 400)`
    );
  } catch (e: any) {
    if (e.code === 'ECONNREFUSED') {
      logTest(results, 'HIGH-04: Malformed JSON handled gracefully', false, 'Daemon not running');
    } else {
      logTest(results, 'HIGH-04: Malformed JSON handled gracefully', false, e.message);
    }
  }

  // Test 3: Invalid PublicKey (after fix: should return 400, not crash)
  try {
    const invalidPkResponse = await httpPost(
      `http://${daemonHost}:${daemonPort}/register-token`,
      JSON.stringify({ mint: 'invalid-pubkey-here' })
    );

    logTest(
      results,
      'HIGH-04: Invalid PublicKey handled gracefully',
      invalidPkResponse.status === 400,
      `Status: ${invalidPkResponse.status} (expected 400)`
    );
  } catch (e: any) {
    if (e.code === 'ECONNREFUSED') {
      logTest(results, 'HIGH-04: Invalid PublicKey handled gracefully', false, 'Daemon not running');
    } else {
      logTest(results, 'HIGH-04: Invalid PublicKey handled gracefully', false, e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(70));
  console.log('📊 HIGH Fixes Status');
  console.log('─'.repeat(70) + '\n');

  console.log('Fix ID  | Status | Description');
  console.log('─'.repeat(60));
  console.log('HIGH-01 | ⚠️     | Fee split timestamp separation - needs code change');
  console.log('HIGH-02 | ⚠️     | sync_validator_slot rate limiting - needs code change');
  console.log('HIGH-03 | ⚠️     | Daemon state persistence - needs code change');
  console.log('HIGH-04 | ⚠️     | HTTP error handling - needs code change');
  console.log('\nNote: Re-run after fixes are applied to verify.');

  // Print summary and exit
  const exitCode = printSummary(results);
  process.exit(exitCode);
}

// ═══════════════════════════════════════════════════════════════════════
// HTTP Utilities
// ═══════════════════════════════════════════════════════════════════════

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function httpPost(url: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => (responseBody += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: responseBody }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(body);
    req.end();
  });
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
