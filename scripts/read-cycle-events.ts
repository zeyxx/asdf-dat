/**
 * Read and Display DAT Cycle Events with Proper Decimal Formatting
 *
 * Reads CycleCompleted events from transactions and displays them
 * with human-readable token amounts (6 decimals) and SOL amounts (9 decimals)
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl, BorshCoder, EventParser } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const TOKEN_DECIMALS = 6; // 6 decimals for tokens
const SOL_DECIMALS = 9; // 9 decimals for lamports

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

function loadIdl(): Idl {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  return JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;
}

function parseAmount(value: any): number {
  if (typeof value === 'string') {
    // Convert hex string to number
    return parseInt(value, 16);
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}

function formatTokens(amount: any): string {
  const numAmount = parseAmount(amount);
  const tokens = numAmount / Math.pow(10, TOKEN_DECIMALS);
  return tokens.toLocaleString(undefined, { maximumFractionDigits: 6, minimumFractionDigits: 6 });
}

function formatSol(lamports: any): string {
  const numLamports = parseAmount(lamports);
  const sol = numLamports / Math.pow(10, SOL_DECIMALS);
  return sol.toLocaleString(undefined, { maximumFractionDigits: 9, minimumFractionDigits: 9 });
}

async function main() {
  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}📊 DAT CYCLE EVENTS READER${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  // Get transaction signature from command line
  const txSignature = process.argv[2];

  if (!txSignature) {
    console.log("Usage: npx ts-node scripts/read-cycle-events.ts <TRANSACTION_SIGNATURE>");
    console.log("\nExample:");
    console.log("npx ts-node scripts/read-cycle-events.ts 2sCdazTV7GVuPiKhSdVWZaNGGyzHSFyD7e7TikzGckcJ7HtzuQtQE84fE2TbgzM2b7zEZ8ZTnBEYSVX7yoVkHLdB");
    process.exit(1);
  }

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const dummyWallet = Keypair.generate();
  const provider = new AnchorProvider(connection, new Wallet(dummyWallet), {});

  const idl = loadIdl();
  const program = new Program(idl, provider);

  log("🔍", `Fetching transaction: ${txSignature}`, colors.cyan);

  try {
    const tx = await connection.getTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed"
    });

    if (!tx) {
      log("❌", "Transaction not found", colors.red);
      process.exit(1);
    }

    log("✅", "Transaction found", colors.green);

    // Parse events from transaction
    const coder = new BorshCoder(idl);
    const eventParser = new EventParser(PROGRAM_ID, coder);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.cyan}📋 EVENTS IN TRANSACTION${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

    let foundEvents = false;

    if (tx.meta?.logMessages) {
      const events = eventParser.parseLogs(tx.meta.logMessages);

      for (const event of events) {
        foundEvents = true;

        if (event.name === "CycleCompleted") {
          const data = event.data as any;

          console.log(`${colors.bright}${colors.green}🔄 CycleCompleted Event${colors.reset}\n`);

          log("🔢", `Cycle Number: ${data.cycle_number || data.cycleNumber}`, colors.cyan);

          // Tokens burned (with decimals)
          const tokensBurnedRaw = data.tokens_burned || data.tokensBurned;
          const tokensBurned = formatTokens(tokensBurnedRaw);
          log("🔥", `Tokens Burned: ${tokensBurned} tokens (${parseAmount(tokensBurnedRaw).toLocaleString()} units)`, colors.yellow);

          // SOL used (with decimals)
          const solUsedRaw = data.sol_used || data.solUsed;
          const solUsed = formatSol(solUsedRaw);
          log("💰", `SOL Used: ${solUsed} SOL (${parseAmount(solUsedRaw).toLocaleString()} lamports)`, colors.yellow);

          // Total burned (with decimals)
          const totalBurnedRaw = data.total_burned || data.totalBurned;
          const totalBurned = formatTokens(totalBurnedRaw);
          log("📊", `Total Burned: ${totalBurned} tokens (${parseAmount(totalBurnedRaw).toLocaleString()} units)`, colors.green);

          // Total SOL collected (with decimals)
          const totalSolRaw = data.total_sol_collected || data.totalSolCollected;
          const totalSol = formatSol(totalSolRaw);
          log("💎", `Total SOL Collected: ${totalSol} SOL (${parseAmount(totalSolRaw).toLocaleString()} lamports)`, colors.green);

          // Timestamp
          const timestampSeconds = parseAmount(data.timestamp);
          const timestamp = new Date(timestampSeconds * 1000).toISOString();
          log("⏰", `Timestamp: ${timestamp}`, colors.cyan);

          console.log();
        } else if (event.name === "TokenCreated") {
          const data = event.data as any;

          console.log(`${colors.bright}${colors.magenta}🪙 TokenCreated Event${colors.reset}\n`);

          log("🎯", `Mint: ${data.mint.toString()}`, colors.cyan);
          log("📈", `Bonding Curve: ${data.bondingCurve.toString()}`, colors.cyan);
          log("👤", `Creator: ${data.creator.toString()}`, colors.cyan);
          log("📝", `Name: ${data.name}`, colors.yellow);
          log("🏷️", `Symbol: ${data.symbol}`, colors.yellow);

          const timestamp = new Date(Number(data.timestamp) * 1000).toISOString();
          log("⏰", `Timestamp: ${timestamp}`, colors.cyan);

          console.log();
        } else {
          console.log(`${colors.cyan}📌 ${event.name}${colors.reset}`);
          console.log(JSON.stringify(event.data, null, 2));
          console.log();
        }
      }
    }

    if (!foundEvents) {
      log("⚠️", "No events found in transaction", colors.yellow);
    }

    console.log(`${"=".repeat(70)}\n`);

  } catch (error: any) {
    log("❌", `Error reading transaction: ${error.message}`, colors.red);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
