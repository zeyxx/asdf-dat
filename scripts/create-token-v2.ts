/**
 * Create Token2022 Token via DAT Program using create_v2
 *
 * Integrates with asdf-vanity-grinder for vanity mint addresses
 *
 * Usage:
 *   npx ts-node scripts/create-token-v2.ts <name> <symbol> <outputFile> [options]
 *
 * Options:
 *   --root                    Mark as root token
 *   --vanity-pool <url>       Fetch vanity mint from pool server (e.g., http://localhost:3030)
 *   --vanity-file <path>      Load vanity mint from JSON file
 *   --network <devnet|mainnet> Network to use (default: devnet)
 *
 * Examples:
 *   # Standard (random mint)
 *   npx ts-node scripts/create-token-v2.ts "Test Token" "TEST" "devnet-tokens/test.json"
 *
 *   # With vanity pool server (asdf-vanity-grinder)
 *   npx ts-node scripts/create-token-v2.ts "ASDF Token" "ASDF" "devnet-tokens/asdf.json" --vanity-pool http://localhost:3030
 *
 *   # With pre-generated vanity file
 *   npx ts-node scripts/create-token-v2.ts "ASDF Token" "ASDF" "devnet-tokens/asdf.json" --vanity-file ./vanity_mints.json
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { getNetworkConfig, NetworkType } from "../lib/network-config";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
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

interface VanityKeypair {
  pubkey: string;
  secret: number[];
}

/**
 * Fetch vanity keypair from asdf-vanity-grinder pool server
 */
async function fetchFromVanityPool(poolUrl: string): Promise<Keypair> {
  log("🎰", `Fetching vanity mint from pool: ${poolUrl}`, colors.magenta);

  try {
    const response = await fetch(`${poolUrl}/keypair`);
    if (!response.ok) {
      throw new Error(`Pool server returned ${response.status}: ${await response.text()}`);
    }
    const data: VanityKeypair = await response.json();
    const keypair = Keypair.fromSecretKey(new Uint8Array(data.secret));
    log("✨", `Got vanity mint: ${keypair.publicKey.toString()}`, colors.magenta);
    return keypair;
  } catch (error: any) {
    throw new Error(`Failed to fetch from vanity pool: ${error.message}`);
  }
}

/**
 * Load vanity keypair from local file (asdf-vanity-grinder output)
 */
function loadFromVanityFile(filePath: string): Keypair {
  log("📂", `Loading vanity mint from file: ${filePath}`, colors.magenta);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Vanity file not found: ${filePath}`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  // Support both single keypair and array format
  const keypairData: VanityKeypair = Array.isArray(data) ? data[0] : data;

  if (!keypairData || !keypairData.secret) {
    throw new Error("Invalid vanity file format. Expected {pubkey, secret} or [{pubkey, secret}]");
  }

  const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData.secret));
  log("✨", `Loaded vanity mint: ${keypair.publicKey.toString()}`, colors.magenta);

  // Remove used keypair from file if it's an array
  if (Array.isArray(data) && data.length > 1) {
    fs.writeFileSync(filePath, JSON.stringify(data.slice(1), null, 2));
    log("📝", `Removed used keypair from file (${data.length - 1} remaining)`, colors.cyan);
  }

  return keypair;
}

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);

  if (args.length < 3 || args.includes("--help") || args.includes("-h")) {
    console.log(`
${colors.bright}${colors.cyan}Create Token2022 Token via DAT Program (create_v2)${colors.reset}

Usage: npx ts-node scripts/create-token-v2.ts <name> <symbol> <outputFile> [options]

Arguments:
  name       - Token name (e.g., "ASDF Token")
  symbol     - Token symbol (e.g., "ASDF")
  outputFile - Output JSON file path (e.g., "devnet-tokens/asdf.json")

Options:
  --root                      Mark as root token
  --vanity-pool <url>         Fetch vanity mint from pool server
  --vanity-file <path>        Load vanity mint from JSON file
  --network <devnet|mainnet>  Network to use (default: devnet)

Examples:
  # Standard (random mint)
  npx ts-node scripts/create-token-v2.ts "Test Token" "TEST" "devnet-tokens/test.json"

  # With vanity pool server
  npx ts-node scripts/create-token-v2.ts "ASDF" "ASDF" "tokens/asdf.json" --vanity-pool http://localhost:3030

  # With pre-generated vanity file
  npx ts-node scripts/create-token-v2.ts "ASDF" "ASDF" "tokens/asdf.json" --vanity-file ./vanity_mints.json

${colors.magenta}Vanity Pool Integration:${colors.reset}
  Run asdf-vanity-grinder pool server:
    ./asdf-vanity-grinder pool --port 3030 --suffix ASDF

  Or generate vanity mints offline:
    ./asdf-vanity-grinder generate --suffix ASDF --count 10 --output vanity_mints.json
`);
    process.exit(0);
  }

  const name = args[0];
  const symbol = args[1];
  const outputFile = args[2];
  const isRoot = args.includes("--root");
  const uri = `https://pump.fun/${symbol.toLowerCase()}`;

  // Parse network
  const networkIndex = args.indexOf("--network");
  const network: NetworkType = networkIndex !== -1 && args[networkIndex + 1]
    ? (args[networkIndex + 1] as NetworkType)
    : "devnet";

  // Parse vanity options
  const vanityPoolIndex = args.indexOf("--vanity-pool");
  const vanityFileIndex = args.indexOf("--vanity-file");
  const vanityPoolUrl = vanityPoolIndex !== -1 ? args[vanityPoolIndex + 1] : null;
  const vanityFilePath = vanityFileIndex !== -1 ? args[vanityFileIndex + 1] : null;

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.cyan}CREATE TOKEN2022 TOKEN (create_v2)${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  const config = getNetworkConfig(network);
  const rpcUrl = Array.isArray(config.rpcUrl) ? config.rpcUrl[0] : config.rpcUrl;
  const connection = new Connection(rpcUrl, "confirmed");

  // Load admin wallet
  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(config.wallet, "utf-8")))
  );

  log("🌐", `Network: ${network.toUpperCase()}`, colors.cyan);
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

  // Get mint keypair (vanity or random)
  let mint: Keypair;
  if (vanityPoolUrl) {
    mint = await fetchFromVanityPool(vanityPoolUrl);
  } else if (vanityFilePath) {
    mint = loadFromVanityFile(vanityFilePath);
  } else {
    mint = Keypair.generate();
    log("🎲", `Generated random mint: ${mint.publicKey.toString()}`, colors.cyan);
  }

  log("🪙", `Mint: ${mint.publicKey.toString()}`, colors.green);

  // Derive PumpFun PDAs for Token2022
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );

  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  // Token2022 ATA uses different program
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

  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("📝", `Name: ${name}`, colors.cyan);
  log("🏷️", `Symbol: ${symbol}`, colors.cyan);
  log("🔗", `Token Program: Token2022 (create_v2)`, colors.magenta);
  if (isRoot) {
    log("👑", `Root Token: YES`, colors.yellow);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.yellow}Creating Token2022 token...${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  try {
    const tx = await program.methods
      .createPumpfunTokenV2(name, symbol, uri)
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
        eventAuthority,
        pumpProgram: PUMP_PROGRAM,
      })
      .signers([mint])
      .rpc();

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.green}TOKEN2022 TOKEN CREATED!${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("📜", `TX: ${tx}`, colors.green);
    log("🔗", `Explorer: https://explorer.solana.com/tx/${tx}?cluster=${network}`, colors.cyan);
    log("🎯", `Creator: ${datAuthority.toString()}`, colors.green);
    log("🪙", `Mint: ${mint.publicKey.toString()}`, colors.green);

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
      isRoot,
      mayhemMode: false,
      tokenProgram: "Token2022",
      poolType: "bonding_curve",
      network,
      timestamp: new Date().toISOString(),
      transaction: tx,
    };

    fs.writeFileSync(outputFile, JSON.stringify(tokenInfo, null, 2));

    log("💾", `Saved to: ${outputFile}`, colors.green);

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.cyan}NEXT STEPS${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("1️⃣", `Initialize TokenStats: npx ts-node scripts/init-token-stats.ts ${outputFile} --network ${network}`, colors.cyan);
    if (isRoot) {
      log("2️⃣", `Set as root token: npx ts-node scripts/set-root-token.ts ${outputFile} --network ${network}`, colors.cyan);
    }

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
