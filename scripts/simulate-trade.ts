import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";
import BN from "bn.js";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

console.log("=".repeat(60));
console.log("🛒 SIMULATE TRADE TO CREATE CREATOR VAULT");
console.log("=".repeat(60));

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load buyer wallet (admin)
  const buyerPath = "devnet-wallet.json";
  if (!fs.existsSync(buyerPath)) {
    console.error("❌ Wallet not found");
    process.exit(1);
  }

  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(buyerPath, "utf-8")))
  );

  console.log("👤 Buyer:", buyer.publicKey.toString());

  // Load token info
  const tokenInfoPath = "devnet-token-info.json";
  if (!fs.existsSync(tokenInfoPath)) {
    console.error("❌ Token info not found");
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  console.log("🪙 Token Mint:", tokenMint.toString());
  console.log("📈 Bonding Curve:", bondingCurve.toString());

  // Get buyer's SOL balance
  const balance = await connection.getBalance(buyer.publicKey);
  console.log("💰 Buyer SOL Balance:", (balance / 1e9).toFixed(4), "SOL");

  if (balance < 0.1 * 1e9) {
    console.log("\n⚠️  Low balance! You need at least 0.1 SOL");
    console.log("💡 Get devnet SOL: solana airdrop 1");
    process.exit(1);
  }

  // Check if buyer's token ATA exists
  const buyerTokenAta = await getAssociatedTokenAddress(tokenMint, buyer.publicKey);

  let ataExists = false;
  try {
    await getAccount(connection, buyerTokenAta);
    ataExists = true;
    console.log("✅ Buyer token ATA exists:", buyerTokenAta.toString());
  } catch {
    console.log("📝 Buyer token ATA doesn't exist yet, will create:", buyerTokenAta.toString());
  }

  // Derive creator vault authority
  const DAT_AUTHORITY = new PublicKey("6r5gW93qREotZ9gThTV7SAcekCRaBrua6e1YSxirfNDs");
  const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), DAT_AUTHORITY.toBuffer()],
    PUMPSWAP_PROGRAM
  );

  const creatorVault = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);

  console.log("🔑 Vault Authority:", vaultAuthority.toString());
  console.log("💼 Creator Vault ATA:", creatorVault.toString());

  // Check if creator vault exists
  try {
    const vaultAccount = await getAccount(connection, creatorVault);
    const vaultBalance = Number(vaultAccount.amount) / 1e9;
    console.log("✅ Creator Vault exists with", vaultBalance.toFixed(6), "SOL");
  } catch {
    console.log("⚠️  Creator Vault doesn't exist yet - will be created on first trade");
  }

  console.log("\n" + "=".repeat(60));
  console.log("📝 TO SIMULATE A TRADE:");
  console.log("=".repeat(60));
  console.log("\nYou have 2 options:\n");
  console.log("1. Use PumpFun SDK (recommended):");
  console.log("   - Install: npm install @pump-fun/pump-sdk");
  console.log("   - Use SDK to buy tokens (creates vault automatically)\n");
  console.log("2. Manual buy via PumpFun devnet UI:");
  console.log("   - Visit PumpFun devnet interface");
  console.log("   - Trade your token to generate fees\n");
  console.log("Once the vault is created with fees, run:");
  console.log("   npx ts-node tests/scripts/test-dat-cycle.ts");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
