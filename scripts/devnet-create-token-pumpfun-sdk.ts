import {
  Connection,
  Keypair,
  PublicKey
} from "@solana/web3.js";
import { PumpFunSDK } from "pumpdotfun-sdk";
import { AnchorProvider } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import * as fs from "fs";
import * as path from "path";

/**
 * Script pour créer un token sur PumpFun en utilisant le SDK officiel
 * Utilise la vraie API du SDK pumpdotfun-sdk
 */

interface TokenMetadata {
  name: string;
  symbol: string;
  description: string;
  file?: string;  // Path to image file
  twitter?: string;
  telegram?: string;
  website?: string;
}

interface CreatedTokenInfo {
  mint: string;
  creator: string;
  timestamp: string;
  signature: string;
  metadata: TokenMetadata;
  network: string;
}

async function createTokenWithSDK(
  metadata: TokenMetadata,
  buyAmountSol?: number
): Promise<CreatedTokenInfo> {
  console.log("🚀 Creating Token on PumpFun using Official SDK\n");
  console.log("Configuration:");
  console.log("  Name:", metadata.name);
  console.log("  Symbol:", metadata.symbol);
  console.log("  Description:", metadata.description);
  if (buyAmountSol) {
    console.log("  Initial Buy:", buyAmountSol, "SOL");
  }
  console.log();

  // Get network from environment or default to devnet
  const network = process.env.SOLANA_NETWORK || "devnet";
  const rpcUrl = network === "mainnet"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";

  console.log("Network:", network);
  console.log("RPC URL:", rpcUrl);
  console.log();

  // Setup connection
  const connection = new Connection(rpcUrl, "confirmed");

  // Load wallet
  const walletPath = process.env.WALLET_PATH || "./devnet-wallet.json";
  let walletKeypair: Keypair;

  try {
    const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
    walletKeypair = Keypair.fromSecretKey(new Uint8Array(walletData));
  } catch (error: any) {
    console.error("❌ Failed to load wallet from:", walletPath);
    console.log("\nCreate a wallet first:");
    console.log("  solana-keygen new --outfile", walletPath);
    throw error;
  }

  console.log("Creator Wallet:", walletKeypair.publicKey.toString());

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("Balance:", (balance / 1e9).toFixed(4), "SOL");

  const minimumRequired = buyAmountSol ? buyAmountSol + 0.02 : 0.02;
  if (balance < minimumRequired * 1e9) {
    console.error(`❌ Insufficient balance. Need at least ${minimumRequired} SOL`);
    if (network === "devnet") {
      console.log("   Run: solana airdrop 2");
    }
    throw new Error("Insufficient balance");
  }
  console.log();

  // Initialize SDK
  const wallet = new NodeWallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const sdk = new PumpFunSDK(provider);

  console.log("⏳ Initializing PumpFun SDK...");

  try {
    // Generate new mint keypair
    const mintKeypair = Keypair.generate();
    console.log("📍 Generated Mint:", mintKeypair.publicKey.toString());
    console.log();

    // Prepare metadata with file as Blob if provided
    let fileBlob: Blob | undefined;
    if (metadata.file && fs.existsSync(metadata.file)) {
      const fileBuffer = fs.readFileSync(metadata.file);
      fileBlob = new Blob([fileBuffer]);
      console.log("  Image loaded:", metadata.file);
    }

    const tokenMetadata = {
      name: metadata.name,
      symbol: metadata.symbol,
      description: metadata.description,
      file: fileBlob!,
      showName: true,
      ...(metadata.twitter && { twitter: metadata.twitter }),
      ...(metadata.telegram && { telegram: metadata.telegram }),
      ...(metadata.website && { website: metadata.website }),
    };

    // Create token (and optionally buy)
    if (buyAmountSol && buyAmountSol > 0) {
      console.log(`⏳ Creating token and buying ${buyAmountSol} SOL worth...`);

      const buyAmountLamports = BigInt(Math.floor(buyAmountSol * 1e9));
      const slippageBasisPoints = 500n; // 5% slippage

      const priorityFees = {
        unitLimit: 250_000,
        unitPrice: 250_000,
      };

      const result = await sdk.createAndBuy(
        walletKeypair,
        mintKeypair,
        tokenMetadata,
        buyAmountLamports,
        slippageBasisPoints,
        priorityFees
      );

      console.log("✅ Token created and initial buy completed!");
      console.log();
      console.log("📝 Transaction Details:");
      console.log("  Signature:", result.signature);
      console.log("  Success:", result.success);
      console.log("  Explorer:", `https://explorer.solana.com/tx/${result.signature}?cluster=${network}`);
      console.log();

      if (result.results) {
        console.log("📊 Results:");
        console.log(JSON.stringify(result.results, null, 2));
      }

      const tokenInfo: CreatedTokenInfo = {
        mint: mintKeypair.publicKey.toString(),
        creator: walletKeypair.publicKey.toString(),
        timestamp: new Date().toISOString(),
        signature: result.signature,
        metadata,
        network,
      };

      return tokenInfo;
    } else {
      throw new Error("SDK requires initial buy. Set buyAmountSol > 0");
    }
  } catch (error: any) {
    console.error("❌ Failed to create token:", error);

    if (error.logs) {
      console.log("\n📋 Transaction Logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }

    throw error;
  }
}

function saveTokenInfo(tokenInfo: CreatedTokenInfo) {
  const outputPath = path.join(__dirname, "..", "devnet-token-info.json");

  console.log("💾 Saving token information...");
  console.log("  Path:", outputPath);

  fs.writeFileSync(outputPath, JSON.stringify(tokenInfo, null, 2));

  console.log("✅ Token information saved!");
  console.log();
}

function generateDevnetConfig(tokenInfo: CreatedTokenInfo) {
  const configPath = path.join(__dirname, "..", "devnet-config.json");

  console.log("⚙️  Generating configuration...");

  // Derive bonding curve from mint
  // Note: The actual bonding curve address should be derived from the transaction
  const config = {
    network: tokenInfo.network,
    timestamp: new Date().toISOString(),
    token: {
      mint: tokenInfo.mint,
      name: tokenInfo.metadata.name,
      symbol: tokenInfo.metadata.symbol,
      description: tokenInfo.metadata.description,
      creator: tokenInfo.creator,
    },
    pumpfun: {
      bondingCurve: "Check transaction for bonding curve address",
      note: "Look at the transaction on Explorer to find the bonding curve PDA",
    },
    programs: {
      pumpProgram: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      wsol: "So11111111111111111111111111111111111111112",
    },
    transaction: {
      signature: tokenInfo.signature,
      explorer: `https://explorer.solana.com/tx/${tokenInfo.signature}?cluster=${tokenInfo.network}`,
    },
    nextSteps: [
      "1. Check the transaction on Explorer to find bonding curve address",
      "2. Update lib.rs with:",
      `   ASDF_MINT = "${tokenInfo.mint}"`,
      "   POOL_PUMPSWAP = \"[BONDING_CURVE_FROM_TX]\"",
      "3. Run: npm run devnet:apply-config",
      "4. Build and deploy: anchor build && anchor deploy",
      "5. Initialize: npm run devnet:init",
    ],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log("✅ Configuration saved to:", configPath);
  console.log();
}

async function main() {
  const metadata: TokenMetadata = {
    name: "ASDF Test Token",
    symbol: "ASDFT",
    description: "Test token for ASDF DAT protocol created via PumpFun SDK",
    // file: "./assets/token-image.png",  // Optional: path to image
    twitter: "https://twitter.com/asdf",
    telegram: "https://t.me/asdf",
    website: "https://asdf.com",
  };

  // Initial buy amount in SOL (REQUIRED by SDK)
  const initialBuyAmount = 0.01; // Minimum buy amount

  console.log("================================");
  console.log("PUMPFUN TOKEN CREATOR (SDK)");
  console.log("================================\n");

  console.log("ℹ️  Using Official PumpFun SDK");
  console.log("   Package: pumpdotfun-sdk v1.4.2");
  console.log("   Note: SDK requires an initial buy amount");
  console.log();

  try {
    // Create token
    const tokenInfo = await createTokenWithSDK(metadata, initialBuyAmount);

    // Save token info
    saveTokenInfo(tokenInfo);

    // Generate config
    generateDevnetConfig(tokenInfo);

    // Display summary
    console.log("================================");
    console.log("TOKEN CREATED SUCCESSFULLY");
    console.log("================================\n");

    console.log("📍 Token Information:");
    console.log("  Mint:", tokenInfo.mint);
    console.log("  Symbol:", tokenInfo.metadata.symbol);
    console.log("  Name:", tokenInfo.metadata.name);
    console.log("  Creator:", tokenInfo.creator);
    console.log();

    console.log("🔗 Links:");
    console.log("  Token:", `https://explorer.solana.com/address/${tokenInfo.mint}?cluster=${tokenInfo.network}`);
    console.log("  Transaction:", `https://explorer.solana.com/tx/${tokenInfo.signature}?cluster=${tokenInfo.network}`);
    if (tokenInfo.network === "mainnet") {
      console.log("  PumpFun:", `https://pump.fun/${tokenInfo.mint}`);
    }
    console.log();

    console.log("📋 Files Created:");
    console.log("  ✅ devnet-token-info.json - Full token information");
    console.log("  ✅ devnet-config.json - Configuration for deployment");
    console.log();

    console.log("🎯 Next Steps:");
    console.log("================================");
    console.log("1. Open the transaction in Explorer (link above)");
    console.log("2. Find the 'bonding curve' account in the transaction");
    console.log("3. Update the bonding curve address in devnet-config.json");
    console.log("4. Run: npm run devnet:apply-config");
    console.log("5. Build and deploy: anchor build && anchor deploy --provider.cluster", tokenInfo.network);
    console.log();

    console.log("💡 Tip: The bonding curve is a PDA derived from the mint");
    console.log();

  } catch (error: any) {
    console.error("\n❌ Failed to create token:", error.message);

    if (error.message?.includes("pumpdotfun-sdk")) {
      console.log("\n💡 Make sure the SDK is installed:");
      console.log("   npm install pumpdotfun-sdk");
    }

    if (error.message?.includes("wallet")) {
      console.log("\n💡 Create a wallet first:");
      console.log("   solana-keygen new --outfile devnet-wallet.json");
      console.log("   solana config set --keypair devnet-wallet.json");
      console.log("   solana airdrop 2");
    }

    process.exit(1);
  }
}

// Execute
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
