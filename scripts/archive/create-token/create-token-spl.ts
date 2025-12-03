/**
 * Create SPL Token via DAT Program
 *
 * Uses the DAT program's create_pumpfun_token instruction to create
 * a regular SPL token (not Token2022) on PumpFun bonding curve.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const MPL_TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

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

function loadIdl(): Idl {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;
  if (idl.metadata) {
    (idl.metadata as any).address = PROGRAM_ID.toString();
  } else {
    (idl as any).metadata = { address: PROGRAM_ID.toString() };
  }
  return idl;
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.cyan}🪙 CREATE SPL TOKEN VIA DAT${colors.reset}`);
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
  const program: Program<Idl> = new Program(idl, provider);

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

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    MPL_TOKEN_METADATA
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

  const name = "DAT SPL Test";
  const symbol = "DATSPL";
  const uri = "https://pump.fun/dat-spl-test";

  log("📝", `Name: ${name}`, colors.cyan);
  log("🏷️", `Symbol: ${symbol}`, colors.cyan);
  log("🔗", `Token Program: SPL Token`, colors.cyan);

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.yellow}⏳ Creating SPL token...${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  try {
    const tx = await program.methods
      .createPumpfunToken(name, symbol, uri)
      .accounts({
        datState,
        datAuthority,
        admin: admin.publicKey,
        mint: mint.publicKey,
        mintAuthority,
        bondingCurve,
        associatedBondingCurve,
        metadata,
        global,
        mplTokenMetadata: MPL_TOKEN_METADATA,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        eventAuthority,
        pumpProgram: PUMP_PROGRAM,
      })
      .signers([mint])
      .rpc();

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.green}✅ SPL TOKEN CREATED!${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("📜", `TX: ${tx}`, colors.green);
    log("🔗", `Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
    log("🎯", `Creator: ${datAuthority.toString()}`, colors.green);
    log("🪙", `Mint: ${mint.publicKey.toString()}`, colors.green);

    // Save token info
    const tokenInfo = {
      mint: mint.publicKey.toString(),
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

    fs.writeFileSync(
      "devnet-token-spl.json",
      JSON.stringify(tokenInfo, null, 2)
    );

    log("💾", "Saved to: devnet-token-spl.json", colors.green);

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.cyan}📋 NEXT STEPS${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("1️⃣", "Initialize pool accounts", colors.cyan);
    log("📝", "npx ts-node scripts/init-spl-pool-accounts.ts", colors.yellow);
    log("2️⃣", "Make trades to accumulate fees", colors.cyan);
    log("💡", "Use PumpFun devnet UI or scripts", colors.yellow);
    log("3️⃣", "Test the complete DAT cycle", colors.cyan);
    log("📝", "npx ts-node scripts/test-spl-full-cycle.ts", colors.yellow);

  } catch (error: any) {
    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.red}❌ ERROR${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("❌", error.message, colors.red);

    if (error.logs) {
      console.log("\n📋 Transaction Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
