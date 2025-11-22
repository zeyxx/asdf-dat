/**
 * Buy tokens to create creator vault
 *
 * This script makes a small buy (0.01 SOL) to:
 * 1. Create the creator vault ATA
 * 2. Generate initial fees
 * 3. Enable testing of collect_fees
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";
import BN from "bn.js";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const DAT_AUTHORITY = new PublicKey("6r5gW93qREotZ9gThTV7SAcekCRaBrua6e1YSxirfNDs");

// Buy amount in SOL
const BUY_AMOUNT_SOL = 0.01;
const BUY_AMOUNT_LAMPORTS = BUY_AMOUNT_SOL * 1e9;

console.log("=".repeat(60));
console.log("🛒 BUY TOKENS TO CREATE CREATOR VAULT");
console.log("=".repeat(60));

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load buyer wallet
  const walletPath = "devnet-wallet.json";
  if (!fs.existsSync(walletPath)) {
    console.error("\n❌ Wallet not found:", walletPath);
    process.exit(1);
  }

  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  console.log("\n👤 Buyer:", buyer.publicKey.toString());

  // Check balance
  const balance = await connection.getBalance(buyer.publicKey);
  console.log("💰 Balance:", (balance / 1e9).toFixed(4), "SOL");

  if (balance < 0.1 * 1e9) {
    console.log("\n⚠️  Insufficient balance! Need at least 0.1 SOL");
    console.log("💡 Get devnet SOL: solana airdrop 2");
    process.exit(1);
  }

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

  console.log("\n" + "=".repeat(60));
  console.log("🔍 CHECKING ACCOUNTS");
  console.log("=".repeat(60));

  // Derive PDAs
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), DAT_AUTHORITY.toBuffer()],
    PUMPSWAP_PROGRAM
  );

  console.log("\n✅ Global Config:", pumpGlobalConfig.toString());
  console.log("✅ Event Authority:", pumpEventAuthority.toString());
  console.log("✅ Vault Authority:", vaultAuthority.toString());

  // Get ATAs
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);
  const buyerTokenAccount = await getAssociatedTokenAddress(tokenMint, buyer.publicKey);
  const creatorVault = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);

  console.log("\n✅ Pool Token Account:", poolTokenAccount.toString());
  console.log("✅ Pool WSOL Account:", poolWsolAccount.toString());
  console.log("✅ Buyer Token Account:", buyerTokenAccount.toString());
  console.log("✅ Creator Vault:", creatorVault.toString());

  // Check if buyer token ATA exists
  let buyerAtaExists = false;
  try {
    await getAccount(connection, buyerTokenAccount);
    buyerAtaExists = true;
    console.log("\n✅ Buyer token ATA exists");
  } catch {
    console.log("\n📝 Buyer token ATA needs to be created");
  }

  console.log("\n" + "=".repeat(60));
  console.log("⚠️  IMPORTANT NOTE");
  console.log("=".repeat(60));
  console.log("\nTo execute a buy on PumpFun, you need:");
  console.log("1. The PumpFun program IDL");
  console.log("2. Or use @pump-fun/pump-swap-sdk package");
  console.log("\nThe SDK should be installed (version 1.11.0)");
  console.log("\nAlternatively, you can:");
  console.log("- Use PumpFun devnet UI to make a trade manually");
  console.log("- Or adapt tests/scripts/buy-with-idl.ts");
  console.log("\n" + "=".repeat(60));
  console.log("\n💡 RECOMMENDED: Use the PumpFun devnet interface");
  console.log("   This is the easiest way to create the vault.");
  console.log("\n   After making a trade, run:");
  console.log("   npx ts-node scripts/init-creator-vault.ts");
  console.log("   to verify the vault was created.");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("\n❌ Error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
