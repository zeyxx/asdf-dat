#!/usr/bin/env ts-node
/**
 * Admin Transfer Two-Step Flow Test
 *
 * Tests the two-step admin transfer pattern:
 * 1. Admin proposes new admin
 * 2. Verify pending_admin is set
 * 3. New admin accepts (or current admin cancels)
 * 4. Verify admin changed / cancelled
 * 5. Test rejection of accept from wrong signer
 *
 * Usage: npx ts-node scripts/test-admin-transfer.ts --network devnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import BN from 'bn.js';
import {
  log,
  logTest,
  sleep,
  setupProvider,
  derivePDAs,
  printSummary,
  loadIdl,
  TestResult,
  PROGRAM_ID,
} from '../lib/test-utils';
import { getTypedAccounts } from '../lib/types';

const results: TestResult[] = [];

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('👤 Admin Transfer Two-Step Flow Test');
  console.log('═'.repeat(70) + '\n');

  // Parse args
  const args = process.argv.slice(2);
  const networkArg = args.find((a) => a.startsWith('--network=')) || args[args.indexOf('--network') + 1];
  const network = (networkArg || 'devnet') as 'devnet' | 'mainnet';

  log(`Network: ${network}`);

  // Setup
  const { connection, program, adminKeypair } = setupProvider(network);
  const accounts = getTypedAccounts(program);
  const pdas = derivePDAs();

  log(`Current Admin: ${adminKeypair.publicKey.toBase58()}`);

  // Generate a test keypair for new admin
  const newAdminKeypair = Keypair.generate();
  log(`Test New Admin: ${newAdminKeypair.publicKey.toBase58()}`);

  // Generate another keypair for "wrong signer" test
  const wrongSignerKeypair = Keypair.generate();
  log(`Wrong Signer: ${wrongSignerKeypair.publicKey.toBase58()}`);

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 1: Verify Initial State');
  console.log('─'.repeat(70) + '\n');

  // Check initial state
  const initialState = await accounts.datState.fetch(pdas.datState);
  log(`Initial admin: ${initialState.admin.toBase58()}`);
  log(`Pending admin: ${initialState.pendingAdmin ? initialState.pendingAdmin.toBase58() : 'None'}`);

  const adminMatches = initialState.admin.equals(adminKeypair.publicKey);
  logTest(results, 'Current admin verified', adminMatches, initialState.admin.toBase58().slice(0, 20) + '...');

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 2: Propose New Admin');
  console.log('─'.repeat(70) + '\n');

  // Propose admin transfer
  try {
    const tx = await (program.methods as any)
      .proposeAdminTransfer(newAdminKeypair.publicKey)
      .accounts({
        datState: pdas.datState,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    log(`Propose TX: ${tx}`);
    await sleep(2000);

    // Verify pending_admin is set
    const stateAfterPropose = await accounts.datState.fetch(pdas.datState);
    const pendingSet = stateAfterPropose.pendingAdmin?.equals(newAdminKeypair.publicKey) || false;

    log(`Pending admin: ${stateAfterPropose.pendingAdmin?.toBase58() || 'None'}`);
    logTest(results, 'Propose admin transfer', pendingSet, `pending_admin = ${newAdminKeypair.publicKey.toBase58().slice(0, 20)}...`);
  } catch (e: any) {
    logTest(results, 'Propose admin transfer', false, e.message?.slice(0, 100));
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 3: Test Reject Accept from Wrong Signer');
  console.log('─'.repeat(70) + '\n');

  // Try to accept with wrong signer (should fail)
  try {
    // Fund wrong signer for tx fees
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: adminKeypair.publicKey,
        toPubkey: wrongSignerKeypair.publicKey,
        lamports: 10_000_000, // 0.01 SOL
      })
    );
    await sendAndConfirmTransaction(connection, fundTx, [adminKeypair]);

    // Try accept with wrong signer
    await (program.methods as any)
      .acceptAdminTransfer()
      .accounts({
        datState: pdas.datState,
        pendingAdmin: wrongSignerKeypair.publicKey,
      })
      .signers([wrongSignerKeypair])
      .rpc();

    logTest(results, 'Reject wrong signer accept', false, 'Should have failed but succeeded');
  } catch (e: any) {
    const expectedError = e.message?.includes('Unauthorized') || e.message?.includes('constraint') || e.logs?.some((l: string) => l.includes('Unauthorized'));
    logTest(
      results,
      'Reject wrong signer accept',
      expectedError,
      expectedError ? 'Correctly rejected unauthorized accept' : e.message?.slice(0, 80)
    );
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 4: Cancel Pending Transfer');
  console.log('─'.repeat(70) + '\n');

  // Admin cancels the transfer
  try {
    const tx = await (program.methods as any)
      .cancelAdminTransfer()
      .accounts({
        datState: pdas.datState,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    log(`Cancel TX: ${tx}`);
    await sleep(2000);

    // Verify pending_admin is cleared
    const stateAfterCancel = await accounts.datState.fetch(pdas.datState);
    const pendingCleared = !stateAfterCancel.pendingAdmin;

    log(`Pending admin after cancel: ${stateAfterCancel.pendingAdmin?.toBase58() || 'None'}`);
    logTest(results, 'Cancel admin transfer', pendingCleared, 'pending_admin cleared');
  } catch (e: any) {
    logTest(results, 'Cancel admin transfer', false, e.message?.slice(0, 100));
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 5: Propose and Accept Transfer');
  console.log('─'.repeat(70) + '\n');

  // Fund new admin for accepting
  try {
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: adminKeypair.publicKey,
        toPubkey: newAdminKeypair.publicKey,
        lamports: 10_000_000, // 0.01 SOL
      })
    );
    await sendAndConfirmTransaction(connection, fundTx, [adminKeypair]);
    log(`Funded new admin with 0.01 SOL`);
  } catch (e: any) {
    log(`Failed to fund new admin: ${e.message}`);
  }

  // Propose again
  try {
    await (program.methods as any)
      .proposeAdminTransfer(newAdminKeypair.publicKey)
      .accounts({
        datState: pdas.datState,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    log(`Re-proposed admin transfer`);
    await sleep(2000);
  } catch (e: any) {
    log(`Re-propose failed: ${e.message?.slice(0, 100)}`);
  }

  // Accept transfer as new admin
  try {
    const tx = await (program.methods as any)
      .acceptAdminTransfer()
      .accounts({
        datState: pdas.datState,
        pendingAdmin: newAdminKeypair.publicKey,
      })
      .signers([newAdminKeypair])
      .rpc();

    log(`Accept TX: ${tx}`);
    await sleep(2000);

    // Verify admin changed
    const stateAfterAccept = await accounts.datState.fetch(pdas.datState);
    const adminChanged = stateAfterAccept.admin.equals(newAdminKeypair.publicKey);
    const pendingCleared = !stateAfterAccept.pendingAdmin;

    log(`New admin: ${stateAfterAccept.admin.toBase58()}`);
    log(`Pending admin: ${stateAfterAccept.pendingAdmin?.toBase58() || 'None'}`);

    logTest(
      results,
      'Accept admin transfer',
      adminChanged && pendingCleared,
      `admin=${newAdminKeypair.publicKey.toBase58().slice(0, 20)}...`
    );
  } catch (e: any) {
    logTest(results, 'Accept admin transfer', false, e.message?.slice(0, 100));
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 6: Restore Original Admin');
  console.log('─'.repeat(70) + '\n');

  // Transfer back to original admin
  try {
    // Propose transfer back
    await (program.methods as any)
      .proposeAdminTransfer(adminKeypair.publicKey)
      .accounts({
        datState: pdas.datState,
        admin: newAdminKeypair.publicKey,
      })
      .signers([newAdminKeypair])
      .rpc();

    log(`Proposed transfer back to original admin`);
    await sleep(2000);

    // Accept as original admin
    await (program.methods as any)
      .acceptAdminTransfer()
      .accounts({
        datState: pdas.datState,
        pendingAdmin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    log(`Accepted transfer back`);
    await sleep(2000);

    // Verify restored
    const finalState = await accounts.datState.fetch(pdas.datState);
    const restored = finalState.admin.equals(adminKeypair.publicKey);

    logTest(results, 'Restore original admin', restored, `admin=${adminKeypair.publicKey.toBase58().slice(0, 20)}...`);
  } catch (e: any) {
    logTest(results, 'Restore original admin', false, e.message?.slice(0, 100));
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📋 Phase 7: Test Cancel Without Pending');
  console.log('─'.repeat(70) + '\n');

  // Try to cancel when no pending transfer (should fail with specific error)
  try {
    await (program.methods as any)
      .cancelAdminTransfer()
      .accounts({
        datState: pdas.datState,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    logTest(results, 'Cancel without pending fails', false, 'Should have failed');
  } catch (e: any) {
    const expectedError = e.message?.includes('NoPendingAdminTransfer') || e.logs?.some((l: string) => l.includes('NoPendingAdminTransfer'));
    logTest(
      results,
      'Cancel without pending fails',
      expectedError,
      expectedError ? 'Correctly returned NoPendingAdminTransfer' : e.message?.slice(0, 80)
    );
  }

  // Print summary and exit
  const exitCode = printSummary(results);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
