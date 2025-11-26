/**
 * Check Creator Vault Status
 *
 * Verifies the creator vault status for both Bonding Curve and AMM tokens.
 * - For Bonding Curve: Native SOL in creator-vault PDA
 * - For AMM: WSOL in creator_vault ATA
 */

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import fs from "fs";
import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";
import {
  PoolType,
  getBcCreatorVault,
  getAmmCreatorVaultAta,
  deriveAmmCreatorVaultAuthority,
} from "../lib/amm-utils";

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

async function main() {
  // Parse network argument
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  console.log("\n" + "=".repeat(60));
  console.log("🔍 CHECK CREATOR VAULT STATUS");
  console.log("=".repeat(60) + "\n");

  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  // Load token info - use token file from args or default from network config
  const tokenInfoPath = args.find(a => !a.startsWith('--')) || networkConfig.tokens[0];
  if (!fs.existsSync(tokenInfoPath)) {
    log("❌", `Token info not found: ${tokenInfoPath}`, colors.red);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const creator = new PublicKey(tokenInfo.creator);
  const poolType: PoolType = tokenInfo.poolType || 'bonding_curve';

  log("🪙", `Token: ${tokenInfo.symbol || tokenInfo.name || 'Unknown'}`, colors.cyan);
  log("🪙", `Mint: ${tokenMint.toString()}`, colors.cyan);
  log("👤", `Creator: ${creator.toString()}`, colors.cyan);
  log("🏊", `Pool Type: ${poolType}`, colors.cyan);

  console.log("\n" + "-".repeat(60) + "\n");

  if (poolType === 'bonding_curve') {
    // Bonding Curve: Native SOL vault
    await checkBondingCurveVault(connection, creator, tokenInfo);
  } else {
    // PumpSwap AMM: WSOL vault
    await checkAmmVault(connection, creator, tokenInfo);
  }
}

async function checkBondingCurveVault(
  connection: Connection,
  creator: PublicKey,
  tokenInfo: any
) {
  log("📦", "Checking BONDING CURVE vault (Native SOL)...", colors.cyan);

  // Derive vault PDA
  const vaultAddress = getBcCreatorVault(creator);
  log("🔑", `Vault Address: ${vaultAddress.toString()}`, colors.cyan);

  console.log("\n" + "=".repeat(60));
  console.log("📊 VAULT STATUS (Native SOL)");
  console.log("=".repeat(60) + "\n");

  try {
    const balance = await connection.getBalance(vaultAddress);

    if (balance > 0) {
      log("✅", "Creator Vault has fees!", colors.green);
      log("💰", `Balance: ${(balance / 1e9).toFixed(6)} SOL`, colors.green);
      log("🎉", "Ready to collect fees via collect_fees instruction", colors.green);
    } else {
      log("⚠️", "Creator Vault exists but has no fees", colors.yellow);
      log("💰", `Balance: 0 SOL`, colors.yellow);
      log("📝", "Make trades to accumulate fees", colors.yellow);
    }
  } catch (error: any) {
    log("❌", `Error checking vault: ${error.message}`, colors.red);
    process.exit(1);
  }

  showNextSteps('bonding_curve', tokenInfo);
}

async function checkAmmVault(
  connection: Connection,
  creator: PublicKey,
  tokenInfo: any
) {
  log("📦", "Checking PUMPSWAP AMM vault (WSOL)...", colors.cyan);

  // Derive vault authority PDA
  const [vaultAuthority] = deriveAmmCreatorVaultAuthority(creator);
  log("🔑", `Vault Authority: ${vaultAuthority.toString()}`, colors.cyan);

  // Get the WSOL ATA for this authority
  const vaultAta = getAmmCreatorVaultAta(creator);
  log("🏦", `Vault ATA (WSOL): ${vaultAta.toString()}`, colors.cyan);

  console.log("\n" + "=".repeat(60));
  console.log("📊 VAULT STATUS (WSOL Token Account)");
  console.log("=".repeat(60) + "\n");

  try {
    const account = await getAccount(connection, vaultAta);

    if (Number(account.amount) > 0) {
      log("✅", "Creator Vault has fees!", colors.green);
      log("💰", `Balance: ${(Number(account.amount) / 1e9).toFixed(6)} WSOL`, colors.green);
      log("🎉", "Ready to collect fees via collect_fees_amm instruction", colors.green);
    } else {
      log("⚠️", "Creator Vault exists but has no fees", colors.yellow);
      log("💰", `Balance: 0 WSOL`, colors.yellow);
      log("📝", "Make trades on PumpSwap AMM to accumulate fees", colors.yellow);
    }
  } catch (error: any) {
    if (error.name === 'TokenAccountNotFoundError') {
      log("⚠️", "Creator Vault WSOL ATA not yet created", colors.yellow);
      log("📝", "The ATA will be created when first fees are deposited", colors.yellow);
    } else {
      log("❌", `Error checking vault: ${error.message}`, colors.red);
    }
  }

  showNextSteps('pumpswap_amm', tokenInfo);
}

function showNextSteps(poolType: PoolType, tokenInfo: any) {
  console.log("\n" + "=".repeat(60));
  console.log("📋 NEXT STEPS");
  console.log("=".repeat(60) + "\n");

  if (poolType === 'bonding_curve') {
    log("1️⃣", "To generate fees: Make buy/sell trades on PumpFun", colors.cyan);
    log("2️⃣", "To collect fees: Use collect_fees instruction", colors.cyan);
    log("3️⃣", "To run cycle: npx ts-node scripts/execute-cycle-root.ts", colors.cyan);
  } else {
    log("1️⃣", "To generate fees: Make buy/sell trades on PumpSwap AMM", colors.cyan);
    log("2️⃣", "To collect fees: Use collect_fees_amm instruction", colors.cyan);
    log("3️⃣", "After collection: Use unwrap_wsol to convert to native SOL", colors.cyan);
    log("4️⃣", "To run cycle: npx ts-node scripts/execute-cycle-root.ts", colors.cyan);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
