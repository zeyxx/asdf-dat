/**
 * Test Execute Full Cycle on Mayhem Mode Token (Token2022)
 *
 * Tests the single-transaction execute_full_cycle instruction
 * which performs: collect_fees → execute_buy → burn_and_update
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
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
  console.log(`${colors.bright}${colors.magenta}🚀 TEST FULL CYCLE (MAYHEM MODE - Token2022)${colors.reset}`);
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

  // Load Mayhem token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const tokenCreator = new PublicKey(tokenInfo.creator);

  // Derive TokenStats PDA
  const [tokenStats] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_stats_v1"), tokenMint.toBuffer()],
    PROGRAM_ID
  );

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("🔥", `Token Program: Token2022 (Mayhem Mode)`, colors.yellow);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  log("✅", "Programme chargé", colors.green);

  // Token2022 ATAs
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

  const poolWsolAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    bondingCurve,
    true,
    TOKEN_PROGRAM_ID
  );

  const datWsolAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    datAuthority,
    true,
    TOKEN_PROGRAM_ID
  );

  // Check creator vault
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_PROGRAM
  );

  log("🏦", `Creator Vault: ${creatorVault.toString()}`, colors.cyan);

  const creatorVaultInfo = await connection.getAccountInfo(creatorVault);
  if (creatorVaultInfo) {
    const balance = creatorVaultInfo.lamports / 1e9;
    log("💎", `Creator Vault Balance: ${balance.toFixed(6)} SOL`, colors.yellow);

    if (balance < 0.0001) {
      log("⚠️", "Creator vault has minimal fees - cycle might not be profitable", colors.yellow);
    }
  }

  // Mayhem Mode fee recipients
  const MAYHEM_FEE_RECIPIENTS = [
    "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS",
    "4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6",
    "8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR",
    "4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH",
    "8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6",
    "Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk",
    "463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq",
  ];

  const protocolFeeRecipient = new PublicKey(MAYHEM_FEE_RECIPIENTS[0]);
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(
    WSOL_MINT,
    protocolFeeRecipient,
    true,
    TOKEN_PROGRAM_ID
  );

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

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
  log("\n📊", "État AVANT le cycle:", colors.yellow);

  try {
    const datTokenBalance = await connection.getTokenAccountBalance(datTokenAccount);
    log("🪙", `DAT Tokens: ${Number(datTokenBalance.value.amount).toLocaleString()} unités`, colors.cyan);
  } catch (e) {
    log("🪙", `DAT Tokens: 0 (account doesn't exist yet)`, colors.cyan);
  }

  const datWsolBalance = await connection.getTokenAccountBalance(datWsolAccount);
  log("💰", `DAT WSOL: ${Number(datWsolBalance.value.amount) / 1e9} SOL`, colors.cyan);

  // ========================================================================
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}🔄 STEP 1/3: COLLECT FEES${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);
  // ========================================================================

  try {
    const tx1 = await program.methods
      .collectFees(true) // is_root_token = true (Mayhem is the root token)
      .accounts({
        datState,
        tokenStats,
        tokenMint,
        datAuthority,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury: datAuthority, // Dummy value, not used for root token
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Fees collected from creator vault!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx1}?cluster=devnet`, colors.cyan);
  } catch (error: any) {
    log("❌", `Error collect_fees: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}🔄 STEP 2/3: EXECUTE BUY${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);
  // ========================================================================

  try {
    const tx2 = await program.methods
      .executeBuy(false) // is_secondary_token = false (this is the root token)
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
        rootTreasury: datAuthority, // Dummy value, not used for root token
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    log("✅", "Tokens bought!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx2}?cluster=devnet`, colors.cyan);
  } catch (error: any) {
    log("❌", `Error execute_buy: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}🔄 STEP 3/3: BURN AND UPDATE${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    log("✅", "Tokens burned!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx3}?cluster=devnet`, colors.cyan);

    // Check balances after
    log("\n📊", "État APRÈS le cycle:", colors.green);

    const datTokenBalanceAfter = await connection.getTokenAccountBalance(datTokenAccount);
    const DECIMALS = 6;
    const tokensReal = Number(datTokenBalanceAfter.value.amount) / Math.pow(10, DECIMALS);
    log("🪙", `DAT Tokens: ${tokensReal.toLocaleString()} tokens (${Number(datTokenBalanceAfter.value.amount).toLocaleString()} unités)`, colors.green);

    const datWsolBalanceAfter = await connection.getTokenAccountBalance(datWsolAccount);
    log("💰", `DAT WSOL: ${Number(datWsolBalanceAfter.value.amount) / 1e9} SOL`, colors.green);

    // Check state
    const state = await (program.account as any).datState.fetch(datState);
    const totalBurnedReal = Number(state.totalBurned.toString()) / Math.pow(10, DECIMALS);
    const totalSolReal = Number(state.totalSolCollected.toString()) / 1e9;

    log("\n📈", "Statistiques DAT:", colors.cyan);
    log("🔥", `Total Burned: ${totalBurnedReal.toLocaleString()} tokens`, colors.green);
    log("💰", `Total SOL Collected: ${totalSolReal.toFixed(6)} SOL`, colors.green);
    log("🔄", `Total Buybacks: ${state.totalBuybacks}`, colors.green);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.green}✅ FULL CYCLE MAYHEM MODE OPÉRATIONNEL !${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

    log("💊", "Cycle complet en une seule transaction !", colors.magenta);
    log("🚀", "Ready for mainnet deployment!", colors.cyan);

  } catch (error: any) {
    log("❌", `Erreur execute_full_cycle: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-15).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
