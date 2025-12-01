#!/usr/bin/env ts-node
/**
 * Validate Creator Configs
 *
 * Compares token configs against on-chain data to ensure creator addresses
 * are correctly configured. This is critical for fee detection.
 *
 * Usage:
 *   npx ts-node scripts/validate-creator-configs.ts --network mainnet
 *   npx ts-node scripts/validate-creator-configs.ts --network devnet --verbose
 *
 * Exit codes:
 *   0 - All configs valid
 *   1 - One or more configs have mismatched creators
 */

import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import * as fs from 'fs';
import * as path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import { PUMP_PROGRAM, PUMPSWAP_PROGRAM, WSOL_MINT, PoolType } from '../lib/amm-utils';
import { getNetworkConfig, NetworkType, parseNetworkArg } from '../lib/network-config';

// ============================================================================
// Types
// ============================================================================

interface TokenConfig {
  mint: string;
  bondingCurve: string;
  pool: string;
  creator: string;
  isCTO?: boolean;
  name: string;
  symbol: string;
  poolType: PoolType;
  network: NetworkType;
}

interface ValidationResult {
  symbol: string;
  mint: string;
  configCreator: string;
  onchainCreator: string;
  isCTO: boolean;
  isValid: boolean;
  poolType: PoolType;
}

// ============================================================================
// Constants
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// ============================================================================
// PDA Derivation
// ============================================================================

function deriveBondingCurve(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_PROGRAM
  )[0];
}

function deriveAmmPool(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), mint.toBuffer(), WSOL_MINT.toBuffer()],
    PUMPSWAP_PROGRAM
  )[0];
}

// ============================================================================
// On-chain Creator Extraction
// ============================================================================

/**
 * Extract the active creator from on-chain pool data
 *
 * Bonding Curve: creator at offset 49
 * AMM (PumpSwap): coin_creator at 49, cto_creator at 211 (if CTO approved)
 */
async function getOnchainCreator(
  connection: Connection,
  mint: PublicKey,
  poolType: PoolType,
  poolAddress?: string
): Promise<{ creator: string; isCTO: boolean } | null> {
  try {
    if (poolType === 'bonding_curve') {
      const bc = deriveBondingCurve(mint);
      const info = await connection.getAccountInfo(bc);
      if (info && info.data.length >= 81) {
        const creator = new PublicKey(info.data.slice(49, 81));
        return { creator: creator.toBase58(), isCTO: false };
      }
    } else if (poolType === 'pumpswap_amm') {
      // Use pool address from config if available, otherwise derive
      const pool = poolAddress ? new PublicKey(poolAddress) : deriveAmmPool(mint);
      const info = await connection.getAccountInfo(pool);
      if (info && info.data.length >= 243) {
        const coinCreator = new PublicKey(info.data.slice(49, 81));
        const ctoCreator = new PublicKey(info.data.slice(211, 243));

        const hasCTO = !ctoCreator.equals(PublicKey.default);
        return {
          creator: hasCTO ? ctoCreator.toBase58() : coinCreator.toBase58(),
          isCTO: hasCTO,
        };
      }
    }
  } catch (error) {
    console.error(`${colors.red}Error reading on-chain data for ${mint.toBase58()}${colors.reset}`);
  }

  return null;
}

// ============================================================================
// Config Loading
// ============================================================================

function loadTokenConfigs(network: NetworkType): TokenConfig[] {
  const tokensDir = `${network}-tokens`;
  const configs: TokenConfig[] = [];

  if (!fs.existsSync(tokensDir)) {
    return configs;
  }

  const files = fs.readdirSync(tokensDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(tokensDir, file), 'utf-8'));
      if (config.mint && config.creator) {
        configs.push(config);
      }
    } catch {
      // Skip invalid files
    }
  }

  return configs;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const network = parseNetworkArg(args);
  const verbose = args.includes('--verbose') || args.includes('-v');

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           ASDF-DAT Creator Config Validator                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`Network: ${colors.cyan}${network}${colors.reset}\n`);

  // Load configs
  const configs = loadTokenConfigs(network);
  if (configs.length === 0) {
    console.log(`${colors.yellow}No token configs found in ${network}-tokens/${colors.reset}`);
    process.exit(0);
  }

  // Setup connection
  const networkConfig = getNetworkConfig(args);
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

  console.log(`Validating ${configs.length} token configs...\n`);

  // Validate each config
  const results: ValidationResult[] = [];
  let valid = 0;
  let invalid = 0;

  for (const config of configs) {
    const mintPubkey = new PublicKey(config.mint);
    const onchain = await getOnchainCreator(connection, mintPubkey, config.poolType, config.pool);

    if (!onchain) {
      console.log(
        `  ${colors.yellow}[?]${colors.reset} ${config.symbol} - Could not fetch on-chain data`
      );
      continue;
    }

    const isValid = config.creator === onchain.creator;
    const result: ValidationResult = {
      symbol: config.symbol,
      mint: config.mint,
      configCreator: config.creator,
      onchainCreator: onchain.creator,
      isCTO: onchain.isCTO,
      isValid,
      poolType: config.poolType,
    };

    results.push(result);

    if (isValid) {
      valid++;
      const ctoTag = onchain.isCTO ? ` ${colors.cyan}[CTO]${colors.reset}` : '';
      console.log(`  ${colors.green}[✓]${colors.reset} ${config.symbol}${ctoTag}`);
      if (verbose) {
        console.log(`${colors.dim}      Creator: ${config.creator.slice(0, 30)}...${colors.reset}`);
      }
    } else {
      invalid++;
      const ctoTag = onchain.isCTO ? ' [CTO]' : '';
      console.log(`  ${colors.red}[✗]${colors.reset} ${config.symbol}${ctoTag} - CREATOR MISMATCH`);
      console.log(`${colors.dim}      Config:  ${config.creator}${colors.reset}`);
      console.log(`${colors.red}      Onchain: ${onchain.creator}${colors.reset}`);
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(60));
  console.log(`\nSummary:`);
  console.log(`  Valid:   ${colors.green}${valid}${colors.reset}`);
  console.log(`  Invalid: ${invalid > 0 ? colors.red : colors.dim}${invalid}${colors.reset}`);
  console.log(`  Total:   ${results.length}`);

  if (invalid > 0) {
    console.log(`\n${colors.red}ERROR: ${invalid} config(s) have incorrect creator addresses.${colors.reset}`);
    console.log(`${colors.yellow}Fix the configs above and re-run validation.${colors.reset}`);
    console.log(`\n${colors.dim}Tip: To fix, update the 'creator' field in the JSON config files.${colors.reset}`);

    // Print fix suggestions
    console.log(`\n${colors.cyan}Suggested fixes:${colors.reset}`);
    for (const result of results.filter((r) => !r.isValid)) {
      const ctoNote = result.isCTO ? ' (CTO active)' : '';
      console.log(`\n  ${result.symbol}${ctoNote}:`);
      console.log(`    "creator": "${result.onchainCreator}"${result.isCTO ? ',' : ''}`);
      if (result.isCTO) {
        console.log(`    "isCTO": true`);
      }
    }

    process.exit(1);
  }

  console.log(`\n${colors.green}All configs are valid!${colors.reset}\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
