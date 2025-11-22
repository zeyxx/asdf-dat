import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

// Configuration
const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_SWAP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const DAT_STATE_SEED = Buffer.from("dat_v3");
const DAT_AUTHORITY_SEED = Buffer.from("auth_v3");

// Couleurs
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
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

// Charger l'IDL
function loadIdl(): any {
  const possiblePaths = [
    "target/idl/asdf_dat.json",
    "../target/idl/asdf_dat.json",
    "./target/idl/asdf_dat.json",
    path.join(__dirname, "../target/idl/asdf_dat.json"),
  ];

  for (const idlPath of possiblePaths) {
    try {
      if (fs.existsSync(idlPath)) {
        return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
      }
    } catch (error) {
      continue;
    }
  }

  throw new Error("❌ IDL non trouvé. Exécutez: anchor build");
}

// Exécuter le cycle DAT complet
async function executeDATCycle(
  connection: Connection,
  program: Program,
  admin: Keypair,
  tokenMint: PublicKey,
  bondingCurve: PublicKey,
  datState: PublicKey,
  datAuthority: PublicKey
) {
  logSection("EXÉCUTION DU CYCLE DAT");

  // Vérifier le Creator Vault d'abord
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("coin-creator-vault-authority"), bondingCurve.toBuffer()],
    PUMP_SWAP_PROGRAM
  );

  const creatorVaultAta = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);

  try {
    const vaultAccount = await getAccount(connection, creatorVaultAta);
    const vaultBalance = Number(vaultAccount.amount);
    log("💼", `Creator Vault balance: ${(vaultBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`, colors.yellow);

    if (vaultBalance < 0.01 * LAMPORTS_PER_SOL) {
      log("⚠️", "Pas assez de fees (min: 0.01 SOL). Le cycle va probablement échouer.", colors.yellow);
    }
  } catch (error) {
    log("❌", "Impossible de lire le Creator Vault", colors.red);
  }

  // === ÉTAPE 1: Collect Fees ===
  log("\n💰", "Étape 1/3: Collecte des fees...", colors.bright);

  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_SWAP_PROGRAM
  );

  try {
    const tx = await program.methods
      .collectFees()
      .accounts({
        datState,
        datAuthority,
        pool: bondingCurve,
        wsolMint: WSOL_MINT,
        coinCreatorVaultAuthority: vaultAuthority,
        creatorVaultAta,
        datWsolAccount,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_SWAP_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("✅", `Fees collectées`, colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    // Vérifier le balance du DAT WSOL account
    const datWsolInfo = await getAccount(connection, datWsolAccount);
    log("💼", `DAT WSOL balance: ${(Number(datWsolInfo.amount) / LAMPORTS_PER_SOL).toFixed(4)} SOL`, colors.cyan);
  } catch (error: any) {
    log("❌", `Collecte échouée: ${error.message}`, colors.red);
    if (error.message.includes("InsufficientFees")) {
      log("💡", "Pas assez de fees dans le vault (min: 0.01 SOL)", colors.yellow);
    } else if (error.message.includes("AlreadyExecutedThisPeriod")) {
      log("💡", "Cycle déjà exécuté pour cette période (AM/PM)", colors.yellow);
    } else if (error.message.includes("CycleTooSoon")) {
      log("💡", "Trop tôt pour un nouveau cycle (attendez 60s)", colors.yellow);
    }
    throw error;
  }

  // === ÉTAPE 2: Execute Buy ===
  log("\n🛒", "Étape 2/3: Achat de tokens...", colors.bright);

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

    log("✅", `Tokens achetés`, colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    // Vérifier le balance de tokens
    const datTokenInfo = await getAccount(connection, datTokenAccount);
    log("🪙", `DAT token balance: ${(Number(datTokenInfo.amount) / 1e6).toFixed(2)} tokens`, colors.cyan);
  } catch (error: any) {
    log("❌", `Achat échoué: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    throw error;
  }

  // === ÉTAPE 3: Burn ===
  log("\n🔥", "Étape 3/3: Burn des tokens...", colors.bright);

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

    log("✅", `Tokens brûlés`, colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
  } catch (error: any) {
    log("❌", `Burn échoué: ${error.message}`, colors.red);
    throw error;
  }

  log("\n🎉", "Cycle DAT complété avec succès!", colors.bright + colors.green);
}

// Afficher les statistiques finales
async function displayStats(connection: Connection, datState: PublicKey) {
  logSection("STATISTIQUES DU PROTOCOLE");

  try {
    const accountInfo = await connection.getAccountInfo(datState);
    if (!accountInfo) {
      log("❌", "DAT State account non trouvé", colors.red);
      return;
    }

    const data = accountInfo.data;

    // Parse les champs importants (skip 8-byte discriminator)
    const admin = new PublicKey(data.slice(8, 40));
    const totalBurned = Number(data.readBigUInt64LE(168));
    const totalSolCollected = Number(data.readBigUInt64LE(176));
    const totalBuybacks = data.readUInt32LE(184);
    const failedCycles = data.readUInt32LE(188);
    const consecutiveFailures = data[192];
    const isActive = data[328] === 1;
    const emergencyPause = data[329] === 1;
    const lastCycleBurned = Number(data.readBigUInt64LE(224));
    const lastCycleSol = Number(data.readBigUInt64LE(216));

    console.log(`${colors.cyan}╔════════════════════════════════════════════════╗`);
    console.log(`║          📊 STATISTIQUES DU PROTOCOLE          ║`);
    console.log(`╚════════════════════════════════════════════════╝${colors.reset}\n`);

    console.log(`${colors.bright}État du Protocole:${colors.reset}`);
    console.log(`  ✅ Actif: ${isActive}`);
    console.log(`  🚨 Pause d'urgence: ${emergencyPause}`);
    console.log(`  👤 Admin: ${admin.toString()}\n`);

    console.log(`${colors.bright}Statistiques Globales:${colors.reset}`);
    console.log(`  🔥 Total brûlé: ${(totalBurned / 1e6).toFixed(2)} tokens`);
    console.log(`  💰 Total SOL collecté: ${(totalSolCollected / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log(`  🔄 Total de cycles: ${totalBuybacks}`);
    console.log(`  ❌ Cycles échoués: ${failedCycles}`);
    console.log(`  ⚠️  Échecs consécutifs: ${consecutiveFailures}\n`);

    console.log(`${colors.bright}Dernier Cycle:${colors.reset}`);
    console.log(`  🪙 Tokens brûlés: ${(lastCycleBurned / 1e6).toFixed(2)}`);
    console.log(`  💵 SOL utilisé: ${(lastCycleSol / LAMPORTS_PER_SOL).toFixed(4)}\n`);

  } catch (error: any) {
    log("❌", `Erreur lors de la lecture des stats: ${error.message}`, colors.red);
  }
}

// Main
async function main() {
  console.clear();
  console.log(`${colors.bright}${colors.magenta}`);
  console.log(`╔══════════════════════════════════════════════════════════╗`);
  console.log(`║                                                          ║`);
  console.log(`║        🧪 TEST CYCLE DAT - SIMPLE (Sans Trading)        ║`);
  console.log(`║                                                          ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log(colors.reset);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Charger le wallet admin
  const adminPath = "./devnet-wallet.json";
  if (!fs.existsSync(adminPath)) {
    log("❌", "Wallet admin non trouvé: devnet-wallet.json", colors.red);
    process.exit(1);
  }

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(adminPath, "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Charger la config
  const configPath = "./devnet-config.json";
  if (!fs.existsSync(configPath)) {
    log("❌", "Config non trouvée. Exécutez: npm run init", colors.red);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const datState = new PublicKey(config.datState);
  const datAuthority = new PublicKey(config.datAuthority);

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  // Charger les infos du token
  const tokenInfoPath = "./devnet-token-info.json";
  if (!fs.existsSync(tokenInfoPath)) {
    log("❌", "Token info non trouvé. Exécutez: npm run create-token", colors.red);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Setup provider et programme
  const provider = new AnchorProvider(
    connection,
    new Wallet(admin),
    { commitment: "confirmed" }
  );

  const idl = loadIdl();
  const program = new Program(idl, PROGRAM_ID, provider);

  log("✅", "Programme chargé\n", colors.green);

  try {
    // Exécuter le cycle DAT
    await executeDATCycle(
      connection,
      program,
      admin,
      tokenMint,
      bondingCurve,
      datState,
      datAuthority
    );

    // Afficher les stats
    await displayStats(connection, datState);

    logSection("✅ TEST TERMINÉ AVEC SUCCÈS!");

  } catch (error: any) {
    logSection("❌ ERREUR PENDANT LE TEST");
    console.error(`${colors.red}${error.message}${colors.reset}`);

    if (error.logs) {
      console.log("\n📋 Logs de transaction:");
      error.logs.slice(-10).forEach((log: string) => console.log(`   ${log}`));
    }

    process.exit(1);
  }
}

// Gestion des erreurs
process.on("unhandledRejection", (error: any) => {
  console.error(`\n${colors.red}❌ Erreur non gérée: ${error?.message || error}${colors.reset}`);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log(`\n\n${colors.yellow}👋 Test interrompu par l'utilisateur${colors.reset}`);
  process.exit(0);
});

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error}${colors.reset}`);
  process.exit(1);
});
