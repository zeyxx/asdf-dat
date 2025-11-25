/**
 * Create a NEW SPL token to use as secondary token for testing
 */

import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

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
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log(`${"=".repeat(60)}\n`);
}

function loadIdl(): Idl {
  const idlPath = path.join(__dirname, "..", "target", "idl", "asdf_dat.json");
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

async function main() {
  logSection("🪙 CREATE SECONDARY SPL TOKEN");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  const balance = await connection.getBalance(admin.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`, colors.cyan);

  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

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

  // Generate new mint
  const newMint = Keypair.generate();
  log("🪙", `New Mint: ${newMint.publicKey.toString()}`, colors.cyan);

  // Derive PumpFun PDAs
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );

  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), newMint.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      newMint.publicKey.toBuffer(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL") // ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(), // MPL_TOKEN_METADATA_PROGRAM
      newMint.publicKey.toBuffer(),
    ],
    new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s") // MPL_TOKEN_METADATA_PROGRAM
  );

  const [global] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  const name = "DAT Secondary Test";
  const symbol = "DATS2";
  const uri = "https://pump.fun/dat-secondary-test";

  log("📝", `Name: ${name}`, colors.cyan);
  log("🏷️", `Symbol: ${symbol}`, colors.cyan);
  log("🔗", `Token Program: SPL Token`, colors.cyan);

  logSection("⏳ Creating SPL token...");

  try {
    const tx = await program.methods
      .createPumpfunToken(name, symbol, uri) // Regular SPL token
      .accounts({
        datState,
        datAuthority,
        admin: admin.publicKey,
        mint: newMint.publicKey,
        mintAuthority,
        bondingCurve,
        associatedBondingCurve,
        metadata,
        global,
        mplTokenMetadata: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
        eventAuthority,
        pumpProgram: PUMP_PROGRAM,
      })
      .signers([newMint])
      .rpc();

    logSection("✅ SECONDARY SPL TOKEN CREATED!");

    log("📜", `TX: ${tx}`, colors.green);
    log("🔗", `Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
    log("🎯", `Creator: ${datAuthority.toString()}`, colors.green);
    log("🪙", `Mint: ${newMint.publicKey.toString()}`, colors.green);

    // Save token info
    const tokenInfo = {
      mint: newMint.publicKey.toString(),
      bondingCurve: bondingCurve.toString(),
      creator: datAuthority.toString(),
      name,
      symbol,
      uri,
      mayhemMode: false,
      tokenProgram: "SPL",
      network: "devnet",
      timestamp: new Date().toISOString(),
      transaction: tx,
    };

    const filename = "devnet-token-secondary.json";
    fs.writeFileSync(filename, JSON.stringify(tokenInfo, null, 2));
    log("💾", `Saved to: ${filename}`, colors.green);

    logSection("📋 NEXT STEPS");

    log("1️⃣", "Initialize token stats", colors.cyan);
    log("📝", `npx ts-node scripts/init-token-stats.ts ${filename}`, colors.yellow);
    log("2️⃣", "Make some trades to accumulate fees", colors.cyan);
    log("💡", "Use PumpFun devnet UI or scripts", colors.yellow);
    log("3️⃣", "Test the complete secondary token cycle", colors.cyan);
    log("📝", `npx ts-node scripts/execute-cycle-secondary.ts ${filename}`, colors.yellow);
  } catch (error: any) {
    log("❌", `Error: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Error logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main();
