/**
 * ASDev Integration Example
 *
 * This example shows how a token launcher (like ASDev) would integrate
 * the ASDF Validator SDK to track per-token fee contributions.
 *
 * Flow:
 * 1. User launches token via ASDev → Pump.fun create_v2
 * 2. ASDev initializes ValidatorState for the new token
 * 3. Validator daemon tracks fees as token is traded
 * 4. ASDev queries contributions for leaderboard/rewards
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, Idl } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Import from the SDK
import {
  initializeValidatorForToken,
  initializeValidatorIfNeeded,
  isValidatorInitialized,
  getTokenContribution,
  getContributionLeaderboard,
  calculateProportionalDistribution,
  TokenContribution,
  TokenContributionWithPercentage,
  ASDF_PROGRAM_ID,
} from '../lib/asdev-integration';

// ============================================================================
// Example: Token Launch Integration
// ============================================================================

/**
 * Example: Initialize validator after launching a token
 *
 * Call this function right after a successful create_v2 on Pump.fun
 */
async function onTokenLaunched(
  program: Program,
  connection: Connection,
  mintAddress: string,
  bondingCurveAddress: string,
  payerPubkey: PublicKey
): Promise<void> {
  console.log('\n📤 Initializing validator for new token...');
  console.log(`   Mint: ${mintAddress}`);
  console.log(`   Bonding Curve: ${bondingCurveAddress}`);

  const mint = new PublicKey(mintAddress);
  const bondingCurve = new PublicKey(bondingCurveAddress);

  // Use initializeValidatorIfNeeded to handle the case where
  // validator might already exist (e.g., retry after failure)
  const tx = await initializeValidatorIfNeeded(
    program,
    connection,
    mint,
    bondingCurve,
    payerPubkey
  );

  if (tx) {
    console.log(`✅ Validator initialized! TX: ${tx}`);

    // Save token config to file for daemon to track
    await saveTokenConfig({
      mint: mintAddress,
      bondingCurve: bondingCurveAddress,
      symbol: 'NEW_TOKEN', // Get from your launch data
      creator: payerPubkey.toBase58(),
    });
  } else {
    console.log('ℹ️  Validator already initialized');
  }
}

/**
 * Save token config for daemon tracking
 */
async function saveTokenConfig(config: {
  mint: string;
  bondingCurve: string;
  symbol: string;
  creator: string;
}): Promise<void> {
  const tokensDir = './devnet-tokens'; // or mainnet-tokens

  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }

  const filename = `${config.symbol.toLowerCase()}.json`;
  const filePath = path.join(tokensDir, filename);

  const tokenConfig = {
    name: config.symbol,
    symbol: config.symbol,
    mint: config.mint,
    bondingCurve: config.bondingCurve,
    poolType: 'bonding_curve',
    creator: config.creator,
    isRoot: false,
  };

  fs.writeFileSync(filePath, JSON.stringify(tokenConfig, null, 2));
  console.log(`📝 Token config saved to ${filePath}`);
}

// ============================================================================
// Example: Query Contributions
// ============================================================================

/**
 * Example: Get contribution for a single token
 *
 * Use this for displaying individual token stats
 */
async function getTokenStats(
  connection: Connection,
  mintAddress: string
): Promise<TokenContribution | null> {
  const mint = new PublicKey(mintAddress);

  // First check if validator is initialized
  const isInit = await isValidatorInitialized(connection, mint);

  if (!isInit) {
    console.log(`⚠️  Token ${mintAddress} has no validator initialized`);
    return null;
  }

  const contribution = await getTokenContribution(connection, mint);

  if (contribution) {
    console.log('\n📊 Token Contribution:');
    console.log(`   Total Fees: ${contribution.totalFeesSOL.toFixed(6)} SOL`);
    console.log(`   Validations: ${contribution.validationCount}`);
    console.log(`   Last Slot: ${contribution.lastSlot}`);
  }

  return contribution;
}

/**
 * Example: Build leaderboard for multiple tokens
 *
 * Use this for displaying a contribution leaderboard
 */
async function buildLeaderboard(
  connection: Connection,
  tokenMints: string[]
): Promise<TokenContributionWithPercentage[]> {
  const mints = tokenMints.map(m => new PublicKey(m));

  const leaderboard = await getContributionLeaderboard(connection, mints);

  console.log('\n🏆 CONTRIBUTION LEADERBOARD');
  console.log('='.repeat(50));

  if (leaderboard.length === 0) {
    console.log('No contributions found');
    return [];
  }

  leaderboard.forEach((entry, index) => {
    console.log(
      `#${index + 1} | ${entry.mint.slice(0, 8)}... | ` +
      `${entry.totalFeesSOL.toFixed(6)} SOL | ` +
      `${entry.percentage.toFixed(1)}%`
    );
  });

  const totalFees = leaderboard.reduce((sum, e) => sum + e.totalFees, 0);
  console.log('='.repeat(50));
  console.log(`Total: ${(totalFees / 1e9).toFixed(6)} SOL`);

  return leaderboard;
}

// ============================================================================
// Example: Proportional Reward Distribution
// ============================================================================

/**
 * Example: Distribute rewards proportionally
 *
 * Use this when distributing airdrops or rewards based on contribution
 */
async function distributeRewards(
  connection: Connection,
  tokenMints: string[],
  totalRewardLamports: number
): Promise<Map<string, number>> {
  const mints = tokenMints.map(m => new PublicKey(m));

  // Get all contributions
  const contributionsMap = await import('../lib/asdev-integration')
    .then(m => m.getAllTokenContributions(connection, mints));

  // Calculate distribution
  const distribution = calculateProportionalDistribution(
    contributionsMap,
    totalRewardLamports
  );

  console.log('\n💰 REWARD DISTRIBUTION');
  console.log(`Total to distribute: ${(totalRewardLamports / 1e9).toFixed(6)} SOL`);
  console.log('='.repeat(50));

  for (const [mint, amount] of distribution) {
    const contribution = contributionsMap.get(mint);
    console.log(
      `${mint.slice(0, 8)}... | ` +
      `${(amount / 1e9).toFixed(6)} SOL | ` +
      `(${contribution?.percentage.toFixed(1)}%)`
    );
  }

  return distribution;
}

// ============================================================================
// Example: ASDev Server Integration
// ============================================================================

/**
 * Example: Express.js endpoint for token contribution
 *
 * Add this to your ASDev server.js
 */
function exampleExpressEndpoint(): void {
  console.log(`
// Add to your server.js:

const { getTokenContribution, isValidatorInitialized } = require('./lib/asdev-integration');

app.get('/api/token-contribution/:mint', async (req, res) => {
  try {
    const mint = new PublicKey(req.params.mint);

    const isInit = await isValidatorInitialized(connection, mint);
    if (!isInit) {
      return res.status(404).json({ error: 'Validator not initialized' });
    }

    const contribution = await getTokenContribution(connection, mint);
    if (!contribution) {
      return res.status(404).json({ error: 'Contribution not found' });
    }

    res.json({
      mint: contribution.mint,
      totalFees: contribution.totalFees,
      totalFeesSOL: contribution.totalFeesSOL,
      validationCount: contribution.validationCount,
      lastSlot: contribution.lastSlot,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    // Get all tracked token mints from your database
    const tokenMints = await getTrackedTokenMints();
    const mints = tokenMints.map(m => new PublicKey(m));

    const leaderboard = await getContributionLeaderboard(connection, mints);

    res.json({
      tokens: leaderboard.map(entry => ({
        mint: entry.mint,
        totalFees: entry.totalFees,
        totalFeesSOL: entry.totalFeesSOL,
        percentage: entry.percentage,
      })),
      totalFees: leaderboard.reduce((sum, e) => sum + e.totalFees, 0),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
`);
}

// ============================================================================
// Main Example Runner
// ============================================================================

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('🔥 ASDF VALIDATOR SDK - INTEGRATION EXAMPLE');
  console.log('='.repeat(60));

  // Setup connection
  const rpcUrl = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  console.log(`\nRPC: ${rpcUrl}`);

  // Example token mints (replace with your actual mints)
  const exampleMints = [
    '3UD2AL3x7Ytkv4H3yk7vGS1xk2Y2u3eJFc4GaSnbbwBZ', // FROOT
    '4BuSY2M8ReiApyFn12wnLKk6QSH87J8xTaBgx82J3n2R', // FS1
    'CerdPJtgtx5ns6UZRhTg7DJrBzHMDD3e9A7vV55Ma86D', // FS2
  ];

  // Demo: Get single token stats
  console.log('\n--- Demo: Get Token Stats ---');
  await getTokenStats(connection, exampleMints[0]);

  // Demo: Build leaderboard
  console.log('\n--- Demo: Build Leaderboard ---');
  await buildLeaderboard(connection, exampleMints);

  // Demo: Distribute rewards
  console.log('\n--- Demo: Distribute Rewards ---');
  const rewardAmount = 1_000_000_000; // 1 SOL
  await distributeRewards(connection, exampleMints, rewardAmount);

  // Show Express.js integration example
  console.log('\n--- Express.js Integration Example ---');
  exampleExpressEndpoint();

  console.log('\n' + '='.repeat(60));
  console.log('✅ Example completed!');
  console.log('='.repeat(60) + '\n');
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

// Export for use as module
export {
  onTokenLaunched,
  saveTokenConfig,
  getTokenStats,
  buildLeaderboard,
  distributeRewards,
};
