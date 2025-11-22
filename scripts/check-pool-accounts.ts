import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import fs from "fs";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  console.log("Token Mint:", tokenMint.toString());
  console.log("Bonding Curve:", bondingCurve.toString());

  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);

  console.log("\n=== Pool Accounts ===");
  console.log("Pool Token Account:", poolTokenAccount.toString());
  console.log("Pool WSOL Account:", poolWsolAccount.toString());

  console.log("\n=== Checking Existence ===");

  try {
    const tokenAcct = await getAccount(connection, poolTokenAccount);
    console.log("✅ Pool Token Account exists, balance:", Number(tokenAcct.amount));
  } catch {
    console.log("❌ Pool Token Account DOES NOT EXIST");
  }

  try {
    const wsolAcct = await getAccount(connection, poolWsolAccount);
    console.log("✅ Pool WSOL Account exists, balance:", Number(wsolAcct.amount) / 1e9, "SOL");
  } catch {
    console.log("❌ Pool WSOL Account DOES NOT EXIST");
  }
}

main();
