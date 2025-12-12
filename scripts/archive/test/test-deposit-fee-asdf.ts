#!/usr/bin/env npx ts-node

/**
 * Test deposit_fee_asdf instruction
 *
 * Simulates an external app depositing $ASDF tokens:
 * - 99.448% → DAT ATA (for burn)
 * - 0.552% → Rebate Pool ATA (for rebates)
 * - UserStats created/updated with pending contribution
 *
 * Usage:
 *   npx ts-node scripts/test-deposit-fee-asdf.ts --network devnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";
import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";
import { getTypedAccounts } from "../lib/types";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

// PDA Seeds
const DAT_STATE_SEED = Buffer.from("dat_v3");
const DAT_AUTHORITY_SEED = Buffer.from("auth_v3");
const REBATE_POOL_SEED = Buffer.from("rebate_pool");
const USER_STATS_SEED = Buffer.from("user_stats_v1");

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

  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}  TEST: deposit_fee_asdf${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  log("👤", `Payer/User: ${payer.publicKey.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], PROGRAM_ID);
  const [rebatePool] = PublicKey.findProgramAddressSync([REBATE_POOL_SEED], PROGRAM_ID);
  const [userStats] = PublicKey.findProgramAddressSync(
    [USER_STATS_SEED, payer.publicKey.toBuffer()],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);
  log("🏦", `Rebate Pool: ${rebatePool.toString()}`, colors.cyan);
  log("👤", `User Stats: ${userStats.toString()}`, colors.cyan);

  // Get ASDF mint from DAT state
  const state = await getTypedAccounts(program).datState.fetch(datState);
  const asdfMint = state.asdfMint;

  log("🪙", `ASDF Mint: ${asdfMint.toString()}`, colors.cyan);

  // Get ATAs
  const payerAta = await getAssociatedTokenAddress(asdfMint, payer.publicKey);
  const datAuthorityAta = await getAssociatedTokenAddress(asdfMint, datAuthority, true);
  const rebatePoolAta = await getAssociatedTokenAddress(asdfMint, rebatePool, true);

  log("💰", `Payer ATA: ${payerAta.toString()}`, colors.cyan);
  log("🔥", `DAT Authority ATA: ${datAuthorityAta.toString()}`, colors.cyan);
  log("🎁", `Rebate Pool ATA: ${rebatePoolAta.toString()}`, colors.cyan);

  // Check payer token balance
  let payerBalance: bigint;
  try {
    const payerAccount = await getAccount(connection, payerAta);
    payerBalance = payerAccount.amount;
    log("💎", `Payer token balance: ${Number(payerBalance) / 1e6} tokens`, colors.cyan);
  } catch {
    log("❌", "Payer has no token account! Need to acquire some tokens first.", colors.red);
    process.exit(1);
  }

  if (payerBalance < BigInt(100_000_000)) {
    log("❌", "Insufficient balance. Need at least 100 tokens (100M units)", colors.red);
    process.exit(1);
  }

  // Create DAT Authority ATA if it doesn't exist
  const datAuthorityAtaInfo = await connection.getAccountInfo(datAuthorityAta);
  if (!datAuthorityAtaInfo) {
    log("📦", "Creating DAT Authority ATA...", colors.yellow);
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      datAuthorityAta,
      datAuthority,
      asdfMint
    );
    const tx = await provider.sendAndConfirm(
      new (await import("@solana/web3.js")).Transaction().add(createAtaIx),
      [payer]
    );
    log("✅", `DAT Authority ATA created: ${tx}`, colors.green);
  }

  // Deposit amount (0.1 SOL equivalent = 100M units for testing)
  const depositAmount = new BN(100_000_000); // 100 tokens (6 decimals)

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}  EXECUTING DEPOSIT${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  log("💰", `Deposit amount: ${depositAmount.toNumber() / 1e6} tokens`, colors.cyan);
  log("🔥", `Burn (99.45%): ${(depositAmount.toNumber() * 9945 / 10000) / 1e6} tokens`, colors.cyan);
  log("🎁", `Rebate (0.55%): ${(depositAmount.toNumber() * 55 / 10000) / 1e6} tokens`, colors.cyan);

  // Get balances before
  let datAtaBalanceBefore = BigInt(0);
  let rebateAtaBalanceBefore = BigInt(0);
  try {
    const datAccount = await getAccount(connection, datAuthorityAta);
    datAtaBalanceBefore = datAccount.amount;
  } catch { /* empty account */ }
  try {
    const rebateAccount = await getAccount(connection, rebatePoolAta);
    rebateAtaBalanceBefore = rebateAccount.amount;
  } catch { /* empty account */ }

  log("\n📊", "Balances BEFORE:", colors.yellow);
  log("  ", `DAT ATA: ${Number(datAtaBalanceBefore) / 1e6} tokens`, colors.reset);
  log("  ", `Rebate Pool ATA: ${Number(rebateAtaBalanceBefore) / 1e6} tokens`, colors.reset);

  try {
    const tx = await program.methods
      .depositFeeAsdf(depositAmount)
      .accounts({
        datState,
        datAuthority,
        rebatePool,
        userStats,
        user: payer.publicKey,
        payerTokenAccount: payerAta,
        datAsdfAccount: datAuthorityAta,
        rebatePoolAta,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("\n✅", "DEPOSIT SUCCESSFUL!", colors.green);
    const cluster = networkConfig.name === "Mainnet" ? "" : "?cluster=devnet";
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}${cluster}`, colors.cyan);

    // Get balances after
    const datAccount = await getAccount(connection, datAuthorityAta);
    const rebateAccount = await getAccount(connection, rebatePoolAta);

    log("\n📊", "Balances AFTER:", colors.green);
    log("  ", `DAT ATA: ${Number(datAccount.amount) / 1e6} tokens (+${(Number(datAccount.amount) - Number(datAtaBalanceBefore)) / 1e6})`, colors.green);
    log("  ", `Rebate Pool ATA: ${Number(rebateAccount.amount) / 1e6} tokens (+${(Number(rebateAccount.amount) - Number(rebateAtaBalanceBefore)) / 1e6})`, colors.green);

    // Check UserStats
    try {
      const userStatsAccount = await getTypedAccounts(program).userStats.fetch(userStats);
      log("\n👤", "User Stats:", colors.green);
      log("  ", `User: ${userStatsAccount.user.toString()}`, colors.green);
      log("  ", `Pending Contribution: ${userStatsAccount.pendingContribution.toNumber() / 1e6} tokens`, colors.green);
      log("  ", `Total Contributed: ${userStatsAccount.totalContributed.toNumber() / 1e6} tokens`, colors.green);
      log("  ", `Total Rebate: ${userStatsAccount.totalRebate.toNumber() / 1e6} tokens`, colors.green);

      // Check eligibility threshold (0.07 SOL equiv = 70M lamports)
      const REBATE_THRESHOLD = 70_000_000;
      if (userStatsAccount.pendingContribution.toNumber() >= REBATE_THRESHOLD) {
        log("\n🎉", "USER IS ELIGIBLE FOR REBATE!", colors.green);
      } else {
        const needed = (REBATE_THRESHOLD - userStatsAccount.pendingContribution.toNumber()) / 1e6;
        log("\n⏳", `Need ${needed.toFixed(2)} more tokens to be eligible for rebate`, colors.yellow);
      }
    } catch (e) {
      log("❌", `Error fetching UserStats: ${e}`, colors.red);
    }

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
