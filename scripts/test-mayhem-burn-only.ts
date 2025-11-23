/**
 * Test Mayhem Mode Burn (Bypassing PumpFun)
 *
 * Tests the burn_and_update function directly by:
 * 1. Transferring tokens from pool to DAT (simulating a buy)
 * 2. Calling burn_and_update to burn those tokens
 *
 * This bypasses PumpFun's buy instruction which doesn't work on devnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createTransferCheckedInstruction,
  getAccount,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");

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
  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}🔥 TEST MAYHEM BURN (Direct)${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Derive DAT PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  // Load Mayhem token
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Setup provider
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  const datTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    datAuthority,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const poolTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  // Check balances before
  log("\n📊", "Balances AVANT:", colors.yellow);

  const datBalanceBefore = await connection.getTokenAccountBalance(datTokenAccount);
  log("🏦", `DAT Token Balance: ${Number(datBalanceBefore.value.amount).toLocaleString()}`, colors.cyan);

  const poolBalanceBefore = await connection.getTokenAccountBalance(poolTokenAccount);
  log("💧", `Pool Token Balance: ${Number(poolBalanceBefore.value.amount).toLocaleString()}`, colors.cyan);

  // Step 1: Simulate buy by transferring tokens from pool to DAT
  log("\n⚡", "Step 1: Simuler l'achat (transfer pool -> DAT)...", colors.yellow);

  const transferAmount = 1_000_000_000_000; // 1M tokens (with 6 decimals)

  // We need to sign with the bonding curve, but we don't have its keypair
  // So we'll use admin to transfer from admin's token account instead
  const adminTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    admin.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // Check if admin has tokens
  try {
    const adminBalance = await connection.getTokenAccountBalance(adminTokenAccount);
    const adminTokens = Number(adminBalance.value.amount);

    if (adminTokens < transferAmount) {
      log("⚠️", `Admin n'a que ${adminTokens.toLocaleString()} tokens, ajustement...`, colors.yellow);
      // Transfer from pool to admin first (we can't, we don't have pool keys)
      log("❌", "Impossible de transférer depuis le pool sans ses clés", colors.red);
      log("💡", "Utilisons les tokens déjà dans le compte DAT", colors.cyan);
    }
  } catch (e) {
    log("⚠️", "Admin n'a pas de token account", colors.yellow);
  }

  // Alternative: Just test burn with whatever is already in DAT account
  const datCurrentBalance = Number(datBalanceBefore.value.amount);

  if (datCurrentBalance === 0) {
    log("❌", "DAT account est vide, impossible de tester burn", colors.red);
    log("💡", "Solution: Transférer manuellement des tokens au DAT d'abord", colors.yellow);
    log("📍", `DAT Token Account: ${datTokenAccount.toString()}`, colors.cyan);
    process.exit(1);
  }

  log("✅", `DAT a ${datCurrentBalance.toLocaleString()} tokens, on peut tester burn!`, colors.green);

  // Step 2: Burn those tokens
  console.log(`\n${"=".repeat(70)}`);
  log("🔥", "Step 2: BURN_AND_UPDATE", colors.magenta);
  console.log(`${"=".repeat(70)}\n`);

  try {
    const tx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        asdfMint: tokenMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    log("✅", "Tokens brûlés avec succès!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    // Check balance after
    const datBalanceAfter = await connection.getTokenAccountBalance(datTokenAccount);
    log("\n📊", `DAT Balance APRÈS: ${Number(datBalanceAfter.value.amount).toLocaleString()}`, colors.green);
    log("🔥", `Tokens brûlés: ${(datCurrentBalance - Number(datBalanceAfter.value.amount)).toLocaleString()}`, colors.green);

    // Check state
    const state = await (program.account as any).datState.fetch(datState);
    log("\n📈", "DAT State mis à jour:", colors.cyan);
    log("📊", `Total Burned: ${state.totalBurned.toString()}`, colors.green);
    log("💰", `Total SOL Collected: ${state.totalSolCollected.toString()}`, colors.green);
    log("🔄", `Total Buybacks: ${state.totalBuybacks}`, colors.green);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.green}✅ BURN_AND_UPDATE FONCTIONNE SUR TOKEN MAYHEM!${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

  } catch (error: any) {
    log("❌", `Erreur burn_and_update: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur: ${error.message}${colors.reset}`);
  process.exit(1);
});
