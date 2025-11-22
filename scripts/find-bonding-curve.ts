import { PublicKey } from "@solana/web3.js";
import fs from "fs";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

console.log("=".repeat(60));
console.log("🔍 FIND BONDING CURVE FOR TOKEN");
console.log("=".repeat(60));

// Load token info
const tokenInfoPath = "devnet-token-info.json";
if (!fs.existsSync(tokenInfoPath)) {
  console.error("❌ devnet-token-info.json not found");
  process.exit(1);
}

const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));

if (!tokenInfo.mint) {
  console.error("❌ Token info missing 'mint' field");
  process.exit(1);
}

const tokenMint = new PublicKey(tokenInfo.mint);
console.log("🪙 Token Mint:", tokenMint.toString());

// Derive bonding curve PDA
const [bondingCurve, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("bonding-curve"), tokenMint.toBuffer()],
  PUMP_PROGRAM
);

console.log("📈 Bonding Curve:", bondingCurve.toString());
console.log("🔢 Bump:", bump);

// Update token info file
tokenInfo.bondingCurve = bondingCurve.toString();

fs.writeFileSync(tokenInfoPath, JSON.stringify(tokenInfo, null, 2));
console.log("\n✅ Updated devnet-token-info.json with bondingCurve!");

console.log("\n" + "=".repeat(60));
console.log("✅ DONE! You can now run the test:");
console.log("   npx ts-node tests/scripts/test-dat-cycle.ts");
console.log("=".repeat(60));
