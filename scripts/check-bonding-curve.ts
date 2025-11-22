import { Connection, PublicKey } from "@solana/web3.js";
import { PumpSdk } from "@pump-fun/pump-sdk";
import fs from "fs";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const sdk = new PumpSdk();

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  const bcAccount = await connection.getAccountInfo(bondingCurve);
  if (!bcAccount) {
    console.log("Bonding curve not found");
    process.exit(1);
  }

  const bcData = sdk.decodeBondingCurve(bcAccount);

  console.log("\n📈 Bonding Curve Data:");
  console.log("Creator:", bcData.creator.toString());
  console.log("Virtual SOL:", bcData.virtualSolReserves.toString());
  console.log("Virtual Token:", bcData.virtualTokenReserves.toString());
  console.log("Real SOL:", bcData.realSolReserves.toString());
  console.log("Real Token:", bcData.realTokenReserves.toString());
  console.log("Complete:", bcData.complete);
}

main();
