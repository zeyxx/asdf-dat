import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { PumpFunSDK } from "pumpdotfun-sdk";
import { AnchorProvider } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import * as fs from "fs";
import * as path from "path";

/**
 * Script to initialize PumpFun bonding curve by performing first buy
 * This creates the bonding curve account on-chain
 */

interface DevnetConfig {
  token: {
    mint: string;
  };
}

async function initializeBondingCurve() {
  console.log("================================");
  console.log("PUMPFUN BONDING CURVE INITIALIZER");
  console.log("================================\n");

  // 1. Load configuration
  const configPath = path.join(__dirname, "..", "devnet-config.json");
  if (!fs.existsSync(configPath)) {
    console.error("❌ devnet-config.json not found!");
    console.log("   Run: npm run devnet:create-token first");
    process.exit(1);
  }

  const config: DevnetConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const mintAddress = new PublicKey(config.token.mint);

  console.log("📍 Token Mint:", mintAddress.toString());
  console.log();

  // 2. Load wallet
  const walletPath = path.join(__dirname, "..", "devnet-wallet.json");
  if (!fs.existsSync(walletPath)) {
    console.error("❌ Wallet not found:", walletPath);
    console.log("\n💡 Create wallet first:");
    console.log("   solana-keygen new --outfile devnet-wallet.json");
    process.exit(1);
  }

  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  console.log("👛 Wallet:", walletKeypair.publicKey.toString());

  // 3. Setup connection and SDK
  const network = process.env.SOLANA_NETWORK || "devnet";
  const rpcUrl = network === "mainnet"
    ? process.env.RPC_URL || "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";

  console.log("🌐 Network:", network);
  console.log("🔗 RPC:", rpcUrl);
  console.log();

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new NodeWallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const sdk = new PumpFunSDK(provider);

  // 4. Check wallet balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("💰 Balance:", (balance / LAMPORTS_PER_SOL).toFixed(4), "SOL");

  if (balance < 0.01 * LAMPORTS_PER_SOL) {
    console.error("❌ Insufficient balance! Need at least 0.01 SOL");
    console.log("\n💡 Get devnet SOL:");
    console.log("   solana airdrop 2");
    process.exit(1);
  }
  console.log();

  // 5. Check if bonding curve already exists
  console.log("🔍 Checking bonding curve status...");
  try {
    const bondingCurveAccount = await sdk.getBondingCurveAccount(mintAddress);

    if (bondingCurveAccount) {
      console.log("✅ Bonding curve already exists!");
      console.log("\n📊 Bonding Curve Details:");
      console.log("   Virtual Token Reserves:", bondingCurveAccount.virtualTokenReserves?.toString());
      console.log("   Virtual SOL Reserves:", bondingCurveAccount.virtualSolReserves?.toString());
      console.log("   Real Token Reserves:", bondingCurveAccount.realTokenReserves?.toString());
      console.log("   Real SOL Reserves:", bondingCurveAccount.realSolReserves?.toString());
      console.log();
      console.log("✨ Bonding curve is ready to use!");
      return;
    }
  } catch (error: any) {
    console.log("⚠️  Bonding curve not found on chain");
  }

  console.log("🚀 Initializing bonding curve with first buy...");
  console.log();

  // 6. Perform buy to initialize bonding curve
  const buyAmount = 0.01; // 0.01 SOL
  const buyAmountLamports = BigInt(Math.floor(buyAmount * LAMPORTS_PER_SOL));
  const slippageBasisPoints = 500n; // 5% slippage

  console.log("💳 Buy Parameters:");
  console.log("   Amount:", buyAmount, "SOL");
  console.log("   Slippage:", "5%");
  console.log();

  try {
    console.log("⏳ Executing buy transaction...");

    const result = await sdk.buy(
      walletKeypair,
      mintAddress,
      buyAmountLamports,
      slippageBasisPoints,
      {
        unitLimit: 250_000,
        unitPrice: 250_000,
      }
    );

    console.log();
    if (result.success) {
      console.log("✅ Buy successful!");
      console.log("   Signature:", result.signature);
      console.log("   Explorer:", `https://explorer.solana.com/tx/${result.signature}?cluster=${network}`);
      console.log();

      // 7. Verify bonding curve now exists
      console.log("🔍 Verifying bonding curve...");
      const bondingCurveAccount = await sdk.getBondingCurveAccount(mintAddress);

      if (bondingCurveAccount) {
        console.log("✅ Bonding curve successfully initialized!");
        console.log();
        console.log("📊 Bonding Curve Details:");
        console.log("   Virtual Token Reserves:", bondingCurveAccount.virtualTokenReserves?.toString());
        console.log("   Virtual SOL Reserves:", bondingCurveAccount.virtualSolReserves?.toString());
        console.log("   Real Token Reserves:", bondingCurveAccount.realTokenReserves?.toString());
        console.log("   Real SOL Reserves:", bondingCurveAccount.realSolReserves?.toString());
        console.log();

        // Update config with bonding curve info
        console.log("💾 Updating devnet-config.json...");
        const fullConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        fullConfig.bondingCurveInitialized = true;
        fullConfig.bondingCurveStats = {
          virtualTokenReserves: bondingCurveAccount.virtualTokenReserves?.toString(),
          virtualSolReserves: bondingCurveAccount.virtualSolReserves?.toString(),
          realTokenReserves: bondingCurveAccount.realTokenReserves?.toString(),
          realSolReserves: bondingCurveAccount.realSolReserves?.toString(),
          complete: bondingCurveAccount.complete,
        };
        fs.writeFileSync(configPath, JSON.stringify(fullConfig, null, 2));
        console.log("✅ Configuration updated!");
        console.log();
      }

      console.log("================================");
      console.log("✨ BONDING CURVE READY");
      console.log("================================\n");
      console.log("🎯 Next Steps:");
      console.log("1. Verify on Explorer (link above)");
      console.log("2. Run: npm run devnet:find-bonding-curve");
      console.log("3. Run: npm run devnet:apply-config");
      console.log("4. Deploy your program: anchor deploy --provider.cluster devnet");
      console.log();

    } else {
      console.error("❌ Buy transaction failed");
      console.log("\n💡 Possible issues:");
      console.log("   - Insufficient balance");
      console.log("   - Network congestion");
      console.log("   - Slippage too low");
      console.log("\nTry again or adjust parameters");
      process.exit(1);
    }

  } catch (error: any) {
    console.error("\n❌ Error during buy:", error.message);

    if (error.message.includes("0xbbd")) {
      console.log("\n💡 This is the 'AccountNotEnoughKeys' error");
      console.log("   This might be a devnet-specific issue with PumpFun SDK");
      console.log("   The token is created but bonding curve might need manual initialization");
    }

    console.log("\n🔍 Debugging info:");
    console.log("   Error:", error);
    process.exit(1);
  }
}

// Execute
initializeBondingCurve()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  });
