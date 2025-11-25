/**
 * Buy Single Token Purchase using Official Pump SDK
 * Simple script to buy tokens once with specified amount
 *
 * Usage: npx ts-node scripts/buy-single-token.ts <token-file.json> <amount-sol>
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import fs from "fs";
import BN from "bn.js";

async function main() {
  const tokenFile = process.argv[2];
  const amountSol = parseFloat(process.argv[3] || "0.05");

  if (!tokenFile) {
    console.error("Usage: npx ts-node scripts/buy-single-token.ts <token-file.json> <amount-sol>");
    process.exit(1);
  }

  console.log(`🛒 Buying ${amountSol} SOL worth of tokens from ${tokenFile}`);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const sdk = new OnlinePumpSdk(connection);

  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);

  console.log(`   Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
  console.log(`   Mint: ${tokenMint.toString()}`);
  console.log(`   Buyer: ${buyer.publicKey.toString()}`);

  try {
    // Use SDK to buy tokens
    const solAmount = new BN(amountSol * 1e9);

    const result = await sdk.buy({
      mint: tokenMint,
      solAmount,
      slippage: 25, // 25% slippage for devnet
      wallet: buyer,
    });

    console.log(`✅ Buy successful!`);
    console.log(`   TX: https://explorer.solana.com/tx/${result}?cluster=devnet`);
    return result;
  } catch (error: any) {
    console.error(`❌ Buy failed: ${error.message}`);
    if (error.logs) {
      console.error("Logs:", error.logs.slice(-5));
    }
    throw error;
  }
}

main().catch(console.error);
