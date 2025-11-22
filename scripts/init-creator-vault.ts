/**
 * Initialize Creator Vault by making a small trade
 *
 * This script buys a small amount of tokens to:
 * 1. Create the creator vault ATA
 * 2. Generate initial fees
 * 3. Allow collect_fees to work in tests
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import fs from "fs";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const DAT_AUTHORITY = new PublicKey("6r5gW93qREotZ9gThTV7SAcekCRaBrua6e1YSxirfNDs");

console.log("=".repeat(60));
console.log("🔧 INITIALIZE CREATOR VAULT");
console.log("=".repeat(60));

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load wallet
  const walletPath = "devnet-wallet.json";
  if (!fs.existsSync(walletPath)) {
    console.error("\n❌ Wallet not found:", walletPath);
    process.exit(1);
  }

  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  console.log("\n👤 Wallet:", wallet.publicKey.toString());

  // Load token info
  const tokenInfoPath = "devnet-token-info.json";
  if (!fs.existsSync(tokenInfoPath)) {
    console.error("\n❌ Token info not found");
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  console.log("🪙 Token Mint:", tokenMint.toString());
  console.log("📈 Bonding Curve:", bondingCurve.toString());

  // Derive creator vault
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), DAT_AUTHORITY.toBuffer()],
    PUMPSWAP_PROGRAM
  );

  const creatorVault = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);

  console.log("\n🔑 Vault Authority:", vaultAuthority.toString());
  console.log("💼 Creator Vault:", creatorVault.toString());

  // Check creator vault status
  console.log("\n" + "=".repeat(60));
  console.log("📊 VAULT STATUS");
  console.log("=".repeat(60));

  try {
    const vaultAccount = await getAccount(connection, creatorVault);
    const vaultBalance = Number(vaultAccount.amount) / 1e9;

    console.log("\n✅ Creator Vault EXISTS!");
    console.log("💰 Balance:", vaultBalance.toFixed(6), "SOL");

    if (vaultBalance >= 0.01) {
      console.log("\n✅ Vault has sufficient fees for testing!");
      console.log("\n🎯 You can now run:");
      console.log("   npx ts-node tests/scripts/test-dat-cycle.ts");
    } else {
      console.log("\n⚠️  Vault exists but has insufficient fees (< 0.01 SOL)");
      console.log("\n💡 To add fees, someone needs to trade the token");
      console.log("   This will generate fees and add them to the vault");
    }
  } catch (error) {
    console.log("\n❌ Creator Vault DOES NOT EXIST");
    console.log("\n📝 The vault is created automatically on the first trade.");
    console.log("\n💡 TO CREATE THE VAULT:");
    console.log("\n   Option 1: Use PumpFun devnet interface");
    console.log("   - Find your token on PumpFun devnet");
    console.log("   - Make a small buy (0.01 SOL)");
    console.log("   - This creates the vault and generates fees");
    console.log("\n   Option 2: Use PumpFun SDK programmatically");
    console.log("   - Use @pump-fun/pump-swap-sdk");
    console.log("   - Call buy() function");
    console.log("   - See: tests/scripts/buy-with-idl.ts for reference");
    console.log("\n   Option 3: Skip this test for now");
    console.log("   - Test individual functions that don't need fees");
    console.log("   - Like: initialize, updateParameters, etc.");
  }

  console.log("\n" + "=".repeat(60));
}

main().catch((error) => {
  console.error("\n❌ Error:", error.message);
  process.exit(1);
});
