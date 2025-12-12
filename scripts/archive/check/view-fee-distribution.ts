/**
 * View Fee Distribution
 *
 * Affiche l'état complet du système de distribution des fees:
 * - Configuration root token
 * - Fee split ratio
 * - Statistiques par token
 * - Balances des treasuries
 */

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
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

interface TokenData {
  file: string;
  mint: PublicKey;
  name: string;
  symbol: string;
  creator: PublicKey;
}

async function main() {
  // Get optional token files from command line
  const tokenFiles = process.argv.slice(2);

  console.clear();
  logSection("📊 FEE DISTRIBUTION DASHBOARD");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Use dummy wallet for read-only operations
  const dummyWallet = Keypair.generate();
  const provider = new AnchorProvider(connection, new Wallet(dummyWallet), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  // ========================================================================
  // DAT STATE
  // ========================================================================

  let state: any;
  try {
    state = await (program.account as any).datState.fetch(datState);
  } catch (e: any) {
    log("❌", `Failed to fetch DAT state: ${e.message}`, colors.red);
    log("💡", "Is the program deployed?", colors.yellow);
    process.exit(1);
  }

  logSection("⚙️  CONFIGURATION");

  log("📦", `DAT State: ${datState.toString()}`, colors.dim);
  log("👤", `Admin: ${state.admin.toString()}`, colors.cyan);
  log("🔧", `Active: ${state.isActive ? "✅ Yes" : "❌ No"}`, state.isActive ? colors.green : colors.red);
  log("🚨", `Emergency Pause: ${state.emergencyPause ? "🔴 Yes" : "✅ No"}`, state.emergencyPause ? colors.red : colors.green);

  const feeSplitBps = state.feeSplitBps;
  const keepPercentage = (feeSplitBps / 100).toFixed(2);
  const toRootPercentage = ((10000 - feeSplitBps) / 100).toFixed(2);

  log("📊", `Fee Split: ${feeSplitBps} bps`, colors.cyan);
  log("  ", `→ ${keepPercentage}% kept by secondary tokens`, colors.reset);
  log("  ", `→ ${toRootPercentage}% sent to root token`, colors.reset);

  // ========================================================================
  // ROOT TOKEN
  // ========================================================================

  logSection("🏆 ROOT TOKEN");

  if (!state.rootTokenMint) {
    log("❌", "No root token configured", colors.yellow);
    log("💡", "Set with: npx ts-node scripts/set-root-token.ts <token-file.json>", colors.cyan);
  } else {
    const rootMint = state.rootTokenMint;
    log("🪙", `Root Token Mint: ${rootMint.toString()}`, colors.green);

    // Derive root treasury
    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("root_treasury"), rootMint.toBuffer()],
      PROGRAM_ID
    );

    log("🏦", `Root Treasury: ${rootTreasury.toString()}`, colors.cyan);

    // Check treasury balance
    const treasuryInfo = await connection.getAccountInfo(rootTreasury);
    const treasuryBalance = treasuryInfo ? treasuryInfo.lamports / 1e9 : 0;
    log("💰", `Treasury Balance: ${treasuryBalance.toFixed(6)} SOL`, treasuryBalance > 0 ? colors.green : colors.dim);

    // Get root token stats
    const [rootTokenStats] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_stats_v1"), rootMint.toBuffer()],
      PROGRAM_ID
    );

    try {
      const stats: any = await (program.account as any).tokenStats.fetch(rootTokenStats);

      log("", "", colors.reset);
      log("📈", "Root Token Statistics:", colors.bright);
      log("  ", `Total SOL Collected: ${(Number(stats.totalSolCollected) / 1e9).toFixed(6)} SOL`, colors.cyan);
      log("  ", `  ├─ From own fees: ${(Number(stats.totalSolCollected - stats.totalSolReceivedFromOthers) / 1e9).toFixed(6)} SOL`, colors.dim);
      log("  ", `  └─ From others: ${(Number(stats.totalSolReceivedFromOthers) / 1e9).toFixed(6)} SOL`, colors.dim);
      log("  ", `Total SOL Used: ${(Number(stats.totalSolUsed) / 1e9).toFixed(6)} SOL`, colors.cyan);
      log("  ", `Total Burned: ${(Number(stats.totalBurned) / 1e6).toLocaleString()} tokens`, colors.cyan);
      log("  ", `Total Cycles: ${stats.totalCycles}`, colors.cyan);
    } catch {
      log("⚠️", "Root token stats not initialized", colors.yellow);
      log("💡", "Initialize with: npx ts-node scripts/init-token-stats.ts <root-token-file.json>", colors.dim);
    }
  }

  // ========================================================================
  // SECONDARY TOKENS
  // ========================================================================

  if (tokenFiles.length > 0) {
    logSection("💎 SECONDARY TOKENS");

    const tokens: TokenData[] = [];

    for (const file of tokenFiles) {
      if (!fs.existsSync(file)) {
        log("⚠️", `File not found: ${file}`, colors.yellow);
        continue;
      }

      const tokenInfo = JSON.parse(fs.readFileSync(file, "utf-8"));
      tokens.push({
        file,
        mint: new PublicKey(tokenInfo.mint),
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        creator: new PublicKey(tokenInfo.creator),
      });
    }

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const isLast = i === tokens.length - 1;

      console.log(`\n${colors.cyan}${"─".repeat(70)}${colors.reset}`);
      log("🪙", `${token.name} (${token.symbol})`, colors.bright);
      log("🔗", `${token.mint.toString()}`, colors.dim);

      // Check if this is the root token
      if (state.rootTokenMint && state.rootTokenMint.equals(token.mint)) {
        log("⚠️", "This is the ROOT TOKEN (see section above)", colors.yellow);
        continue;
      }

      // Derive creator vault
      const [creatorVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator-vault"), token.creator.toBuffer()],
        PUMP_PROGRAM
      );

      // Check vault balance
      const vaultInfo = await connection.getAccountInfo(creatorVault);
      const vaultBalance = vaultInfo ? vaultInfo.lamports / 1e9 : 0;
      log("💎", `Creator Vault: ${vaultBalance.toFixed(6)} SOL`, vaultBalance > 0 ? colors.green : colors.dim);

      // Get token stats
      const [tokenStats] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_stats_v1"), token.mint.toBuffer()],
        PROGRAM_ID
      );

      try {
        const stats: any = await (program.account as any).tokenStats.fetch(tokenStats);

        log("", "", colors.reset);
        log("📊", "Statistics:", colors.cyan);
        log("  ", `Total SOL Collected: ${(Number(stats.totalSolCollected) / 1e9).toFixed(6)} SOL`, colors.reset);
        log("  ", `Total SOL Used: ${(Number(stats.totalSolUsed) / 1e9).toFixed(6)} SOL`, colors.reset);
        log("  ", `Total Sent to Root: ${(Number(stats.totalSolSentToRoot || 0) / 1e9).toFixed(6)} SOL`, colors.green);
        log("  ", `Total Burned: ${(Number(stats.totalBurned) / 1e6).toLocaleString()} tokens`, colors.reset);
        log("  ", `Total Cycles: ${stats.totalCycles}`, colors.reset);
      } catch {
        log("⚠️", "Token stats not initialized", colors.yellow);
        log("💡", `Initialize with: npx ts-node scripts/init-token-stats.ts ${token.file}`, colors.dim);
      }
    }
  } else {
    log("\n💡", "Tip: Add token files as arguments to see secondary token stats", colors.cyan);
    log("  ", "Example: npx ts-node scripts/view-fee-distribution.ts token1.json token2.json", colors.dim);
  }

  // ========================================================================
  // SUMMARY
  // ========================================================================

  logSection("📈 ECOSYSTEM SUMMARY");

  if (state.rootTokenMint) {
    log("✅", `Root token configured: ${state.rootTokenMint.toString()}`, colors.green);
    log("📊", `Fee split: ${keepPercentage}% kept by secondaries, ${toRootPercentage}% to root`, colors.cyan);

    // Calculate total treasury balance
    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("root_treasury"), state.rootTokenMint.toBuffer()],
      PROGRAM_ID
    );

    const treasuryInfo = await connection.getAccountInfo(rootTreasury);
    const pendingFees = treasuryInfo ? treasuryInfo.lamports / 1e9 : 0;

    if (pendingFees > 0) {
      log("💰", `Pending fees in root treasury: ${pendingFees.toFixed(6)} SOL`, colors.yellow);
      log("💡", "Run root token cycle to collect these fees", colors.cyan);
    } else {
      log("✨", "Root treasury is empty (all fees collected)", colors.green);
    }
  } else {
    log("⚠️", "Root token not configured yet", colors.yellow);
    log("📝", "Next steps:", colors.cyan);
    log("  ", "1. Create a token for the root (or use existing)", colors.reset);
    log("  ", "2. Initialize token stats for it", colors.reset);
    log("  ", "3. Set it as root token", colors.reset);
  }

  console.log(`\n${"=".repeat(70)}\n`);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
