import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Check if bonding curve account exists directly on chain
 */

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

async function checkBondingCurveExists() {
  console.log("================================");
  console.log("CHECK BONDING CURVE ON CHAIN");
  console.log("================================\n");

  // Load token config
  const configPath = path.join(__dirname, "..", "devnet-config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const mintAddress = new PublicKey(config.token.mint);
  const bondingCurveAddress = new PublicKey(config.bondingCurve);

  console.log("📍 Token Mint:", mintAddress.toString());
  console.log("📍 Expected Bonding Curve:", bondingCurveAddress.toString());
  console.log();

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Check bonding curve account
  console.log("🔍 Checking bonding curve account...");
  try {
    const accountInfo = await connection.getAccountInfo(bondingCurveAddress);

    if (accountInfo) {
      console.log("✅ Bonding curve account EXISTS on chain!");
      console.log();
      console.log("📊 Account Info:");
      console.log("   Owner:", accountInfo.owner.toString());
      console.log("   Lamports:", accountInfo.lamports / 1e9, "SOL");
      console.log("   Data Length:", accountInfo.data.length, "bytes");
      console.log("   Executable:", accountInfo.executable);
      console.log();

      if (accountInfo.owner.toString() === PUMP_PROGRAM.toString()) {
        console.log("✅ Owner is PumpFun program - CORRECT!");
      } else {
        console.log("⚠️  Owner is NOT PumpFun program");
      }

      console.log();
      console.log("📝 Raw Data (first 100 bytes):");
      console.log(accountInfo.data.slice(0, 100));
      console.log();

      // Try to parse the data
      if (accountInfo.data.length >= 8) {
        console.log("🔍 Account appears to be initialized");
        console.log("   This means the bonding curve was created!");
        console.log();
        console.log("💡 The issue is likely with the SDK's buy() method on devnet");
        console.log("   The SDK might be checking for additional accounts that don't exist on devnet");
      }

    } else {
      console.log("❌ Bonding curve account does NOT exist on chain");
      console.log();
      console.log("💡 This means:");
      console.log("   - The 'Create' instruction in createAndBuy() failed");
      console.log("   - OR the bonding curve PDA derivation is wrong");
      console.log();
      console.log("🔗 Check the creation transaction:");
      console.log("   https://explorer.solana.com/address/" + mintAddress.toString() + "?cluster=devnet");
    }

  } catch (error: any) {
    console.error("❌ Error checking account:", error.message);
  }

  // Also check the mint account
  console.log("\n🔍 Checking mint account...");
  try {
    const mintAccountInfo = await connection.getAccountInfo(mintAddress);
    if (mintAccountInfo) {
      console.log("✅ Mint account EXISTS");
      console.log("   Owner:", mintAccountInfo.owner.toString());
      console.log("   Data Length:", mintAccountInfo.data.length, "bytes");
    } else {
      console.log("❌ Mint account does NOT exist");
    }
  } catch (error: any) {
    console.error("❌ Error:", error.message);
  }
}

checkBondingCurveExists()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
