import { Connection, PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk, creatorVaultPda } from "@pump-fun/pump-sdk";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import fs from "fs";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const sdk = new OnlinePumpSdk(connection);

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);

  const bondingCurve = await sdk.fetchBondingCurve(tokenMint);
  const creator = bondingCurve.creator;

  console.log("Token Mint:", tokenMint.toString());
  console.log("Creator:", creator.toString());

  // Use SDK function to derive vault
  const vaultPda = creatorVaultPda(creator);
  console.log("Vault PDA (from SDK):", vaultPda.toString());

  // Get ATA
  const vaultAta = await getAssociatedTokenAddress(WSOL_MINT, vaultPda, true);
  console.log("Vault ATA:", vaultAta.toString());

  try {
    const account = await getAccount(connection, vaultAta);
    console.log("✅ Vault EXISTS!");
    console.log("Balance:", (Number(account.amount) / 1e9).toFixed(6), "SOL");
  } catch (e: any) {
    console.log("❌ Vault does not exist");
    console.log("Error:", e.message);
  }
}

main();
