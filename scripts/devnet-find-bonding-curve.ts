import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Find the bonding curve address for a PumpFun token
 * The bonding curve is a PDA derived from the mint
 */

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const GLOBAL_STATE = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");

async function findBondingCurvePDA(mint: PublicKey): Promise<[PublicKey, number]> {
  // The bonding curve PDA is derived using the mint address
  // Seed: ["bonding-curve", mint]
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM
  );
}

async function findAssociatedBondingCurve(mint: PublicKey): Promise<PublicKey> {
  // Associated bonding curve token account
  const [bondingCurve] = await findBondingCurvePDA(mint);

  // Get the ATA for the bonding curve
  const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

  const [ata] = PublicKey.findProgramAddressSync(
    [bondingCurve.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM
  );

  return ata;
}

async function main() {
  console.log("================================");
  console.log("PUMPFUN BONDING CURVE FINDER");
  console.log("================================\n");

  // Read token info
  const tokenInfoPath = path.join(process.cwd(), "devnet-token-info.json");

  if (!fs.existsSync(tokenInfoPath)) {
    console.error("❌ devnet-token-info.json not found!");
    console.error("   Run: npm run devnet:create-token first");
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const mintAddress = new PublicKey(tokenInfo.mint);

  console.log("🔍 Finding bonding curve for token:");
  console.log("   Mint:", mintAddress.toString());
  console.log();

  // Derive bonding curve PDA
  const [bondingCurve, bump] = await findBondingCurvePDA(mintAddress);
  console.log("✅ Bonding Curve PDA:");
  console.log("   Address:", bondingCurve.toString());
  console.log("   Bump:", bump);
  console.log();

  // Get associated bonding curve token account
  const bondingCurveATA = await findAssociatedBondingCurve(mintAddress);
  console.log("✅ Bonding Curve Token Account:");
  console.log("   Address:", bondingCurveATA.toString());
  console.log();

  // Connect and verify
  const network = process.env.SOLANA_NETWORK || "devnet";
  const rpcUrl = network === "mainnet"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";

  const connection = new Connection(rpcUrl, "confirmed");

  console.log("🔗 Verifying on", network, "...");

  try {
    const accountInfo = await connection.getAccountInfo(bondingCurve);
    if (accountInfo) {
      console.log("✅ Bonding curve account exists!");
      console.log("   Owner:", accountInfo.owner.toString());
      console.log("   Lamports:", accountInfo.lamports / 1e9, "SOL");
      console.log("   Data size:", accountInfo.data.length, "bytes");
    } else {
      console.log("⚠️  Bonding curve account not found on chain");
      console.log("   This might be normal if the token was just created");
    }
  } catch (error: any) {
    console.log("⚠️  Could not verify account:", error.message);
  }

  console.log();

  // Update config file
  const configPath = path.join(process.cwd(), "devnet-config.json");

  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.bondingCurve = bondingCurve.toString();
    config.bondingCurveATA = bondingCurveATA.toString();
    config.bondingCurveBump = bump;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("✅ Updated devnet-config.json with bonding curve addresses");
    console.log();
  }

  // Display summary
  console.log("================================");
  console.log("ADDRESSES TO USE");
  console.log("================================");
  console.log();
  console.log("Add these to your lib.rs:");
  console.log();
  console.log(`ASDF_MINT = "${mintAddress.toString()}"`);
  console.log(`BONDING_CURVE = "${bondingCurve.toString()}"`);
  console.log(`BONDING_CURVE_ATA = "${bondingCurveATA.toString()}"`);
  console.log();
  console.log("🔗 Explorer Links:");
  console.log(`  Mint: https://explorer.solana.com/address/${mintAddress.toString()}?cluster=${network}`);
  console.log(`  Bonding Curve: https://explorer.solana.com/address/${bondingCurve.toString()}?cluster=${network}`);
  console.log();
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
