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

// Configuration
const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_SWAP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log(`${"=".repeat(60)}\n`);
}

function loadIdl(): Idl {
  const possiblePaths = [
    "target/idl/asdf_dat.json",
    "../target/idl/asdf_dat.json",
    "../../target/idl/asdf_dat.json",
    path.join(__dirname, "../../target/idl/asdf_dat.json"),
  ];

  for (const idlPath of possiblePaths) {
    try {
      if (fs.existsSync(idlPath)) {
        const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;
        // Ensure metadata.address is set for Anchor 0.30.1
        if (idl.metadata) {
          idl.metadata.address = PROGRAM_ID.toString();
        } else {
          idl.metadata = { address: PROGRAM_ID.toString() };
        }
        return idl;
      }
    } catch (error) {
      continue;
    }
  }

  throw new Error("❌ IDL non trouvé. Exécutez: anchor build");
}

async function main() {
  console.clear();
  logSection("🧪 TEST CYCLE DAT COMPLET");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load wallet
  const walletPath = "devnet-wallet.json";
  if (!fs.existsSync(walletPath)) {
    log("❌", "Wallet non trouvé: devnet-wallet.json", colors.red);
    log("💡", "Créez-le avec: solana-keygen new -o devnet-wallet.json", colors.yellow);
    process.exit(1);
  }

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Load config
  const configPath = "config/devnet-dat-deployment.json";
  if (!fs.existsSync(configPath)) {
    log("❌", "Config non trouvée", colors.red);
    log("💡", "Initialisez d'abord avec: npm run init", colors.yellow);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  // Derive PDAs with v3 seeds
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

  // Load token info
  const tokenInfoPath = "devnet-token-info.json";
  if (!fs.existsSync(tokenInfoPath)) {
    log("❌", "Token info non trouvé", colors.red);
    log("💡", "Créez un token avec: npm run create-token", colors.yellow);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(
    connection,
    new Wallet(admin),
    { commitment: "confirmed" }
  );

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  log("✅", "Programme chargé", colors.green);
  log("🔧", `Available methods: ${Object.keys(program.methods).join(", ")}`, colors.cyan);

  logSection("ÉTAPE 1: COLLECT FEES");

  // Derive PDAs - Creator Vault Authority (updated to correct PDA derivation)
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), datAuthority.toBuffer()],
    PUMPSWAP_PROGRAM
  );

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_SWAP_PROGRAM
  );

  // ATAs
  const creatorVault = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);
  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);

  try {
    const vaultInfo = await getAccount(connection, creatorVault);
    const vaultBalance = Number(vaultInfo.amount) / 1e9;
    log("💼", `Creator Vault: ${vaultBalance.toFixed(6)} SOL`, vaultBalance > 0.01 ? colors.green : colors.yellow);

    if (vaultBalance < 0.01) {
      log("⚠️", "Pas assez de fees (min: 0.01 SOL)", colors.yellow);
    }
  } catch (error) {
    log("⚠️", "Creator Vault pas encore créé", colors.yellow);
  }

  try {
    const tx = await program.methods
      .collectFees()
      .accounts({
        datState,
        datAuthority,
        pool: bondingCurve,
        wsolMint: WSOL_MINT,
        coinCreatorVaultAuthority: vaultAuthority,
        creatorVaultAta: creatorVault,
        datWsolAccount,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_SWAP_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("✅", "Fees collectées!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  logSection("ÉTAPE 2: EXECUTE BUY");

  const datTokenAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_SWAP_PROGRAM
  );

  const protocolFeeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(WSOL_MINT, protocolFeeRecipient, true);

  try {
    const tx = await program.methods
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
        pumpEventAuthority,
        pumpSwapProgram: PUMP_SWAP_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    log("✅", "Tokens achetés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  logSection("ÉTAPE 3: BURN");

  try {
    const tx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        asdfMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("✅", "Tokens brûlés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  logSection("✅ CYCLE TERMINÉ AVEC SUCCÈS!");
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
