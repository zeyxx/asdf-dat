import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import fs from "fs";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);

  try {
    const wsolInfo = await getAccount(connection, poolWsolAccount);
    const tokenInfo = await getAccount(connection, poolTokenAccount);

    console.log("Pool WSOL Balance:", Number(wsolInfo.amount) / 1e9, "SOL");
    console.log("Pool Token Balance:", Number(tokenInfo.amount) / 1e6, "tokens");
    console.log("\nMax safe buy (1% of WSOL):", Number(wsolInfo.amount) / 100 / 1e9, "SOL");
  } catch (error: any) {
    console.error("Error:", error.message);
  }
}

main();
