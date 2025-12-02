/**
 * Verify Mainnet Infrastructure
 *
 * Tests that all mainnet infrastructure is accessible BEFORE deploying the program.
 * This includes:
 * 1. Creator vault derivation and existence
 * 2. Token mint verification
 * 3. Pool/bonding curve verification
 * 4. RPC connectivity
 * 5. Recent trades detection (if any)
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
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

interface VerificationResult {
  token: string;
  symbol: string;
  checks: {
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
  }[];
}

/**
 * Derive Bonding Curve creator vault
 * Seeds: ["creator-vault", creator] (with HYPHEN)
 */
function deriveBcCreatorVault(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  )[0];
}

/**
 * Derive PumpSwap AMM creator vault authority
 * Seeds: ["creator_vault", creator] (with UNDERSCORE)
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

async function verifyToken(
  connection: Connection,
  config: TokenConfig
): Promise<VerificationResult> {
  const result: VerificationResult = {
    token: config.mint,
    symbol: config.symbol,
    checks: [],
  };

  const creator = new PublicKey(config.creator);
  const mint = new PublicKey(config.mint);

  // 1. Verify mint exists
  try {
    const mintInfo = await connection.getAccountInfo(mint);
    if (mintInfo) {
      result.checks.push({
        name: 'Mint exists',
        status: 'pass',
        message: `Owner: ${mintInfo.owner.toString().slice(0, 8)}...`,
      });
    } else {
      result.checks.push({
        name: 'Mint exists',
        status: 'fail',
        message: 'Mint account not found',
      });
    }
  } catch (err: any) {
    result.checks.push({
      name: 'Mint exists',
      status: 'fail',
      message: err.message,
    });
  }

  // 2. Verify pool/bonding curve exists
  const poolAddress = config.poolType === 'pumpswap_amm'
    ? config.pool
    : config.bondingCurve;

  if (poolAddress) {
    try {
      const poolInfo = await connection.getAccountInfo(new PublicKey(poolAddress));
      if (poolInfo) {
        result.checks.push({
          name: `${config.poolType === 'pumpswap_amm' ? 'AMM Pool' : 'Bonding Curve'} exists`,
          status: 'pass',
          message: `Balance: ${(poolInfo.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
        });
      } else {
        result.checks.push({
          name: 'Pool/BC exists',
          status: 'fail',
          message: 'Account not found',
        });
      }
    } catch (err: any) {
      result.checks.push({
        name: 'Pool/BC exists',
        status: 'fail',
        message: err.message,
      });
    }
  }

  // 3. Verify creator vault exists and has balance
  if (config.poolType === 'bonding_curve') {
    const vault = deriveBcCreatorVault(creator);
    try {
      const vaultInfo = await connection.getAccountInfo(vault);
      if (vaultInfo) {
        const balance = vaultInfo.lamports / LAMPORTS_PER_SOL;
        result.checks.push({
          name: 'BC Creator Vault',
          status: balance > 0 ? 'pass' : 'warn',
          message: `${vault.toString().slice(0, 8)}... | Balance: ${balance.toFixed(6)} SOL`,
        });
      } else {
        result.checks.push({
          name: 'BC Creator Vault',
          status: 'warn',
          message: `${vault.toString().slice(0, 8)}... | Not initialized (no trades yet?)`,
        });
      }
    } catch (err: any) {
      result.checks.push({
        name: 'BC Creator Vault',
        status: 'fail',
        message: err.message,
      });
    }
  } else {
    // PumpSwap AMM - vault is WSOL ATA
    const vaultAuthority = deriveAmmVaultAuthority(creator);
    const vaultAta = getAmmCreatorVaultAta(creator);

    try {
      // Check vault authority
      result.checks.push({
        name: 'AMM Vault Authority',
        status: 'pass',
        message: `${vaultAuthority.toString().slice(0, 8)}...`,
      });

      // Check WSOL ATA
      const ataInfo = await connection.getAccountInfo(vaultAta);
      if (ataInfo) {
        // Parse token account data to get balance
        const data = ataInfo.data;
        // Token account layout: mint (32) + owner (32) + amount (8)
        const amount = data.readBigUInt64LE(64);
        const balance = Number(amount) / LAMPORTS_PER_SOL;

        result.checks.push({
          name: 'AMM WSOL Vault',
          status: balance > 0 ? 'pass' : 'warn',
          message: `${vaultAta.toString().slice(0, 8)}... | Balance: ${balance.toFixed(6)} WSOL`,
        });
      } else {
        result.checks.push({
          name: 'AMM WSOL Vault',
          status: 'warn',
          message: `${vaultAta.toString().slice(0, 8)}... | Not initialized (no trades yet?)`,
        });
      }
    } catch (err: any) {
      result.checks.push({
        name: 'AMM Vault',
        status: 'fail',
        message: err.message,
      });
    }
  }

  // 4. Check for recent transactions on the pool/BC
  const targetAddress = config.poolType === 'pumpswap_amm'
    ? config.pool
    : config.bondingCurve;

  if (targetAddress) {
    try {
      const signatures = await connection.getSignaturesForAddress(
        new PublicKey(targetAddress),
        { limit: 5 }
      );

      if (signatures.length > 0) {
        const latest = signatures[0];
        const age = Date.now() / 1000 - (latest.blockTime || 0);
        const ageStr = age < 3600
          ? `${Math.floor(age / 60)} min ago`
          : age < 86400
            ? `${Math.floor(age / 3600)} hours ago`
            : `${Math.floor(age / 86400)} days ago`;

        result.checks.push({
          name: 'Recent Activity',
          status: 'pass',
          message: `${signatures.length} recent tx | Latest: ${ageStr}`,
        });
      } else {
        result.checks.push({
          name: 'Recent Activity',
          status: 'warn',
          message: 'No recent transactions found',
        });
      }
    } catch (err: any) {
      result.checks.push({
        name: 'Recent Activity',
        status: 'warn',
        message: `Could not fetch: ${err.message}`,
      });
    }
  }

  return result;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  MAINNET INFRASTRUCTURE VERIFICATION');
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

  console.log(`RPC: ${rpcUrl.includes('helius') ? 'Helius Mainnet' : 'Public Mainnet'}\n`);

  const connection = new Connection(rpcUrl, 'confirmed');

  // Test RPC connectivity
  console.log('━━━ RPC HEALTH ━━━');
  try {
    const slot = await connection.getSlot();
    console.log(`✅ Current Slot: ${slot}`);

    const version = await connection.getVersion();
    console.log(`✅ Solana Version: ${version['solana-core']}`);

    const blockHeight = await connection.getBlockHeight();
    console.log(`✅ Block Height: ${blockHeight}\n`);
  } catch (err: any) {
    console.log(`❌ RPC Error: ${err.message}\n`);
    process.exit(1);
  }

  // Load mainnet tokens
  const tokenFiles = [
    'mainnet-tokens/01-root.json',
    'mainnet-tokens/02-fouse.json',
  ];

  const tokens: TokenConfig[] = [];
  for (const file of tokenFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      tokens.push(config);
    }
  }

  if (tokens.length === 0) {
    console.log('❌ No mainnet token configs found\n');
    process.exit(1);
  }

  console.log(`Found ${tokens.length} mainnet tokens to verify\n`);

  // Verify each token
  const results: VerificationResult[] = [];
  for (const token of tokens) {
    console.log(`━━━ ${token.symbol} (${token.isRoot ? 'ROOT' : 'SECONDARY'}) ━━━`);
    console.log(`Mint: ${token.mint}`);
    console.log(`Creator: ${token.creator}`);
    console.log(`Pool Type: ${token.poolType}`);

    const result = await verifyToken(connection, token);
    results.push(result);

    for (const check of result.checks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
      console.log(`${icon} ${check.name}: ${check.message}`);
    }
    console.log('');
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════\n');

  let totalPass = 0;
  let totalWarn = 0;
  let totalFail = 0;

  for (const result of results) {
    for (const check of result.checks) {
      if (check.status === 'pass') totalPass++;
      else if (check.status === 'warn') totalWarn++;
      else totalFail++;
    }
  }

  console.log(`✅ Passed: ${totalPass}`);
  console.log(`⚠️  Warnings: ${totalWarn}`);
  console.log(`❌ Failed: ${totalFail}`);
  console.log('');

  if (totalFail === 0) {
    console.log('🟢 Infrastructure ready for program deployment');
  } else {
    console.log('🔴 Issues found - review before deploying');
  }
  console.log('');

  // Print vault addresses for reference
  console.log('━━━ CREATOR VAULT ADDRESSES ━━━');
  for (const token of tokens) {
    const creator = new PublicKey(token.creator);
    if (token.poolType === 'bonding_curve') {
      const vault = deriveBcCreatorVault(creator);
      console.log(`${token.symbol} (BC): ${vault.toString()}`);
    } else {
      const vaultAuthority = deriveAmmVaultAuthority(creator);
      const vaultAta = getAmmCreatorVaultAta(creator);
      console.log(`${token.symbol} (AMM Authority): ${vaultAuthority.toString()}`);
      console.log(`${token.symbol} (AMM WSOL ATA): ${vaultAta.toString()}`);
    }
  }
  console.log('');
}

main().catch(console.error);
