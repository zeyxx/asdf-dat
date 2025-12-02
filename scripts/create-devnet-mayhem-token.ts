/**
 * Create Token2022 (Mayhem mode) Token via DAT Program - Parameterized
 *
 * Usage: npx ts-node scripts/create-devnet-mayhem-token.ts <name> <symbol> <outputFile>
 *
 * Example:
 *   npx ts-node scripts/create-devnet-mayhem-token.ts "Test Mayhem" "TMAY" "devnet-tokens/05-tmay.json"
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const MAYHEM_PROGRAM = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");

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

function loadIdl(): any {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  idl.metadata = { address: PROGRAM_ID.toString() };
  idl.address = PROGRAM_ID.toString();
  return idl;
}

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log(`
Usage: npx ts-node scripts/create-devnet-mayhem-token.ts <name> <symbol> <outputFile>

Arguments:
  name       - Token name (e.g., "Test Mayhem")
  symbol     - Token symbol (e.g., "TMAY")
  outputFile - Output JSON file path (e.g., "devnet-tokens/05-tmay.json")

Example:
  npx ts-node scripts/create-devnet-mayhem-token.ts "Test Mayhem" "TMAY" "devnet-tokens/05-tmay.json"
`);
    process.exit(1);
  }

  const name = args[0];
  const symbol = args[1];
  const outputFile = args[2];
  const uri = `https://pump.fun/${symbol.toLowerCase()}`;

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.cyan}CREATE MAYHEM TOKEN (Token2022) VIA DAT${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load admin wallet
  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("./devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  const balance = await connection.getBalance(admin.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const idl = loadIdl();
  const program = new Program(idl, provider);

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
  log("🔑", `DAT Authority (Creator): ${datAuthority.toString()}`, colors.cyan);

  // Verify DAT state
  try {
    const state = await (program.account as any).datState.fetch(datState);
    if (state.admin.toString() !== admin.publicKey.toString()) {
      log("❌", "Current wallet is not the DAT admin!", colors.red);
      process.exit(1);
    }
  } catch (e: any) {
    log("❌", `DAT State not found: ${e.message}`, colors.red);
    process.exit(1);
  }

  // Generate mint keypair
  const mint = Keypair.generate();
  log("🪙", `New Mint: ${mint.publicKey.toString()}`, colors.cyan);

  // Derive PumpFun PDAs
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );

  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  // For Token2022, ATA uses Token2022 program
  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      TOKEN_2022_PROGRAM_ID.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [global] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  // Mayhem-specific PDAs
  const [globalParams] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-params")],
    MAYHEM_PROGRAM
  );

  const [solVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol-vault")],
    MAYHEM_PROGRAM
  );

  const [mayhemState] = PublicKey.findProgramAddressSync(
    [Buffer.from("mayhem-state"), mint.publicKey.toBuffer()],
    MAYHEM_PROGRAM
  );

  const [mayhemTokenVault] = PublicKey.findProgramAddressSync(
    [
      solVault.toBuffer(),
      TOKEN_2022_PROGRAM_ID.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("🔥", `Mayhem Mode: ENABLED (Token2022)`, colors.yellow);

  log("📝", `Name: ${name}`, colors.cyan);
  log("🏷️", `Symbol: ${symbol}`, colors.cyan);

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.yellow}Creating Mayhem token...${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  try {
    // @ts-ignore - Type instantiation depth issue with Anchor types
    const tx = await program.methods
      .createPumpfunTokenMayhem(name, symbol, uri)
      .accounts({
        datState,
        datAuthority,
        admin: admin.publicKey,
        mint: mint.publicKey,
        mintAuthority,
        bondingCurve,
        associatedBondingCurve,
        global,
        systemProgram: SystemProgram.programId,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        mayhemProgram: MAYHEM_PROGRAM,
        globalParams,
        solVault,
        mayhemState,
        mayhemTokenVault,
        eventAuthority,
        pumpProgram: PUMP_PROGRAM,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ])
      .signers([mint])
      .rpc();

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.green}MAYHEM TOKEN CREATED!${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("📜", `TX: ${tx}`, colors.green);
    log("🔗", `Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
    log("🎯", `Creator: ${datAuthority.toString()}`, colors.green);
    log("🪙", `Mint: ${mint.publicKey.toString()}`, colors.green);
    log("🔥", `Mayhem Mode: AI agent will trade for 24h`, colors.yellow);

    // Ensure output directory exists
    const outputDir = path.dirname(outputFile);
    if (outputDir && !fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save token info
    const tokenInfo = {
      mint: mint.publicKey.toString(),
      bondingCurve: bondingCurve.toString(),
      creator: datAuthority.toString(),
      name,
      symbol,
      uri,
      isRoot: false,
      mayhemMode: true,
      tokenProgram: "Token2022",
      poolType: "bonding_curve",
      network: "devnet",
      timestamp: new Date().toISOString(),
      transaction: tx,
    };

    fs.writeFileSync(outputFile, JSON.stringify(tokenInfo, null, 2));

    log("💾", `Saved to: ${outputFile}`, colors.green);

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.cyan}NEXT STEPS${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("1️⃣", `Initialize TokenStats: npx ts-node scripts/init-token-stats.ts ${outputFile}`, colors.cyan);
    log("2️⃣", "Wait for AI agent trades or generate manual volume", colors.cyan);

  } catch (error: any) {
    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.red}ERROR${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("❌", error.message, colors.red);

    if (error.logs) {
      console.log("\n📋 Transaction Logs:");
      error.logs.slice(-15).forEach((l: string) => console.log(`   ${l}`));
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
