/**
 * Test ASDev Integration
 *
 * Tests the ASDev integration library by:
 * 1. Checking if validators are initialized for existing tokens
 * 2. Querying contribution data
 * 3. Displaying a contribution leaderboard
 *
 * Usage:
 *   npx ts-node scripts/test-asdev-integration.ts [--network devnet|mainnet]
 */

import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { getNetworkConfig, printNetworkBanner } from '../lib/network-config';
import {
  isValidatorInitialized,
  getTokenContribution,
  getContributionLeaderboard,
  formatContribution,
  formatLeaderboard,
  deriveValidatorStatePDA,
  ASDF_PROGRAM_ID,
} from '../lib/asdev-integration';

interface TokenConfig {
  mint: string;
  symbol: string;
  name: string;
}

async function main() {
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  printNetworkBanner(networkConfig);
  console.log('🔧 TEST ASDEV INTEGRATION');
  console.log('='.repeat(70) + '\n');

  // Load connection
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
  console.log(`🌐 RPC: ${networkConfig.rpcUrl}`);
  console.log(`📦 Program: ${ASDF_PROGRAM_ID.toBase58()}\n`);

  // Load token configs
  const tokens: TokenConfig[] = [];

  for (const file of networkConfig.tokens) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        tokens.push({
          mint: data.mint,
          symbol: data.symbol || data.name || 'UNKNOWN',
          name: data.name,
        });
      } catch (error) {
        console.error(`Failed to load ${file}:`, error);
      }
    }
  }

  if (tokens.length === 0) {
    console.error('No tokens found');
    process.exit(1);
  }

  console.log(`📊 Testing ${tokens.length} token(s)\n`);
  console.log('-'.repeat(70));

  // Test 1: Check validator initialization status
  console.log('\n📋 TEST 1: Validator Initialization Status\n');

  const mints: PublicKey[] = [];

  for (const token of tokens) {
    const mint = new PublicKey(token.mint);
    mints.push(mint);

    const [validatorPDA] = deriveValidatorStatePDA(mint);
    const isInitialized = await isValidatorInitialized(connection, mint);

    console.log(`${token.symbol}:`);
    console.log(`   Mint: ${token.mint}`);
    console.log(`   Validator PDA: ${validatorPDA.toBase58()}`);
    console.log(`   Status: ${isInitialized ? '✅ Initialized' : '❌ Not initialized'}`);
    console.log('');
  }

  // Test 2: Get individual contributions
  console.log('-'.repeat(70));
  console.log('\n📋 TEST 2: Individual Token Contributions\n');

  for (const token of tokens) {
    const mint = new PublicKey(token.mint);
    const contribution = await getTokenContribution(connection, mint);

    console.log(`${token.symbol}:`);
    if (contribution) {
      console.log(formatContribution(contribution).split('\n').map(l => `   ${l}`).join('\n'));
    } else {
      console.log('   ❌ No contribution data (validator not initialized)');
    }
    console.log('');
  }

  // Test 3: Leaderboard
  console.log('-'.repeat(70));
  console.log('\n📋 TEST 3: Contribution Leaderboard\n');

  const leaderboard = await getContributionLeaderboard(connection, mints);
  console.log(formatLeaderboard(leaderboard));

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));

  const initializedCount = leaderboard.length;
  const totalFees = leaderboard.reduce((sum, c) => sum + c.totalFees, 0);

  console.log(`   Tokens tracked: ${initializedCount}/${tokens.length}`);
  console.log(`   Total fees accumulated: ${(totalFees / 1e9).toFixed(6)} SOL`);

  if (initializedCount < tokens.length) {
    console.log('\n⚠️  Some tokens need validator initialization.');
    console.log('   Run: npx ts-node scripts/initialize-validators.ts');
  }

  if (totalFees === 0 && initializedCount > 0) {
    console.log('\n💡 No fees recorded yet. The validator daemon needs to run');
    console.log('   and detect trading activity to register fees.');
    console.log('   Start daemon: npx ts-node scripts/start-validator.ts --verbose');
  }
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
