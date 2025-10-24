import {
  Connection,
  Keypair,
  PublicKey
} from "@solana/web3.js";
import { PumpFunSDK } from "pumpdotfun-sdk";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import * as fs from "fs";
import * as path from "path";

/**
 * Script pour créer un token sur PumpFun en utilisant le SDK officiel
 * Fonctionne sur devnet ET mainnet
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
  metadataUri: string;
  creator: string;
  bondingCurve?: string;
  associatedBondingCurve?: string;
  timestamp: string;
  signature?: string;
  metadata: TokenMetadata;
  network: string;
}

async function createTokenWithSDK(
  metadata: TokenMetadata,
  buyAmount?: number
): Promise<CreatedTokenInfo> {
  console.log("🚀 Creating Token on PumpFun using Official SDK\n");
  console.log("Configuration:");
  console.log("  Name:", metadata.name);
  console.log("  Symbol:", metadata.symbol);
  console.log("  Description:", metadata.description);
  if (buyAmount) {
    console.log("  Initial Buy:", buyAmount, "SOL");
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

  const minimumRequired = buyAmount ? buyAmount + 0.01 : 0.01;
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

    // Prepare metadata
    console.log("⏳ Uploading metadata to IPFS...");

    let imageBuffer: Buffer | undefined;
    if (metadata.file && fs.existsSync(metadata.file)) {
      imageBuffer = fs.readFileSync(metadata.file);
      console.log("  Image loaded:", metadata.file);
    }

    // Create token metadata URI
    const metadataResponse = await sdk.createTokenMetadata({
      name: metadata.name,
      symbol: metadata.symbol,
      description: metadata.description,
      file: imageBuffer,
      twitter: metadata.twitter,
      telegram: metadata.telegram,
      website: metadata.website,
    });

    const metadataUri = metadataResponse.metadataUri;
    console.log("✅ Metadata URI:", metadataUri);
    console.log();

    // Create token (and optionally buy)
    if (buyAmount && buyAmount > 0) {
      console.log(`⏳ Creating token and buying ${buyAmount} SOL worth...`);

      const createAndBuyResult = await sdk.createAndBuy(
        walletKeypair.publicKey,
        mintKeypair,
        {
          name: metadata.name,
          symbol: metadata.symbol,
          uri: metadataUri,
        },
        BigInt(Math.floor(buyAmount * 1e9)), // SOL amount in lamports
        {
          unitLimit: 250_000,
          unitPrice: 250_000,
        }
      );

      console.log("✅ Token created and initial buy completed!");
      console.log();
      console.log("📝 Transaction Details:");
      console.log("  Signature:", createAndBuyResult.signature);
      console.log("  Explorer:", `https://explorer.solana.com/tx/${createAndBuyResult.signature}?cluster=${network}`);
      console.log();

      const tokenInfo: CreatedTokenInfo = {
        mint: mintKeypair.publicKey.toString(),
        metadataUri,
        creator: walletKeypair.publicKey.toString(),
        timestamp: new Date().toISOString(),
        signature: createAndBuyResult.signature,
        metadata,
        network,
      };

      return tokenInfo;
    } else {
      console.log("⏳ Creating token (no initial buy)...");

      const createResult = await sdk.create(
        walletKeypair.publicKey,
        mintKeypair,
        {
          name: metadata.name,
          symbol: metadata.symbol,
          uri: metadataUri,
        },
        {
          unitLimit: 250_000,
          unitPrice: 250_000,
        }
      );

      console.log("✅ Token created!");
      console.log();
      console.log("📝 Transaction Details:");
      console.log("  Signature:", createResult.signature);
      console.log("  Explorer:", `https://explorer.solana.com/tx/${createResult.signature}?cluster=${network}`);
      console.log();

      const tokenInfo: CreatedTokenInfo = {
        mint: mintKeypair.publicKey.toString(),
        metadataUri,
        creator: walletKeypair.publicKey.toString(),
        timestamp: new Date().toISOString(),
        signature: createResult.signature,
        metadata,
        network,
      };

      return tokenInfo;
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

  const config = {
    network: tokenInfo.network,
    timestamp: new Date().toISOString(),
    token: {
      mint: tokenInfo.mint,
      name: tokenInfo.metadata.name,
      symbol: tokenInfo.metadata.symbol,
      description: tokenInfo.metadata.description,
      metadataUri: tokenInfo.metadataUri,
      creator: tokenInfo.creator,
    },
    pumpfun: {
      bondingCurve: tokenInfo.bondingCurve || "Will be derived from mint",
      metadataUri: tokenInfo.metadataUri,
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
      "1. Update lib.rs with the token mint address",
      "2. Find the bonding curve address from the transaction",
      "3. Update POOL_PUMPSWAP with the bonding curve address",
      "4. Deploy the DAT protocol",
      "5. Initialize and test",
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
    description: "Test token for ASDF DAT protocol on devnet",
    // file: "./assets/token-image.png",  // Optional: path to image
    twitter: "https://twitter.com/asdf",
    telegram: "https://t.me/asdf",
    website: "https://asdf.com",
  };

  // Optional: initial buy amount in SOL
  const initialBuyAmount = 0.1; // 0.1 SOL

  console.log("================================");
  console.log("PUMPFUN TOKEN CREATOR");
  console.log("================================\n");

  console.log("ℹ️  Using Official PumpFun SDK");
  console.log("   Package: pumpdotfun-sdk");
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
    console.log("  Metadata URI:", tokenInfo.metadataUri);
    console.log();

    console.log("🔗 Links:");
    console.log("  Token:", `https://explorer.solana.com/address/${tokenInfo.mint}?cluster=${tokenInfo.network}`);
    if (tokenInfo.signature) {
      console.log("  Transaction:", `https://explorer.solana.com/tx/${tokenInfo.signature}?cluster=${tokenInfo.network}`);
    }
    console.log();

    console.log("📋 Files Created:");
    console.log("  ✅ devnet-token-info.json - Full token information");
    console.log("  ✅ devnet-config.json - Configuration for deployment");
    console.log();

    console.log("🎯 Next Steps:");
    console.log("================================");
    console.log("1. Find the bonding curve address from the transaction");
    console.log();
    console.log("2. Update lib.rs:");
    console.log(`   pub const ASDF_MINT: Pubkey = solana_program::pubkey!("${tokenInfo.mint}");`);
    console.log("   pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!(\"[BONDING_CURVE]\");");
    console.log();
    console.log("3. Or run auto-config:");
    console.log("   npm run devnet:apply-config");
    console.log();
    console.log("4. Deploy the protocol:");
    console.log("   anchor build && anchor deploy --provider.cluster", tokenInfo.network);
    console.log();

  } catch (error: any) {
    console.error("\n❌ Failed to create token:", error.message);

    if (error.message?.includes("pumpdotfun-sdk")) {
      console.log("\n💡 Install the SDK:");
      console.log("   npm install pumpdotfun-sdk");
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
