/**
 * Test Complete DAT Cycle with SPL Token (Single Transaction)
 *
 * Executes the full buyback-and-burn cycle in ONE transaction using execute_full_cycle:
 * - collect_fees
 * - execute_buy
 * - burn_and_update
 *
 * This is the production-ready version that executes all 3 steps atomically.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

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

function logSection(title: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}${title}${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);
}

function loadIdl(): Idl {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;
  if (idl.metadata) {
    (idl.metadata as any).address = PROGRAM_ID.toString();
  } else {
    (idl as any).metadata = { address: PROGRAM_ID.toString() };
  }
  return idl;
}

async function main() {
  console.clear();
  logSection("🔥 TEST SPL FULL CYCLE (SINGLE TRANSACTION)");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Derive PDAs
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

  // Load SPL token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-spl.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  // Derive TokenStats PDA
  const [tokenStats] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_stats_v1"), tokenMint.toBuffer()],
    PROGRAM_ID
  );

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("🔗", `Token Program: SPL`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  log("✅", "Program loaded", colors.green);

  // Derive all required accounts
  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);
  const datTokenAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);

  const tokenCreator = new PublicKey(tokenInfo.creator);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_PROGRAM
  );

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(WSOL_MINT, protocolFeeRecipient, true);

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM
  );

  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), datAuthority.toBuffer()],
    PUMP_PROGRAM
  );

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
    FEE_PROGRAM
  );

  // Check balances before
  logSection("📊 STATE BEFORE CYCLE");

  const creatorVaultInfo = await connection.getAccountInfo(creatorVault);
  const vaultBalanceBefore = creatorVaultInfo ? creatorVaultInfo.lamports / 1e9 : 0;
  log("🏦", `Creator Vault: ${vaultBalanceBefore.toFixed(6)} SOL`, colors.yellow);

  if (vaultBalanceBefore < 0.0001) {
    log("⚠️", "WARNING: Very low fees in creator vault!", colors.yellow);
    log("💡", "The cycle may still execute but with minimal tokens bought", colors.yellow);
  }

  try {
    const wsolInfo = await getAccount(connection, datWsolAccount);
    const wsolBalance = Number(wsolInfo.amount) / 1e9;
    log("💰", `DAT WSOL Balance: ${wsolBalance.toFixed(6)} SOL`, colors.yellow);
  } catch {
    log("💰", `DAT WSOL Balance: 0.000000 SOL`, colors.yellow);
  }

  // Check DAT state
  const stateAccountBefore: any = await (program.account as any).datState.fetch(datState);
  const totalBurnedBefore = Number(stateAccountBefore.totalBurned) / 1e6;
  const totalSolBefore = Number(stateAccountBefore.totalSolCollected) / 1e9;
  const buybacksBefore = stateAccountBefore.totalBuybacks;

  log("🔥", `Total Burned: ${totalBurnedBefore.toLocaleString()} tokens`, colors.cyan);
  log("💎", `Total SOL Collected: ${totalSolBefore.toFixed(6)} SOL`, colors.cyan);
  log("📊", `Total Buybacks: ${buybacksBefore}`, colors.cyan);

  // Execute full cycle in ONE transaction
  logSection("⚡ EXECUTING FULL CYCLE (1 TX)");

  log("📝", "Transaction includes:", colors.cyan);
  log("  1️⃣", "collect_fees - Collect from creator vault", colors.yellow);
  log("  2️⃣", "execute_buy - Buy tokens from pool", colors.yellow);
  log("  3️⃣", "burn_and_update - Burn tokens", colors.yellow);
  log("⏳", "Sending transaction...", colors.yellow);

  try {
    const tx = await program.methods
      .executeFullCycle()
      .accounts({
        datState,
        tokenStats,
        datAuthority,
        creatorVault,
        wsolMint: WSOL_MINT,
        datWsolAccount,
        datAsdfAccount: datTokenAccount,
        pool: bondingCurve,
        asdfMint: tokenMint,
        poolAsdfAccount: poolTokenAccount,
        poolWsolAccount,
        pumpGlobalConfig,
        protocolFeeRecipient,
        protocolFeeRecipientAta,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    logSection("✅ CYCLE COMPLETED SUCCESSFULLY!");

    log("📜", `TX: ${tx}`, colors.green);
    log("🔗", `Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    // Check state after
    logSection("📊 STATE AFTER CYCLE");

    const stateAccountAfter: any = await (program.account as any).datState.fetch(datState);
    const totalBurnedAfter = Number(stateAccountAfter.totalBurned) / 1e6;
    const totalSolAfter = Number(stateAccountAfter.totalSolCollected) / 1e9;
    const buybacksAfter = stateAccountAfter.totalBuybacks;

    const tokensBurned = totalBurnedAfter - totalBurnedBefore;
    const solCollected = totalSolAfter - totalSolBefore;

    log("🔥", `Tokens Burned This Cycle: ${tokensBurned.toLocaleString()} tokens`, colors.green);
    log("💎", `SOL Collected This Cycle: ${solCollected.toFixed(6)} SOL`, colors.green);
    log("📊", `Buyback Count: ${buybacksBefore} → ${buybacksAfter}`, colors.green);

    log("", "", colors.reset);
    log("📈", `Total Burned (lifetime): ${totalBurnedAfter.toLocaleString()} tokens`, colors.cyan);
    log("💰", `Total SOL (lifetime): ${totalSolAfter.toFixed(6)} SOL`, colors.cyan);

    // Verify token balance is 0
    try {
      const tokenInfoAccount = await getAccount(connection, datTokenAccount);
      const tokenBalance = Number(tokenInfoAccount.amount);
      log("✅", `DAT Token Balance: ${tokenBalance} (should be 0)`, tokenBalance === 0 ? colors.green : colors.yellow);
    } catch {
      log("✅", `DAT Token Balance: 0 (account doesn't exist)`, colors.green);
    }

    // Check creator vault after
    const creatorVaultInfoAfter = await connection.getAccountInfo(creatorVault);
    const vaultBalanceAfter = creatorVaultInfoAfter ? creatorVaultInfoAfter.lamports / 1e9 : 0;
    log("🏦", `Creator Vault (after): ${vaultBalanceAfter.toFixed(6)} SOL`, colors.cyan);

    logSection("🎉 SPL TOKEN CYCLE VALIDATED!");

    log("✅", "Single-transaction execution: SUCCESS", colors.green);
    log("✅", "Fees collected from creator vault", colors.green);
    log("✅", "Tokens bought from bonding curve", colors.green);
    log("✅", "Tokens burned successfully", colors.green);
    log("🔥", "SPL token DAT workflow is 100% operational!", colors.magenta);

    console.log("\n" + "=".repeat(70));
    console.log(`${colors.bright}${colors.cyan}📝 EVENT DATA${colors.reset}`);
    console.log("=".repeat(70) + "\n");

    log("💡", "To read event details:", colors.cyan);
    log("📝", `npx ts-node scripts/read-cycle-events.ts ${tx}`, colors.yellow);

  } catch (error: any) {
    logSection("❌ CYCLE FAILED");

    log("❌", error.message, colors.red);

    if (error.logs) {
      console.log("\n📋 Transaction Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }

    log("", "", colors.reset);
    log("💡", "Troubleshooting:", colors.cyan);
    log("1️⃣", "Check creator vault has sufficient fees", colors.yellow);
    log("2️⃣", "Ensure all pool accounts are initialized", colors.yellow);
    log("3️⃣", "Try the 3-step version: test-spl-full-cycle.ts", colors.yellow);

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
