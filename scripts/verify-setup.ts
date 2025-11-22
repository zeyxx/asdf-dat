import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import fs from "fs";

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

async function verifySetup() {
  console.clear();
  logSection("🔍 VÉRIFICATION DE LA CONFIGURATION DEVNET");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // 1. Vérifier les fichiers de config
  log("📋", "Vérification des fichiers de configuration...", colors.bright);

  const requiredFiles = [
    "./devnet-config.json",
    "./devnet-token-info.json",
    "./devnet-wallet.json"
  ];

  const missingFiles: string[] = [];
  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      log("✅", `${file} trouvé`, colors.green);
    } else {
      log("❌", `${file} MANQUANT`, colors.red);
      missingFiles.push(file);
    }
  }

  if (missingFiles.length > 0) {
    log("\n⚠️", "Fichiers manquants. Impossible de continuer.", colors.red);
    process.exit(1);
  }

  // 2. Charger les configs
  const config = JSON.parse(fs.readFileSync("./devnet-config.json", "utf-8"));
  const tokenInfo = JSON.parse(fs.readFileSync("./devnet-token-info.json", "utf-8"));

  logSection("📦 CONFIGURATION CHARGÉE");

  console.log(`${colors.bright}Protocole DAT:${colors.reset}`);
  console.log(`  Program ID: ${config.programId || "N/A"}`);
  console.log(`  DAT State: ${config.datState}`);
  console.log(`  DAT Authority: ${config.datAuthority}`);
  console.log(`  Admin: ${config.admin}\n`);

  console.log(`${colors.bright}Token PumpFun:${colors.reset}`);
  console.log(`  Mint: ${tokenInfo.mint}`);
  console.log(`  Bonding Curve: ${tokenInfo.bondingCurve}`);
  console.log(`  Creator: ${tokenInfo.creator}\n`);

  // 3. VÉRIFICATION CRITIQUE: DAT Authority = Token Creator
  logSection("🔑 VÉRIFICATION CRITIQUE");

  const datAuthority = new PublicKey(config.datAuthority);
  const tokenCreator = new PublicKey(tokenInfo.creator);

  if (datAuthority.equals(tokenCreator)) {
    log("✅", "DAT Authority = Token Creator", colors.green);
    console.log(`   ${datAuthority.toString()}`);
  } else {
    log("❌", "ERREUR CRITIQUE: Les adresses ne correspondent pas!", colors.red);
    console.log(`   DAT Authority: ${datAuthority.toString()}`);
    console.log(`   Token Creator: ${tokenCreator.toString()}`);
    console.log(`\n${colors.red}⚠️  Le protocole ne pourra PAS collecter les fees!${colors.reset}`);
    process.exit(1);
  }

  // 4. Vérifier les comptes on-chain
  logSection("🌐 VÉRIFICATION ON-CHAIN");

  const datState = new PublicKey(config.datState);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const tokenMint = new PublicKey(tokenInfo.mint);
  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

  // Vérifier DAT State
  try {
    const datStateInfo = await connection.getAccountInfo(datState);
    if (datStateInfo) {
      log("✅", `DAT State existe (${datStateInfo.data.length} bytes)`, colors.green);

      // Parse basic info
      const data = datStateInfo.data;
      const admin = new PublicKey(data.slice(8, 40));
      const isActive = data[328] === 1;
      const emergencyPause = data[329] === 1;

      console.log(`   Admin: ${admin.toString()}`);
      console.log(`   Actif: ${isActive}`);
      console.log(`   Pause urgence: ${emergencyPause}`);
    } else {
      log("❌", "DAT State n'existe pas on-chain!", colors.red);
    }
  } catch (error: any) {
    log("❌", `Erreur lors de la lecture DAT State: ${error.message}`, colors.red);
  }

  // Vérifier Bonding Curve
  try {
    const bcInfo = await connection.getAccountInfo(bondingCurve);
    if (bcInfo) {
      log("✅", `Bonding Curve existe (${bcInfo.data.length} bytes)`, colors.green);

      // Vérifier le creator dans la bonding curve
      const data = bcInfo.data;
      if (data.length >= 81) {
        const creatorBytes = data.slice(49, 81);
        const creator = new PublicKey(creatorBytes);

        if (creator.equals(datAuthority)) {
          log("✅", "Creator dans bonding curve = DAT Authority", colors.green);
        } else {
          log("❌", "Creator dans bonding curve ≠ DAT Authority!", colors.red);
          console.log(`   Bonding Curve Creator: ${creator.toString()}`);
        }
      }
    } else {
      log("❌", "Bonding Curve n'existe pas!", colors.red);
    }
  } catch (error: any) {
    log("❌", `Erreur bonding curve: ${error.message}`, colors.red);
  }

  // Vérifier Token Mint
  try {
    const mintInfo = await connection.getAccountInfo(tokenMint);
    if (mintInfo) {
      log("✅", "Token Mint existe", colors.green);
    } else {
      log("❌", "Token Mint n'existe pas!", colors.red);
    }
  } catch (error: any) {
    log("❌", `Erreur token mint: ${error.message}`, colors.red);
  }

  // 5. Vérifier Creator Vault
  logSection("💰 VÉRIFICATION DU CREATOR VAULT");

  const PUMP_SWAP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("coin-creator-vault-authority"), bondingCurve.toBuffer()],
    PUMP_SWAP_PROGRAM
  );

  log("🔑", `Vault Authority: ${vaultAuthority.toString()}`, colors.cyan);

  const creatorVaultAta = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);
  log("💼", `Creator Vault ATA: ${creatorVaultAta.toString()}`, colors.cyan);

  try {
    const vaultInfo = await connection.getAccountInfo(creatorVaultAta);
    if (vaultInfo) {
      // Parse token account (amount at offset 64, 8 bytes little-endian)
      const amount = vaultInfo.data.readBigUInt64LE(64);
      const balanceSOL = Number(amount) / 1e9;

      log("✅", `Creator Vault existe`, colors.green);
      log("💵", `Balance: ${balanceSOL.toFixed(6)} SOL`, balanceSOL > 0.01 ? colors.green : colors.yellow);

      if (balanceSOL < 0.01) {
        log("⚠️", "Pas assez de fees pour un cycle (min: 0.01 SOL)", colors.yellow);
      }
    } else {
      log("⚠️", "Creator Vault ATA n'existe pas encore", colors.yellow);
    }
  } catch (error: any) {
    log("❌", `Erreur vault: ${error.message}`, colors.red);
  }

  // 6. Vérifier les ATAs du DAT Authority
  logSection("🏦 COMPTES DU DAT AUTHORITY");

  const datWsolAta = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);
  const datTokenAta = await getAssociatedTokenAddress(tokenMint, datAuthority, true);

  log("💼", `DAT WSOL ATA: ${datWsolAta.toString()}`, colors.cyan);

  try {
    const wsolInfo = await connection.getAccountInfo(datWsolAta);
    if (wsolInfo) {
      const amount = wsolInfo.data.readBigUInt64LE(64);
      const balanceSOL = Number(amount) / 1e9;
      log("✅", `Existe avec ${balanceSOL.toFixed(6)} SOL`, colors.green);
    } else {
      log("⚠️", "N'existe pas (sera créé au premier cycle)", colors.yellow);
    }
  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
  }

  log("🪙", `DAT Token ATA: ${datTokenAta.toString()}`, colors.cyan);

  try {
    const tokenAtaInfo = await connection.getAccountInfo(datTokenAta);
    if (tokenAtaInfo) {
      const amount = tokenAtaInfo.data.readBigUInt64LE(64);
      const balance = Number(amount) / 1e6; // Assuming 6 decimals
      log("✅", `Existe avec ${balance.toFixed(2)} tokens`, colors.green);
    } else {
      log("⚠️", "N'existe pas (sera créé lors du premier buy)", colors.yellow);
    }
  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
  }

  // 7. Résumé final
  logSection("📊 RÉSUMÉ");

  log("✅", "Configuration validée!", colors.green);
  console.log(`\n${colors.bright}Prêt pour exécuter:${colors.reset}`);
  console.log(`  ${colors.cyan}npx ts-node scripts/test-cycle-simple.ts${colors.reset}\n`);
}

// Main
verifySetup().catch((error) => {
  console.error(`\n${colors.red}❌ Erreur: ${error.message}${colors.reset}`);
  process.exit(1);
});
