#!/usr/bin/env npx ts-node

/**
 * Test process_user_rebate instruction
 *
 * Processes rebate for an eligible user:
 * - Transfers rebate (0.552% of pending) from pool to user
 * - Resets pending_contribution to 0
 * - Updates total_contributed and total_rebate
 *
 * Usage:
 *   npx ts-node scripts/test-process-user-rebate.ts <user-pubkey> --network devnet
 *   npx ts-node scripts/test-process-user-rebate.ts --network devnet  # uses admin wallet as user
 */

import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";
import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";
import { getTypedAccounts } from "../lib/types";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

// PDA Seeds
const DAT_STATE_SEED = Buffer.from("dat_v3");
const REBATE_POOL_SEED = Buffer.from("rebate_pool");
const USER_STATS_SEED = Buffer.from("user_stats_v1");

// Threshold (0.07 SOL equiv = 70M lamports)
const REBATE_THRESHOLD = 70_000_000;

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

function loadIdl(): any {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  idl.metadata = { address: PROGRAM_ID.toString() };
  idl.address = PROGRAM_ID.toString();
  return idl;
}

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  // Get user pubkey from args or use admin
  // Filter out network flag and its value
  const nonFlagArgs = args.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (i > 0 && args[i-1] === '--network') return false;
    return true;
  });
  const userArg = nonFlagArgs.length > 0 ? nonFlagArgs[0] : null;

  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}  TEST: process_user_rebate${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  // User to process rebate for
  const user = userArg ? new PublicKey(userArg) : admin.publicKey;

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);
  log("👤", `User: ${user.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], PROGRAM_ID);
  const [rebatePool] = PublicKey.findProgramAddressSync([REBATE_POOL_SEED], PROGRAM_ID);
  const [userStats] = PublicKey.findProgramAddressSync(
    [USER_STATS_SEED, user.toBuffer()],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🏦", `Rebate Pool: ${rebatePool.toString()}`, colors.cyan);
  log("📊", `User Stats: ${userStats.toString()}`, colors.cyan);

  // Get ASDF mint from DAT state
  const state = await getTypedAccounts(program).datState.fetch(datState);
  const asdfMint = state.asdfMint;

  log("🪙", `ASDF Mint: ${asdfMint.toString()}`, colors.cyan);

  // Get ATAs
  const userAta = await getAssociatedTokenAddress(asdfMint, user);
  const rebatePoolAta = await getAssociatedTokenAddress(asdfMint, rebatePool, true);

  log("💰", `User ATA: ${userAta.toString()}`, colors.cyan);
  log("🎁", `Rebate Pool ATA: ${rebatePoolAta.toString()}`, colors.cyan);

  // Check user stats
  let userStatsAccount;
  try {
    userStatsAccount = await getTypedAccounts(program).userStats.fetch(userStats);
  } catch {
    log("❌", "User has no UserStats account! Need to deposit first.", colors.red);
    process.exit(1);
  }

  log("\n📊", "User Stats BEFORE:", colors.yellow);
  log("  ", `Pending: ${userStatsAccount.pendingContribution.toNumber() / 1e6} tokens`, colors.reset);
  log("  ", `Total Contributed: ${userStatsAccount.totalContributed.toNumber() / 1e6} tokens`, colors.reset);
  log("  ", `Total Rebate: ${userStatsAccount.totalRebate.toNumber() / 1e6} tokens`, colors.reset);

  // Check eligibility
  if (userStatsAccount.pendingContribution.toNumber() < REBATE_THRESHOLD) {
    log("\n❌", `User not eligible! Pending ${userStatsAccount.pendingContribution.toNumber()} < threshold ${REBATE_THRESHOLD}`, colors.red);
    process.exit(1);
  }

  // Calculate expected rebate
  const pending = userStatsAccount.pendingContribution.toNumber();
  const expectedRebate = Math.floor(pending * 55 / 10000); // 0.55%

  log("\n💰", `Expected rebate: ${expectedRebate / 1e6} tokens (0.55% of pending)`, colors.cyan);

  // Check rebate pool balance
  let rebatePoolBalance;
  try {
    const rebateAccount = await getAccount(connection, rebatePoolAta);
    rebatePoolBalance = Number(rebateAccount.amount);
    log("🏦", `Rebate pool balance: ${rebatePoolBalance / 1e6} tokens`, colors.cyan);
  } catch {
    log("❌", "Rebate pool ATA not found!", colors.red);
    process.exit(1);
  }

  if (rebatePoolBalance < expectedRebate) {
    log("❌", `Insufficient pool balance! ${rebatePoolBalance} < ${expectedRebate}`, colors.red);
    process.exit(1);
  }

  // Get user balance before
  let userBalanceBefore = BigInt(0);
  try {
    const userAccount = await getAccount(connection, userAta);
    userBalanceBefore = userAccount.amount;
  } catch { /* new account */ }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}  PROCESSING REBATE${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  try {
    const tx = await program.methods
      .processUserRebate()
      .accounts({
        datState,
        rebatePool,
        rebatePoolAta,
        userStats,
        user,
        userAta,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("✅", "REBATE PROCESSED!", colors.green);
    const cluster = networkConfig.name === "Mainnet" ? "" : "?cluster=devnet";
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}${cluster}`, colors.cyan);

    // Get updated stats
    const updatedUserStats = await getTypedAccounts(program).userStats.fetch(userStats);
    const userAccount = await getAccount(connection, userAta);
    const rebateAccount = await getAccount(connection, rebatePoolAta);

    log("\n📊", "User Stats AFTER:", colors.green);
    log("  ", `Pending: ${updatedUserStats.pendingContribution.toNumber() / 1e6} tokens`, colors.green);
    log("  ", `Total Contributed: ${updatedUserStats.totalContributed.toNumber() / 1e6} tokens`, colors.green);
    log("  ", `Total Rebate: ${updatedUserStats.totalRebate.toNumber() / 1e6} tokens`, colors.green);

    log("\n💰", "Balances AFTER:", colors.green);
    log("  ", `User: ${Number(userAccount.amount) / 1e6} tokens (+${(Number(userAccount.amount) - Number(userBalanceBefore)) / 1e6})`, colors.green);
    log("  ", `Rebate Pool: ${Number(rebateAccount.amount) / 1e6} tokens`, colors.green);

    log("\n🎉", "REBATE TEST COMPLETE!", colors.green);

  } catch (error: any) {
    log("❌", `Error: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-20).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
