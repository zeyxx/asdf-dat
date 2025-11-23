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

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const TOKEN_STATS_SEED = Buffer.from("token_stats_v1");

async function main() {
  // Get token file from command line args or default to SPL
  const tokenFile = process.argv[2] || "devnet-token-spl.json";

  console.log(`\n${"=".repeat(70)}`);
  console.log(`🔧 INITIALIZE TOKEN STATS`);
  console.log(`${"=".repeat(70)}\n`);
  console.log(`📄 Token file: ${tokenFile}`);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
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
  console.log(`🔗 TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
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
