/**
 * Launch Token in Mayhem Mode
 *
 * Creates a PumpFun token with Mayhem Mode enabled:
 * - 2 billion token supply (1B + 1B for AI agent)
 * - AI agent trades automatically for 24 hours
 * - Uses Token2022 program
 * - Mainnet only (Mayhem Mode not available on devnet)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

// ==================== CONFIGURATION ====================

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const MAYHEM_PROGRAM = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Token metadata - CUSTOMIZE THIS!
const TOKEN_METADATA = {
  name: "ASDF Mayhem Test",
  symbol: "ASDFT",
  description: "Test token launched via DAT in Mayhem Mode with AI agent trading",
  twitter: "https://twitter.com/asdf",
  telegram: "https://t.me/asdf",
  website: "https://asdf.com",
  image: "./token-image.png", // Path to your token image
};

// Network - IMPORTANT: Mayhem Mode is MAINNET ONLY!
const NETWORK: "mainnet-beta" | "devnet" = "mainnet-beta"; // or "devnet" for testing regular mode
const RPC_URL = NETWORK === "mainnet-beta"
  ? "https://api.mainnet-beta.solana.com"
  : "https://api.devnet.solana.com";

// ==================== HELPER FUNCTIONS ====================

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
  console.log(`\n${colors.bright}${colors.cyan}${"=".repeat(60)}`);
  console.log(title);
  console.log(`${"=".repeat(60)}${colors.reset}\n`);
}

function loadIdl(): Idl {
  const possiblePaths = [
    "target/idl/asdf_dat.json",
    "../target/idl/asdf_dat.json",
    "../../target/idl/asdf_dat.json",
    path.join(__dirname, "../target/idl/asdf_dat.json"),
  ];

  for (const idlPath of possiblePaths) {
    try {
      if (fs.existsSync(idlPath)) {
        const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;
        if (idl.metadata) {
          (idl.metadata as any).address = PROGRAM_ID.toString();
        } else {
          (idl as any).metadata = { address: PROGRAM_ID.toString() };
        }
        return idl;
      }
    } catch (error) {
      continue;
    }
  }

  throw new Error("❌ IDL not found. Run: anchor build");
}

async function uploadMetadata(metadata: typeof TOKEN_METADATA): Promise<string> {
  // TODO: Upload to IPFS or Arweave
  // For now, return a placeholder URI
  // You should use a service like NFT.storage, Pinata, or Arweave

  log("⚠️", "Metadata upload not implemented - using placeholder", colors.yellow);
  log("💡", "Upload your metadata to IPFS/Arweave and update this function", colors.yellow);

  return "https://placeholder.com/metadata.json";
}

// ==================== MAIN FUNCTION ====================

async function main() {
  console.clear();
  logSection("🔥 LAUNCH TOKEN IN MAYHEM MODE 🔥");

  // Network check
  if (NETWORK === "devnet") {
    log("⚠️", "WARNING: Mayhem Mode is MAINNET ONLY!", colors.red);
    log("💡", "Change NETWORK to 'mainnet-beta' to use Mayhem Mode", colors.yellow);
    log("ℹ️", "Continuing with devnet for testing...", colors.cyan);
  } else {
    log("🚀", "Network: MAINNET-BETA", colors.green);
    log("⚠️", "This will use REAL SOL!", colors.red);
  }

  const connection = new Connection(RPC_URL, "confirmed");

  // Load wallet
  const walletPath = NETWORK === "mainnet-beta"
    ? "mainnet-wallet.json"
    : "devnet-wallet.json";

  if (!fs.existsSync(walletPath)) {
    log("❌", `Wallet not found: ${walletPath}`, colors.red);
    log("💡", `Create it with: solana-keygen new -o ${walletPath}`, colors.yellow);
    process.exit(1);
  }

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Check balance
  const balance = await connection.getBalance(admin.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`,
    balance > 0.1 * 1e9 ? colors.green : colors.red);

  if (balance < 0.1 * 1e9) {
    log("❌", "Insufficient balance! Need at least 0.1 SOL", colors.red);
    process.exit(1);
  }

  // Load config
  const configPath = NETWORK === "mainnet-beta"
    ? "config/mainnet-dat-deployment.json"
    : "config/devnet-dat-deployment.json";

  if (!fs.existsSync(configPath)) {
    log("❌", `Config not found: ${configPath}`, colors.red);
    log("💡", "Initialize DAT first with: npm run init", colors.yellow);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const datState = new PublicKey(config.datState);
  const datAuthority = new PublicKey(config.datAuthority);

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(
    connection,
    new Wallet(admin),
    { commitment: "confirmed" }
  );

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  log("✅", "Program loaded", colors.green);

  logSection("📝 TOKEN METADATA");

  log("🏷️", `Name: ${TOKEN_METADATA.name}`, colors.cyan);
  log("🔤", `Symbol: ${TOKEN_METADATA.symbol}`, colors.cyan);
  log("📄", `Description: ${TOKEN_METADATA.description}`, colors.cyan);

  // Upload metadata
  log("\n📤", "Uploading metadata...", colors.yellow);
  const metadataUri = await uploadMetadata(TOKEN_METADATA);
  log("✅", `Metadata URI: ${metadataUri}`, colors.green);

  logSection("🔧 PREPARING ACCOUNTS");

  // Generate new mint keypair
  const mint = Keypair.generate();
  log("🪙", `Mint: ${mint.publicKey.toString()}`, colors.cyan);

  // Derive PDAs
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );

  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  const [global] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [globalParams] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-params")],
    MAYHEM_PROGRAM
  );

  const [solVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol-vault")],
    MAYHEM_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  // Associated bonding curve (Token2022 ATA)
  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      TOKEN_2022_PROGRAM.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM
  );

  // Mayhem-specific PDAs
  const [mayhemState] = PublicKey.findProgramAddressSync(
    [Buffer.from("mayhem-state"), mint.publicKey.toBuffer()],
    MAYHEM_PROGRAM
  );

  const [mayhemTokenVault] = PublicKey.findProgramAddressSync(
    [
      solVault.toBuffer(),
      TOKEN_2022_PROGRAM.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM
  );

  log("✅", "All PDAs derived", colors.green);

  logSection("🚀 LAUNCHING TOKEN IN MAYHEM MODE");

  log("⏳", "Calling create_pumpfun_token_mayhem...", colors.yellow);

  try {
    const tx = await program.methods
      .createPumpfunTokenMayhem(
        TOKEN_METADATA.name,
        TOKEN_METADATA.symbol,
        metadataUri
      )
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
        token2022Program: TOKEN_2022_PROGRAM,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
        mayhemProgram: MAYHEM_PROGRAM,
        globalParams,
        solVault,
        mayhemState,
        mayhemTokenVault,
        eventAuthority,
        pumpProgram: PUMP_PROGRAM,
      })
      .signers([mint])
      .rpc();

    log("✅", "TOKEN CREATED IN MAYHEM MODE!", colors.green);
    log("🔗", `Transaction: https://solscan.io/tx/${tx}${NETWORK === "mainnet-beta" ? "" : "?cluster=devnet"}`, colors.cyan);

    logSection("🎉 SUCCESS!");

    const tokenInfo = {
      mint: mint.publicKey.toString(),
      bondingCurve: bondingCurve.toString(),
      creator: datAuthority.toString(),
      network: NETWORK,
      mayhemMode: true,
      supply: "2000000000", // 2 billion
      metadata: TOKEN_METADATA,
      timestamp: new Date().toISOString(),
      transaction: tx,
    };

    // Save token info
    const tokenInfoPath = `${NETWORK}-mayhem-token-info.json`;
    fs.writeFileSync(tokenInfoPath, JSON.stringify(tokenInfo, null, 2));

    log("💾", `Token info saved to: ${tokenInfoPath}`, colors.green);
    log("🪙", `Mint: ${mint.publicKey.toString()}`, colors.magenta);
    log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.magenta);
    log("🤖", `AI Agent: Active for 24 hours`, colors.green);
    log("📊", `Supply: 2 billion tokens (1B + 1B for agent)`, colors.cyan);

    logSection("⏭️ NEXT STEPS");

    log("1️⃣", "Monitor your token on PumpFun", colors.cyan);
    log("2️⃣", "AI agent will trade for 24 hours", colors.cyan);
    log("3️⃣", "DAT will collect fees automatically", colors.cyan);
    log("4️⃣", "Run: npx ts-node scripts/init-creator-vault.ts to check vault", colors.cyan);

  } catch (error: any) {
    log("❌", `Error: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});
