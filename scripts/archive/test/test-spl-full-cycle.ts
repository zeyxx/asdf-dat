/**
 * Test Complete DAT Cycle with SPL Token (3 Steps)
 *
 * Tests the buyback-and-burn cycle:
 * 1. collect_fees - Collect fees from creator vault
 * 2. execute_buy - Buy tokens with collected fees
 * 3. burn_and_update - Burn bought tokens
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
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
  logSection("🔥 TEST SPL CYCLE (COLLECT → BUY → BURN)");

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

  const datTokenAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true, TOKEN_PROGRAM_ID);

  // Derive creator vault
  const tokenCreator = new PublicKey(tokenInfo.creator);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_PROGRAM
  );

  log("🏦", `Creator Vault: ${creatorVault.toString()}`, colors.cyan);

  // Check creator vault balance
  const creatorVaultInfo = await connection.getAccountInfo(creatorVault);
  if (creatorVaultInfo) {
    const balance = creatorVaultInfo.lamports / 1e9;
    log("💎", `Creator Vault Balance (before): ${balance.toFixed(6)} SOL`, colors.yellow);

    if (balance < 0.001) {
      log("⚠️", "WARNING: Creator vault has very low fees!", colors.yellow);
      log("💡", "Make some trades first to accumulate fees", colors.yellow);
    }
  } else {
    log("⚠️", "WARNING: Creator vault doesn't exist!", colors.yellow);
    log("💡", "Make at least one trade to create the vault", colors.yellow);
  }

  // Derive token stats
  const [tokenStats] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_stats_v1"), tokenMint.toBuffer()],
    PROGRAM_ID
  );

  // Check DAT state
  const stateAccount: any = await (program.account as any).datState.fetch(datState);
  log("📊", `Total Burned (before): ${(Number(stateAccount.totalBurned) / 1e6).toLocaleString()} tokens`, colors.cyan);
  log("📊", `Total SOL Collected (before): ${(Number(stateAccount.totalSolCollected) / 1e9).toFixed(6)} SOL`, colors.cyan);
  log("📊", `Total Buybacks: ${stateAccount.totalBuybacks}`, colors.cyan);

  // ========================================================================
  logSection("STEP 1/3: COLLECT FEES");
  // ========================================================================

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  try {
    const tx1 = await program.methods
      .collectFees(false) // is_root_token = false (default behavior)
      .accounts({
        datState,
        tokenStats,
        tokenMint,
        datAuthority,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
         // Not used for non-root token
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Fees collected!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx1}?cluster=devnet`, colors.cyan);

    // Check updated balances
    const creatorVaultInfoAfter = await connection.getAccountInfo(creatorVault);
    if (creatorVaultInfoAfter) {
      const balance = creatorVaultInfoAfter.lamports / 1e9;
      log("💎", `Creator Vault Balance (after collect): ${balance.toFixed(6)} SOL`, colors.green);
    }

    const datAuthorityAfter = await connection.getAccountInfo(datAuthority);
    if (datAuthorityAfter) {
      const balance = datAuthorityAfter.lamports / 1e9;
      log("💰", `DAT Authority SOL (after collect): ${balance.toFixed(6)} SOL`, colors.green);
    }
  } catch (error: any) {
    log("❌", `Error collect_fees: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("STEP 2/3: EXECUTE BUY");
  // ========================================================================

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

  try {
    const tx2 = await program.methods
      .executeBuy(false) // is_secondary_token = false (default behavior)
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        pool: bondingCurve,
        asdfMint: tokenMint,
        poolAsdfAccount: poolTokenAccount,
        poolWsolAccount,
        pumpGlobalConfig,
        protocolFeeRecipient,
        protocolFeeRecipientAta,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        rootTreasury: datAuthority, // Dummy value, not used for non-secondary token
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    log("✅", "Tokens bought!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx2}?cluster=devnet`, colors.cyan);

    // Check token balance
    const tokenInfoAccount = await getAccount(connection, datTokenAccount);
    const tokenBalance = Number(tokenInfoAccount.amount) / 1e6;
    log("💎", `Tokens bought: ${tokenBalance.toLocaleString()} tokens`, colors.green);
  } catch (error: any) {
    log("❌", `Error execute_buy: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("STEP 3/3: BURN AND UPDATE");
  // ========================================================================

  try {
    const tx3 = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        tokenStats,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        asdfMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("✅", "Tokens burned!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx3}?cluster=devnet`, colors.cyan);

    // Verify token balance is 0
    const tokenInfoAccount = await getAccount(connection, datTokenAccount);
    const tokenBalance = Number(tokenInfoAccount.amount);
    log("💎", `Tokens remaining: ${tokenBalance}`, tokenBalance === 0 ? colors.green : colors.yellow);

    // Check updated state
    const stateAccountAfter: any = await (program.account as any).datState.fetch(datState);
    const totalBurned = Number(stateAccountAfter.totalBurned) / 1e6;
    const totalSol = Number(stateAccountAfter.totalSolCollected) / 1e9;

    log("📊", `Total Burned (after): ${totalBurned.toLocaleString()} tokens`, colors.green);
    log("📊", `Total SOL Collected (after): ${totalSol.toFixed(6)} SOL`, colors.green);
    log("📊", `Total Buybacks: ${stateAccountAfter.totalBuybacks}`, colors.green);
  } catch (error: any) {
    log("❌", `Error burn_and_update: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("🎉 SPL CYCLE COMPLETED!");
  // ========================================================================

  log("✅", "collect_fees: Fees collected from creator vault", colors.green);
  log("✅", "execute_buy: Tokens bought with fees", colors.green);
  log("✅", "burn_and_update: Tokens burned", colors.green);
  log("🔥", "SPL token DAT cycle is fully operational!", colors.magenta);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
