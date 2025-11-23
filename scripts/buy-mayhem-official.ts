import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { OnlinePumpSdk, getBuyTokenAmountFromSolAmount, PUMP_SDK } from "@pump-fun/pump-sdk";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import fs from "fs";
import BN from "bn.js";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log(`${colors.bright}${colors.cyan}🛒 ACHAT MAYHEM MODE (SDK OFFICIEL PUMP)${colors.reset}`);
  console.log("=".repeat(70) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load buyer wallet
  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("./devnet-wallet.json", "utf-8")))
  );

  log("👤", `Buyer: ${buyer.publicKey.toString()}`, colors.cyan);

  const balance = await connection.getBalance(buyer.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`, colors.cyan);

  // Load token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const mint = new PublicKey(tokenInfo.mint);

  log("🪙", `Token Mint: ${mint.toString()}`, colors.cyan);
  log("🔥", `Mayhem Mode: ${tokenInfo.mayhemMode}`, colors.yellow);

  // Create SDK
  const sdk = new OnlinePumpSdk(connection);

  log("🔍", "Fetching global config...", colors.yellow);
  const global = await sdk.fetchGlobal();
  log("✅", "Global config fetched", colors.green);

  log("🔍", "Fetching buy state...", colors.yellow);
  const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
    await sdk.fetchBuyState(mint, buyer.publicKey, TOKEN_2022_PROGRAM_ID);
  log("✅", "Buy state fetched", colors.green);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Buy with 0.01 SOL
  const solAmount = new BN(0.01 * 1e9); // 0.01 SOL
  log("💵", `Buying with: ${solAmount.toNumber() / 1e9} SOL`, colors.yellow);

  // Calculate expected token amount
  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig: null,
    mintSupply: null,
    bondingCurve,
    amount: solAmount,
  });
  log("💎", `Expected tokens: ${tokenAmount.toString()}`, colors.yellow);

  console.log("\n" + "=".repeat(70));
  log("⏳", "Creating buy instructions...", colors.yellow);
  console.log("=".repeat(70) + "\n");

  try {
    // Create buy instructions using PUMP_SDK
    const instructions = await PUMP_SDK.buyInstructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      associatedUserAccountInfo,
      mint,
      user: buyer.publicKey,
      solAmount,
      amount: tokenAmount,
      slippage: 10, // 10% slippage
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });

    log("✅", `Created ${instructions.length} instruction(s)`, colors.green);

    // Create and send transaction
    const tx = new Transaction().add(...instructions);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = buyer.publicKey;

    log("📤", "Sending transaction...", colors.yellow);

    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [buyer],
      {
        commitment: "confirmed",
        skipPreflight: false,
      }
    );

    console.log("\n" + "=".repeat(70));
    log("✅", "ACHAT RÉUSSI!", colors.bright + colors.green);
    console.log("=".repeat(70) + "\n");

    log("📜", `Signature: ${sig}`, colors.green);
    log("🔗", `Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`, colors.cyan);

    console.log("\n" + "=".repeat(70));
    log("🎉", "PROCHAINES ÉTAPES:", colors.bright + colors.cyan);
    console.log("=".repeat(70) + "\n");

    log("1️⃣", "Le pool est maintenant initialisé", colors.cyan);
    log("2️⃣", "Des fees sont maintenant disponibles dans le creator vault", colors.cyan);
    log("3️⃣", "Vous pouvez tester le cycle DAT complet", colors.cyan);
    log("💊", "npx ts-node --transpile-only scripts/test-mayhem-cycle.ts", colors.yellow);

  } catch (error: any) {
    console.log("\n" + "=".repeat(70));
    log("❌", "ERREUR", colors.bright + colors.red);
    console.log("=".repeat(70) + "\n");

    log("❌", `Erreur: ${error.message}`, colors.red);

    if (error.logs) {
      console.log("\n📋 Logs de transaction:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }

    console.error(error);

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  console.error(error);
  process.exit(1);
});
