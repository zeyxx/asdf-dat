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
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

// Configuration
const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_SWAP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const FEE_PROGRAM = new PublicKey("8afbFEgoZ3RB6D3FGxNU7JnQZbJLmkcBCJ8RLGVEWVdc");

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
    path.join(__dirname, "../target/idl/asdf_dat.json"),
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
  logSection("🧪 TEST EXECUTE CYCLE");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load wallet
  const adminPath = "./devnet-wallet.json";
  if (!fs.existsSync(adminPath)) {
    log("❌", "Wallet admin non trouvé: devnet-wallet.json", colors.red);
    process.exit(1);
  }

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(adminPath, "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Load config
  const configPath = "./devnet-config.json";
  if (!fs.existsSync(configPath)) {
    log("❌", "Config non trouvée", colors.red);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const datState = new PublicKey(config.datState);
  const datAuthority = new PublicKey(config.datAuthority);

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  // Load token info
  const tokenInfoPath = "./devnet-token-info.json";
  if (!fs.existsSync(tokenInfoPath)) {
    log("❌", "Token info non trouvé", colors.red);
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

  logSection("PRÉPARATION DES COMPTES");

  // Derive all required accounts - Creator Vault Authority (updated to correct PDA derivation)
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), datAuthority.toBuffer()],
    PUMPSWAP_PROGRAM
  );

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_SWAP_PROGRAM
  );

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_SWAP_PROGRAM
  );

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap-volume-accumulator")],
    PUMP_SWAP_PROGRAM
  );

  const protocolFeeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

  // ATAs
  const creatorVault = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);
  const poolAsdfAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);
  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);
  const datAsdfAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true);

  log("✅", "Tous les comptes préparés", colors.green);

  logSection("EXÉCUTION DU CYCLE");

  try {
    const tx = await program.methods
      .executeCycle()
      .accounts({
        executor: admin.publicKey,
        datState,
        datAuthority,
        asdfMint: tokenMint,
        wsolMint: WSOL_MINT,
        pool: bondingCurve,
        poolAsdfAccount,
        poolWsolAccount,
        datWsolAccount,
        datAsdfAccount,
        creatorVaultAuthority: vaultAuthority,
        creatorVault,
        pumpSwapProgram: PUMP_SWAP_PROGRAM,
        pumpGlobalConfig,
        pumpEventAuthority,
        globalVolumeAccumulator,
        feeProgram: FEE_PROGRAM,
        protocolFeeRecipient,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Cycle exécuté avec succès!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    logSection("✅ SUCCÈS!");
  } catch (error: any) {
    logSection("❌ ERREUR");
    console.error(`${colors.red}${error.message}${colors.reset}`);

    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((log: string) => console.log(`   ${log}`));
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error}${colors.reset}`);
  process.exit(1);
});
