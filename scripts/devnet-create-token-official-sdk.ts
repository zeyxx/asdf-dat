import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { PumpSdk, getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import * as fs from "fs";
import * as path from "path";
import BN from "bn.js";

/**
 * Create token using OFFICIAL @pump-fun/pump-sdk
 * This SDK is designed to work with devnet
 */

interface TokenMetadata {
  name: string;
  symbol: string;
  description: string;
  uri?: string; // IPFS metadata URI
}

async function createTokenWithOfficialSDK(
  metadata: TokenMetadata,
  buyAmountSol: number = 0.01
) {
  console.log("================================");
  console.log("PUMP SDK - OFFICIAL TOKEN CREATOR");
  console.log("================================\n");

  console.log("ℹ️  Using OFFICIAL @pump-fun/pump-sdk");
  console.log("   This is the official Pump program SDK");
  console.log("   Explicitly supports devnet");
  console.log();

  // 1. Setup connection
  const network = process.env.SOLANA_NETWORK || "devnet";
  const rpcUrl = network === "mainnet"
    ? process.env.RPC_URL || "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";

  console.log("🌐 Network:", network);
  console.log("🔗 RPC:", rpcUrl);
  console.log();

  const connection = new Connection(rpcUrl, "confirmed");
  const sdk = new PumpSdk(connection);

  // 2. Load wallet
  const walletPath = path.join(__dirname, "..", "devnet-wallet.json");
  if (!fs.existsSync(walletPath)) {
    console.error("❌ Wallet not found:", walletPath);
    process.exit(1);
  }

  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  console.log("👛 Creator Wallet:", walletKeypair.publicKey.toString());

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("💰 Balance:", (balance / 1e9).toFixed(4), "SOL");

  if (balance < 0.02 * 1e9) {
    console.error("\n❌ Insufficient balance! Need at least 0.02 SOL");
    process.exit(1);
  }
  console.log();

  // 3. Generate mint keypair
  const mintKeypair = Keypair.generate();
  console.log("📍 Generated Mint:", mintKeypair.publicKey.toString());
  console.log();

  // 4. Prepare metadata URI (simplified for devnet)
  const metadataUri = metadata.uri || JSON.stringify({
    name: metadata.name,
    symbol: metadata.symbol,
    description: metadata.description,
  });

  console.log("📝 Token Metadata:");
  console.log("   Name:", metadata.name);
  console.log("   Symbol:", metadata.symbol);
  console.log("   Description:", metadata.description);
  console.log();

  try {
    // 5. Fetch global state
    console.log("⏳ Fetching global state...");
    const global = await sdk.fetchGlobal();
    console.log("✅ Global state fetched");
    console.log("   Fee Recipient:", global.feeRecipient.toString());
    console.log();

    // 6. Prepare buy amount
    const solAmount = new BN(buyAmountSol * 1e9);
    const tokenAmount = getBuyTokenAmountFromSolAmount(global, null, solAmount);

    console.log("💳 Buy Parameters:");
    console.log("   SOL Amount:", buyAmountSol, "SOL");
    console.log("   Token Amount:", tokenAmount.toString());
    console.log();

    // 7. Create instructions
    console.log("⏳ Creating transaction instructions...");
    const instructions = await sdk.createAndBuyInstructions({
      global,
      mint: mintKeypair.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadataUri,
      creator: walletKeypair.publicKey,
      user: walletKeypair.publicKey,
      solAmount,
      amount: tokenAmount,
    });

    console.log("✅ Instructions created:", instructions.length, "instructions");
    console.log();

    // 8. Create and send transaction
    console.log("⏳ Building transaction...");
    const transaction = new Transaction();

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = walletKeypair.publicKey;

    // Add all instructions
    instructions.forEach(ix => transaction.add(ix));

    console.log("✅ Transaction built");
    console.log();

    // 9. Sign with both keypairs (wallet and mint)
    console.log("⏳ Signing transaction...");
    transaction.sign(walletKeypair, mintKeypair);
    console.log("✅ Transaction signed");
    console.log();

    // 10. Send transaction
    console.log("⏳ Sending transaction to", network, "...");
    console.log("   This may take a moment...");
    console.log();

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [walletKeypair, mintKeypair],
      {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
      }
    );

    console.log("✅ Transaction confirmed!");
    console.log("   Signature:", signature);
    console.log("   Explorer:", `https://explorer.solana.com/tx/${signature}?cluster=${network}`);
    console.log();

    // 11. Verify bonding curve was created
    console.log("🔍 Verifying bonding curve...");
    try {
      const { bondingCurve, bondingCurveAccountInfo } = await sdk.fetchBuyState(
        mintKeypair.publicKey,
        walletKeypair.publicKey
      );

      if (bondingCurveAccountInfo) {
        console.log("✅ Bonding curve successfully created!");
        console.log("   Address:", bondingCurve.toString());
        console.log();
        console.log("📊 Bonding Curve State:");
        console.log("   Virtual Token Reserves:", bondingCurveAccountInfo.virtualTokenReserves?.toString());
        console.log("   Virtual SOL Reserves:", bondingCurveAccountInfo.virtualSolReserves?.toString());
        console.log("   Real Token Reserves:", bondingCurveAccountInfo.realTokenReserves?.toString());
        console.log("   Real SOL Reserves:", bondingCurveAccountInfo.realSolReserves?.toString());
        console.log();

        // Save full config
        const config = {
          network,
          timestamp: new Date().toISOString(),
          token: {
            mint: mintKeypair.publicKey.toString(),
            name: metadata.name,
            symbol: metadata.symbol,
            description: metadata.description,
            creator: walletKeypair.publicKey.toString(),
          },
          bondingCurve: bondingCurve.toString(),
          bondingCurveStats: {
            virtualTokenReserves: bondingCurveAccountInfo.virtualTokenReserves?.toString(),
            virtualSolReserves: bondingCurveAccountInfo.virtualSolReserves?.toString(),
            realTokenReserves: bondingCurveAccountInfo.realTokenReserves?.toString(),
            realSolReserves: bondingCurveAccountInfo.realSolReserves?.toString(),
            complete: bondingCurveAccountInfo.complete,
          },
          programs: {
            pumpProgram: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
          },
          transaction: {
            signature,
            explorer: `https://explorer.solana.com/tx/${signature}?cluster=${network}`,
          },
        };

        const configPath = path.join(__dirname, "..", "devnet-config.json");
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log("💾 Configuration saved to:", configPath);
        console.log();

        console.log("================================");
        console.log("✨ TOKEN CREATED SUCCESSFULLY");
        console.log("================================\n");

        console.log("📍 Addresses:");
        console.log("   Mint:", mintKeypair.publicKey.toString());
        console.log("   Bonding Curve:", bondingCurve.toString());
        console.log();

        console.log("🔗 Links:");
        console.log("   Token:", `https://explorer.solana.com/address/${mintKeypair.publicKey.toString()}?cluster=${network}`);
        console.log("   Transaction:", `https://explorer.solana.com/tx/${signature}?cluster=${network}`);
        console.log();

        console.log("🎯 Next Steps:");
        console.log("1. Verify transaction on Explorer (link above)");
        console.log("2. Run: npm run devnet:apply-config");
        console.log("3. Deploy: anchor build && anchor deploy --provider.cluster devnet");
        console.log();

        return config;
      }
    } catch (error: any) {
      console.log("⚠️  Could not fetch bonding curve state:", error.message);
      console.log("   But the transaction succeeded, so it should exist");
    }

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    if (error.logs) {
      console.log("\n📋 Transaction Logs:");
      error.logs.forEach((log: string) => console.log("   ", log));
    }
    process.exit(1);
  }
}

// Main execution
async function main() {
  const metadata: TokenMetadata = {
    name: "ASDF Test Token",
    symbol: "ASDFT",
    description: "Test token for ASDF DAT protocol on devnet using official Pump SDK",
  };

  await createTokenWithOfficialSDK(metadata, 0.01);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
