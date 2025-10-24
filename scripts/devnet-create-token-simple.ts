import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

/**
 * Script simplifié pour créer un token SPL standard sur devnet
 * (PumpFun n'a pas de version devnet publique)
 *
 * Ce script crée :
 * - Un token SPL standard
 * - Le mint initial à un compte
 * - Sauvegarde toutes les infos pour la configuration
 */

interface TokenConfig {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: number;
}

interface CreatedTokenInfo {
  mint: string;
  creator: string;
  creatorTokenAccount: string;
  timestamp: string;
  signature: string;
  config: TokenConfig;
  network: string;
}

async function createSimpleToken(config: TokenConfig): Promise<CreatedTokenInfo> {
  console.log("🚀 Creating Simple SPL Token on Devnet\n");
  console.log("Configuration:");
  console.log("  Name:", config.name);
  console.log("  Symbol:", config.symbol);
  console.log("  Decimals:", config.decimals);
  console.log("  Initial Supply:", config.initialSupply.toLocaleString());
  console.log();

  // Setup provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet;

  console.log("Creator Wallet:", wallet.publicKey.toString());
  const balance = await provider.connection.getBalance(wallet.publicKey);
  console.log("Balance:", (balance / 1e9).toFixed(4), "SOL");

  if (balance < 0.1 * 1e9) {
    console.error("❌ Insufficient balance. Need at least 0.1 SOL");
    console.log("   Run: solana airdrop 2");
    throw new Error("Insufficient balance");
  }
  console.log();

  // Generate mint keypair
  const mintKeypair = Keypair.generate();
  console.log("📍 Generated Mint:", mintKeypair.publicKey.toString());

  // Get creator's token account
  const creatorTokenAccount = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    wallet.publicKey
  );
  console.log("📍 Creator Token Account:", creatorTokenAccount.toString());
  console.log();

  // Calculate rent
  const lamports = await getMinimumBalanceForRentExemptMint(provider.connection);

  console.log("⏳ Creating token mint...");

  try {
    // Build transaction
    const tx = new anchor.web3.Transaction();

    // 1. Create mint account
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      })
    );

    // 2. Initialize mint
    tx.add(
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        config.decimals,
        wallet.publicKey, // mint authority
        wallet.publicKey, // freeze authority
        TOKEN_PROGRAM_ID
      )
    );

    // 3. Create associated token account for creator
    tx.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        creatorTokenAccount,
        wallet.publicKey,
        mintKeypair.publicKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    // 4. Mint initial supply
    const initialSupplyAmount = BigInt(config.initialSupply) * BigInt(10 ** config.decimals);
    tx.add(
      createMintToInstruction(
        mintKeypair.publicKey,
        creatorTokenAccount,
        wallet.publicKey,
        initialSupplyAmount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // Send transaction
    const signature = await provider.sendAndConfirm(tx, [mintKeypair]);

    console.log("✅ Token created successfully!\n");
    console.log("📝 Transaction Details:");
    console.log("  Signature:", signature);
    console.log("  Explorer:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    console.log();

    const tokenInfo: CreatedTokenInfo = {
      mint: mintKeypair.publicKey.toString(),
      creator: wallet.publicKey.toString(),
      creatorTokenAccount: creatorTokenAccount.toString(),
      timestamp: new Date().toISOString(),
      signature,
      config,
      network: "devnet",
    };

    return tokenInfo;
  } catch (error: any) {
    console.error("❌ Transaction failed:", error);
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

  console.log("⚙️  Generating devnet configuration...");

  const config = {
    network: "devnet",
    timestamp: new Date().toISOString(),
    note: "Simple SPL token for devnet testing (PumpFun is mainnet-only)",
    token: {
      mint: tokenInfo.mint,
      name: tokenInfo.config.name,
      symbol: tokenInfo.config.symbol,
      decimals: tokenInfo.config.decimals,
      creator: tokenInfo.creator,
      creatorTokenAccount: tokenInfo.creatorTokenAccount,
      initialSupply: tokenInfo.config.initialSupply,
    },
    programs: {
      wsol: "So11111111111111111111111111111111111111112",
      tokenProgram: TOKEN_PROGRAM_ID.toString(),
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID.toString(),
    },
    transaction: {
      signature: tokenInfo.signature,
      explorer: `https://explorer.solana.com/tx/${tokenInfo.signature}?cluster=devnet`,
    },
    important_notes: [
      "This is a simple SPL token for devnet testing",
      "PumpFun does not have a public devnet deployment",
      "For mainnet, you'll use the real PumpFun token and pool addresses",
      "This devnet setup tests the core protocol logic without PumpFun integration",
    ],
    nextSteps: [
      "1. The token mint address will be used as ASDF_MINT in lib.rs",
      "2. For devnet testing, you can use the creator token account as a mock pool",
      "3. Update lib.rs with the token mint address",
      "4. Set POOL_PUMPSWAP to the mint address (mock pool for devnet)",
      "5. Deploy and test the core buyback/burn logic",
      "6. For mainnet, replace with real PumpFun addresses",
    ],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log("✅ Configuration saved to:", configPath);
  console.log();
}

async function main() {
  const tokenConfig: TokenConfig = {
    name: "ASDF Test Token",
    symbol: "ASDFT",
    decimals: 6,
    initialSupply: 1_000_000_000, // 1 billion tokens
  };

  console.log("================================");
  console.log("SIMPLE TOKEN CREATOR - DEVNET");
  console.log("================================\n");

  console.log("⚠️  IMPORTANT NOTE:");
  console.log("PumpFun does not have a public devnet deployment.");
  console.log("This script creates a simple SPL token for testing the core protocol logic.");
  console.log("For mainnet, you'll use the real PumpFun token and addresses.");
  console.log();

  try {
    // Create token
    const tokenInfo = await createSimpleToken(tokenConfig);

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
    console.log("  Symbol:", tokenInfo.config.symbol);
    console.log("  Name:", tokenInfo.config.name);
    console.log("  Creator:", tokenInfo.creator);
    console.log("  Creator Token Account:", tokenInfo.creatorTokenAccount);
    console.log("  Initial Supply:", tokenInfo.config.initialSupply.toLocaleString());
    console.log();

    console.log("🔗 Links:");
    console.log("  Token:", `https://explorer.solana.com/address/${tokenInfo.mint}?cluster=devnet`);
    console.log("  Transaction:", `https://explorer.solana.com/tx/${tokenInfo.signature}?cluster=devnet`);
    console.log();

    console.log("📋 Files Created:");
    console.log("  ✅ devnet-token-info.json - Full token information");
    console.log("  ✅ devnet-config.json - Configuration for deployment");
    console.log();

    console.log("🎯 Next Steps:");
    console.log("================================");
    console.log("1. Update lib.rs with your token mint:");
    console.log("   pub const ASDF_MINT: Pubkey = solana_program::pubkey!(\"" + tokenInfo.mint + "\");");
    console.log();
    console.log("2. For devnet testing, use the mint as a mock pool:");
    console.log("   pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!(\"" + tokenInfo.mint + "\");");
    console.log();
    console.log("3. Or run the auto-config script:");
    console.log("   npm run devnet:apply-config");
    console.log();
    console.log("4. Build and deploy:");
    console.log("   anchor build");
    console.log("   anchor deploy --provider.cluster devnet");
    console.log();
    console.log("5. Initialize the protocol:");
    console.log("   npm run devnet:init");
    console.log();

    console.log("⚠️  IMPORTANT FOR MAINNET:");
    console.log("================================");
    console.log("When deploying to mainnet, you'll use:");
    console.log("  - Real PumpFun token mint");
    console.log("  - Real PumpFun pool/bonding curve address");
    console.log("  - Proper PumpSwap program integration");
    console.log();
    console.log("This devnet setup is for testing the core protocol logic only.");
    console.log();

  } catch (error: any) {
    console.error("\n❌ Failed to create token:", error.message);
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
