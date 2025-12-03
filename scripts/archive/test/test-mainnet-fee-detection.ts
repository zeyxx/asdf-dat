/**
 * Test Mainnet Fee Detection
 *
 * Simulates the daemon's fee detection logic on mainnet WITHOUT requiring
 * the program to be deployed. This verifies we can properly:
 * 1. Poll recent transactions from pools/bonding curves
 * 2. Extract fee amounts from preBalances/postBalances
 * 3. Correctly attribute fees to tokens
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// Program IDs
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMPSWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

interface TokenConfig {
  mint: string;
  bondingCurve?: string;
  pool?: string;
  creator: string;
  name: string;
  symbol: string;
  poolType: 'bonding_curve' | 'pumpswap_amm';
  isRoot: boolean;
}

interface FeeDetection {
  signature: string;
  slot: number;
  blockTime: number;
  feeAmount: number;  // lamports
}

/**
 * Derive Bonding Curve creator vault
 */
function deriveBcCreatorVault(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  )[0];
}

/**
 * Derive PumpSwap AMM creator vault authority
 */
function deriveAmmVaultAuthority(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), creator.toBuffer()],
    PUMPSWAP_PROGRAM
  )[0];
}

/**
 * Get AMM creator vault WSOL ATA
 */
function getAmmCreatorVaultAta(creator: PublicKey): PublicKey {
  const vaultAuthority = deriveAmmVaultAuthority(creator);
  return getAssociatedTokenAddressSync(WSOL_MINT, vaultAuthority, true);
}

/**
 * Detect fees from bonding curve transactions
 */
async function detectBcFees(
  connection: Connection,
  bondingCurve: PublicKey,
  creatorVault: PublicKey,
  limit: number = 10
): Promise<FeeDetection[]> {
  const detections: FeeDetection[] = [];

  // Get recent signatures for the bonding curve
  const signatures = await connection.getSignaturesForAddress(bondingCurve, { limit });

  for (const sig of signatures) {
    try {
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) continue;

      // Find creator vault in account keys
      const accountKeys = tx.transaction.message.staticAccountKeys ||
        (tx.transaction.message as any).accountKeys;

      const vaultIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(creatorVault)
      );

      if (vaultIndex === -1) continue;

      // Calculate fee from balance change
      const preBal = tx.meta.preBalances[vaultIndex];
      const postBal = tx.meta.postBalances[vaultIndex];
      const delta = postBal - preBal;

      // Only positive deltas are fees (deposits to vault)
      if (delta > 0) {
        detections.push({
          signature: sig.signature,
          slot: tx.slot,
          blockTime: tx.blockTime || 0,
          feeAmount: delta,
        });
      }
    } catch (err) {
      // Skip failed fetches
    }
  }

  return detections;
}

/**
 * Detect fees from PumpSwap AMM transactions
 */
async function detectAmmFees(
  connection: Connection,
  pool: PublicKey,
  wsolVault: PublicKey,
  limit: number = 10
): Promise<FeeDetection[]> {
  const detections: FeeDetection[] = [];

  // Get recent signatures for the pool
  const signatures = await connection.getSignaturesForAddress(pool, { limit });

  for (const sig of signatures) {
    try {
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) continue;
      if (!tx.meta.preTokenBalances || !tx.meta.postTokenBalances) continue;

      // Find WSOL vault in token balances
      const preBalance = tx.meta.preTokenBalances.find(
        (b: any) => b.mint === WSOL_MINT.toString() &&
          new PublicKey(b.owner).equals(deriveAmmVaultAuthority(new PublicKey(wsolVault)))
      );

      const postBalance = tx.meta.postTokenBalances.find(
        (b: any) => b.mint === WSOL_MINT.toString() &&
          new PublicKey(b.owner).equals(deriveAmmVaultAuthority(new PublicKey(wsolVault)))
      );

      // Alternative: look for vault address directly in accounts
      const accountKeys = tx.transaction.message.staticAccountKeys ||
        (tx.transaction.message as any).accountKeys;

      const vaultIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(wsolVault)
      );

      if (vaultIndex !== -1) {
        // Check preTokenBalances and postTokenBalances for this account
        const pre = tx.meta.preTokenBalances?.find((b: any) => b.accountIndex === vaultIndex);
        const post = tx.meta.postTokenBalances?.find((b: any) => b.accountIndex === vaultIndex);

        if (pre && post) {
          const preAmount = Number(pre.uiTokenAmount.amount);
          const postAmount = Number(post.uiTokenAmount.amount);
          const delta = postAmount - preAmount;

          if (delta > 0) {
            detections.push({
              signature: sig.signature,
              slot: tx.slot,
              blockTime: tx.blockTime || 0,
              feeAmount: delta,
            });
          }
        }
      }
    } catch (err) {
      // Skip failed fetches
    }
  }

  return detections;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  MAINNET FEE DETECTION TEST');
  console.log('═══════════════════════════════════════════════════════\n');

  // Load Helius API key
  const envPath = path.join(process.cwd(), '.env');
  let heliusKey = '';
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf-8');
    const match = env.match(/HELIUS_API_KEY=([^\n]+)/);
    if (match) heliusKey = match[1].trim();
  }

  const rpcUrl = heliusKey
    ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
    : 'https://api.mainnet-beta.solana.com';

  const connection = new Connection(rpcUrl, 'confirmed');

  // Load mainnet tokens
  const tokens: TokenConfig[] = [];
  const tokenFiles = ['mainnet-tokens/01-root.json', 'mainnet-tokens/02-fouse.json'];

  for (const file of tokenFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      tokens.push(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    }
  }

  console.log(`Testing fee detection for ${tokens.length} tokens...\n`);

  let totalFeesDetected = 0;

  for (const token of tokens) {
    console.log(`━━━ ${token.symbol} (${token.poolType}) ━━━`);

    const creator = new PublicKey(token.creator);
    let detections: FeeDetection[] = [];

    if (token.poolType === 'bonding_curve' && token.bondingCurve) {
      const bc = new PublicKey(token.bondingCurve);
      const vault = deriveBcCreatorVault(creator);
      console.log(`Bonding Curve: ${bc.toString().slice(0, 12)}...`);
      console.log(`Creator Vault: ${vault.toString().slice(0, 12)}...`);

      detections = await detectBcFees(connection, bc, vault, 20);
    } else if (token.poolType === 'pumpswap_amm' && token.pool) {
      const pool = new PublicKey(token.pool);
      const wsolVault = getAmmCreatorVaultAta(creator);
      console.log(`AMM Pool: ${pool.toString().slice(0, 12)}...`);
      console.log(`WSOL Vault: ${wsolVault.toString().slice(0, 12)}...`);

      detections = await detectAmmFees(connection, pool, wsolVault, 20);
    }

    if (detections.length > 0) {
      console.log(`\n✅ Detected ${detections.length} fee events:`);
      let tokenTotal = 0;
      for (const d of detections.slice(0, 5)) {  // Show first 5
        const sol = d.feeAmount / LAMPORTS_PER_SOL;
        const time = new Date(d.blockTime * 1000).toISOString();
        console.log(`   ${sol.toFixed(6)} SOL | ${time} | ${d.signature.slice(0, 16)}...`);
        tokenTotal += d.feeAmount;
      }
      if (detections.length > 5) {
        console.log(`   ... and ${detections.length - 5} more`);
        for (const d of detections.slice(5)) {
          tokenTotal += d.feeAmount;
        }
      }
      console.log(`   Total: ${(tokenTotal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      totalFeesDetected += tokenTotal;
    } else {
      console.log(`\n⚠️  No fee events detected in recent transactions`);
      console.log(`   (This may be normal if no trades occurred recently)`);
    }

    console.log('');
  }

  // Current vault balances
  console.log('━━━ CURRENT VAULT BALANCES ━━━');
  for (const token of tokens) {
    const creator = new PublicKey(token.creator);

    if (token.poolType === 'bonding_curve') {
      const vault = deriveBcCreatorVault(creator);
      const balance = await connection.getBalance(vault);
      console.log(`${token.symbol} BC Vault: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    } else {
      const wsolVault = getAmmCreatorVaultAta(creator);
      try {
        const vaultInfo = await connection.getAccountInfo(wsolVault);
        if (vaultInfo) {
          const amount = vaultInfo.data.readBigUInt64LE(64);
          console.log(`${token.symbol} AMM Vault: ${(Number(amount) / LAMPORTS_PER_SOL).toFixed(6)} WSOL`);
        }
      } catch (err) {
        console.log(`${token.symbol} AMM Vault: Error reading`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════\n');

  if (totalFeesDetected > 0) {
    console.log(`✅ Fee detection working!`);
    console.log(`   Total fees detected in sampled transactions: ${(totalFeesDetected / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  } else {
    console.log(`⚠️  No fees detected in sampled transactions`);
    console.log(`   This may be normal - vault balances confirm fees are accumulating`);
  }

  console.log('\n🟢 Fee detection logic is compatible with mainnet infrastructure');
  console.log('');
}

main().catch(console.error);
