/**
 * Initialize TokenStats PDA for a token
 */

import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import idl from "../target/idl/asdf_dat.json";
import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const TOKEN_STATS_SEED = Buffer.from("token_stats_v1");

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  // Get token file from non-flag args or default
  const tokenFile = args.find(a => !a.startsWith('--')) || networkConfig.tokens[0];

  console.log(`\n${"=".repeat(70)}`);
  console.log(`🔧 INITIALIZE TOKEN STATS`);
  console.log(`${"=".repeat(70)}\n`);

  // Print network banner
  printNetworkBanner(networkConfig);

  console.log(`📄 Token file: ${tokenFile}`);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const program = new Program(idl as any, provider);

  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);

  console.log(`🪙 Token Mint: ${tokenMint.toString()}`);
  console.log(`📛 Name: ${tokenInfo.name}`);
  console.log(`🏷️  Symbol: ${tokenInfo.symbol}`);

  // Derive TokenStats PDA
  const [tokenStats, bump] = PublicKey.findProgramAddressSync(
    [TOKEN_STATS_SEED, tokenMint.toBuffer()],
    PROGRAM_ID
  );

  console.log(`📊 TokenStats PDA: ${tokenStats.toString()}`);
  console.log(`🔢 Bump: ${bump}`);

  // Check if already exists
  const accountInfo = await connection.getAccountInfo(tokenStats);
  if (accountInfo) {
    console.log("\n✅ TokenStats account already exists!");
    console.log(`   Account size: ${accountInfo.data.length} bytes`);
    return;
  }

  console.log("\n🔨 Creating TokenStats account...");

  // Call initialize_token_stats
  const tx = await program.methods
    .initializeTokenStats()
    .accounts({
      tokenStats,
      mint: tokenMint,
      payer: payer.publicKey,
      systemProgram: PublicKey.default,
    })
    .rpc();

  console.log(`\n✅ TokenStats initialized!`);
  const cluster = networkConfig.name === "Mainnet" ? "" : "?cluster=devnet";
  console.log(`🔗 TX: https://explorer.solana.com/tx/${tx}${cluster}`);
  console.log(`\n📊 TokenStats PDA: ${tokenStats.toString()}`);
  console.log(`\n💡 Use this address in your DAT cycle scripts`);
}

main().catch((error) => {
  console.error(`\n❌ Error: ${error.message}`);
  if (error.logs) {
    console.log("\n📋 Logs:");
    error.logs.forEach((log: string) => console.log(`   ${log}`));
  }
  process.exit(1);
});
