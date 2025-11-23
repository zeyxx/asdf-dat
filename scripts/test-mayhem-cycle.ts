import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
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

function loadIdl(): any {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  idl.metadata = { address: PROGRAM_ID.toString() };
  idl.address = PROGRAM_ID.toString();
  return idl;
}

async function main() {
  console.clear();
  logSection("🔥 TEST CYCLE DAT MAYHEM MODE (Token2022)");

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

  // Load Mayhem Mode token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const tokenCreator = new PublicKey(tokenInfo.creator);

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

  // Token2022 ATAs - derive early so we can check/create them
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

  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);

  // Check if DAT Token2022 ATA exists, create if needed
  const datTokenAccountInfo = await connection.getAccountInfo(datTokenAccount);
  if (!datTokenAccountInfo) {
    log("⚠️", "DAT Token2022 ATA doesn't exist, creating it...", colors.yellow);

    const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
    const createAtaIx = createAssociatedTokenAccountInstruction(
      admin.publicKey,
      datTokenAccount,
      datAuthority,
      tokenMint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const { Transaction } = await import("@solana/web3.js");
    const tx = new Transaction().add(createAtaIx);
    const sig = await connection.sendTransaction(tx, [admin]);
    await connection.confirmTransaction(sig, "confirmed");

    log("✅", "DAT Token2022 ATA created!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`, colors.cyan);
  } else {
    log("✅", "DAT Token2022 ATA exists", colors.green);
  }

  // Check DAT WSOL balance
  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);

  try {
    const wsolInfo = await getAccount(connection, datWsolAccount);
    const wsolBalance = Number(wsolInfo.amount) / 1e9;
    log("💰", `DAT WSOL Balance (avant): ${wsolBalance.toFixed(6)} SOL`, colors.yellow);
  } catch {
    log("❌", "DAT WSOL account doesn't exist!", colors.red);
    log("⚠️", "Run the initialization script first", colors.yellow);
    process.exit(1);
  }

  // Derive creator vault
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_PROGRAM
  );

  log("🏦", `Creator Vault: ${creatorVault.toString()}`, colors.cyan);

  // Check creator vault balance
  const creatorVaultInfo = await connection.getAccountInfo(creatorVault);
  if (creatorVaultInfo) {
    const balance = creatorVaultInfo.lamports / 1e9;
    log("💎", `Creator Vault Balance (avant): ${balance.toFixed(6)} SOL`, colors.yellow);

    if (balance === 0) {
      log("⚠️", "Creator vault is empty - no fees to collect!", colors.yellow);
      log("💡", "You need to wait for Mayhem AI to trade or make manual trades", colors.cyan);
      process.exit(0);
    }
  } else {
    log("❌", "Creator vault doesn't exist yet", colors.red);
    process.exit(1);
  }

  // ========================================================================
  logSection("ÉTAPE 1/3: COLLECT FEES");
  // ========================================================================

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  try {
    const tx1 = await program.methods
      .collectFees()
      .accounts({
        datState,
        datAuthority,
        creatorVault,
        wsolMint: WSOL_MINT,
        datWsolAccount,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Fees collectés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx1}?cluster=devnet`, colors.cyan);

    // Check updated balances
    const wsolInfo = await getAccount(connection, datWsolAccount);
    const wsolBalance = Number(wsolInfo.amount) / 1e9;
    log("💰", `DAT WSOL Balance (après collect): ${wsolBalance.toFixed(6)} SOL`, colors.green);

    const creatorVaultInfoAfter = await connection.getAccountInfo(creatorVault);
    if (creatorVaultInfoAfter) {
      const balance = creatorVaultInfoAfter.lamports / 1e9;
      log("💎", `Creator Vault Balance (après collect): ${balance.toFixed(6)} SOL`, colors.green);
    }
  } catch (error: any) {
    log("❌", `Erreur collect_fees: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("ÉTAPE 2/3: EXECUTE BUY");
  // ========================================================================

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  // Mayhem Mode fee recipients (select randomly from the 7 authorized)
  const MAYHEM_FEE_RECIPIENTS = [
    "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS",
    "4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6",
    "8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR",
    "4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH",
    "8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6",
    "Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk",
    "463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq",
  ];

  // Use first Mayhem fee recipient for Mayhem Mode tokens
  const protocolFeeRecipient = new PublicKey(MAYHEM_FEE_RECIPIENTS[0]);
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
      .executeBuy()
      .accounts({
        datState,
        datAuthority,
        datWsolAccount,
        datAsdfAccount: datTokenAccount,
        pool: bondingCurve,
        asdfMint: tokenMint,
        wsolMint: WSOL_MINT,
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Tokens achetés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx2}?cluster=devnet`, colors.cyan);

    // Check token balance
    const tokenInfoAccount = await getAccount(
      connection,
      datTokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const tokenBalance = Number(tokenInfoAccount.amount);
    const DECIMALS = 6; // Mayhem tokens have 6 decimals
    const tokensReal = tokenBalance / Math.pow(10, DECIMALS);
    log("💎", `Tokens achetés: ${tokensReal.toLocaleString(undefined, {maximumFractionDigits: 6})} tokens (${tokenBalance.toLocaleString()} unités)`, colors.green);
  } catch (error: any) {
    log("❌", `Erreur execute_buy: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("ÉTAPE 3/3: BURN AND UPDATE");
  // ========================================================================

  try {
    // Get balance before burn
    const DECIMALS = 6;
    const tokenInfoBeforeBurn = await getAccount(
      connection,
      datTokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const tokenBalanceBefore = Number(tokenInfoBeforeBurn.amount);
    const tokensRealBefore = tokenBalanceBefore / Math.pow(10, DECIMALS);

    const tx3 = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        asdfMint: tokenMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    log("✅", "Tokens brûlés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx3}?cluster=devnet`, colors.cyan);

    // Verify token balance is 0
    const tokenInfoAccountAfterBurn = await getAccount(
      connection,
      datTokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const tokenBalanceAfter = Number(tokenInfoAccountAfterBurn.amount);
    const tokensRealAfter = tokenBalanceAfter / Math.pow(10, DECIMALS);
    const tokensBurned = tokensRealBefore - tokensRealAfter;
    log("🔥", `Tokens brûlés: ${tokensBurned.toLocaleString(undefined, {maximumFractionDigits: 6})} tokens`, colors.green);
    log("💎", `Tokens restants: ${tokensRealAfter.toLocaleString(undefined, {maximumFractionDigits: 6})} tokens`, tokenBalanceAfter === 0 ? colors.green : colors.yellow);
  } catch (error: any) {
    log("❌", `Erreur burn_and_update: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("🎉 CYCLE DAT MAYHEM MODE RÉUSSI!");
  // ========================================================================

  log("✅", "collect_fees: Fees récupérés du creator vault", colors.green);
  log("✅", "execute_buy: Tokens Token2022 achetés", colors.green);
  log("✅", "burn_and_update: Tokens brûlés", colors.green);
  log("🔥", "Le cycle DAT Mayhem Mode est 100% opérationnel!", colors.magenta);
  log("💊", "Ready for the magic pill!", colors.cyan);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
