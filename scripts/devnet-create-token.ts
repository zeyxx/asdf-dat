import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

/**
 * Script pour créer un token de test sur PumpFun devnet
 * Utilise les VRAIES adresses de programme (identiques sur devnet et mainnet)
 */

// ====================================
// ADRESSES PUMP (IDENTIQUES DEVNET/MAINNET)
// ====================================
const PUMP_ADDRESSES = {
  PUMP_PROGRAM: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
  PUMP_GLOBAL: new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"),
  PUMP_EVENT_AUTHORITY: new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"),
  PUMP_FEE_RECIPIENT: new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"),
  WSOL: new PublicKey("So11111111111111111111111111111111111111112"),
  SYSTEM_PROGRAM: SystemProgram.programId,
  TOKEN_PROGRAM: TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM: ASSOCIATED_TOKEN_PROGRAM_ID,
  RENT: anchor.web3.SYSVAR_RENT_PUBKEY,
};

interface TokenConfig {
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  initialBuyAmount?: number; // SOL amount for initial buy
}

interface CreatedTokenInfo {
  mint: string;
  creator: string;
  bondingCurve: string;
  associatedBondingCurve: string;
  timestamp: string;
  signature: string;
  config: TokenConfig;
}

/**
 * Crée un token sur PumpFun devnet
 */
async function createToken(config: TokenConfig): Promise<CreatedTokenInfo> {
  console.log("🚀 Creating Token on PumpFun Devnet\n");
  console.log("Configuration:");
  console.log("  Name:", config.name);
  console.log("  Symbol:", config.symbol);
  console.log("  URI:", config.uri);
  console.log("  Decimals:", config.decimals);
  console.log();

  // Setup provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet;

  console.log("Creator Wallet:", wallet.publicKey.toString());
  const balance = await provider.connection.getBalance(wallet.publicKey);
  console.log("Balance:", (balance / 1e9).toFixed(4), "SOL");

  if (balance < 0.5 * 1e9) {
    console.error("❌ Insufficient balance. Need at least 0.5 SOL");
    console.log("   Run: solana airdrop 2");
    throw new Error("Insufficient balance");
  }
  console.log();

  // Generate mint keypair
  const mintKeypair = Keypair.generate();
  console.log("📍 Generated Mint:", mintKeypair.publicKey.toString());

  // Derive bonding curve PDA
  const [bondingCurve, bondingCurveBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mintKeypair.publicKey.toBuffer()],
    PUMP_ADDRESSES.PUMP_PROGRAM
  );
  console.log("📍 Bonding Curve:", bondingCurve.toString());

  // Get associated bonding curve (token account)
  const associatedBondingCurve = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    bondingCurve,
    true
  );
  console.log("📍 Associated Bonding Curve:", associatedBondingCurve.toString());

  // Get metadata PDA
  const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );
  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintKeypair.publicKey.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  );
  console.log("📍 Metadata:", metadata.toString());
  console.log();

  // Build create instruction
  console.log("⏳ Building transaction...");

  // Instruction discriminator for "create" on PumpFun
  // This needs to match the actual PumpFun program instruction
  const createDiscriminator = Buffer.from([
    0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77, // "create" discriminator
  ]);

  // Encode token metadata
  const nameBuffer = Buffer.alloc(32);
  const symbolBuffer = Buffer.alloc(10);
  const uriBuffer = Buffer.alloc(200);

  Buffer.from(config.name).copy(nameBuffer);
  Buffer.from(config.symbol).copy(symbolBuffer);
  Buffer.from(config.uri).copy(uriBuffer);

  const instructionData = Buffer.concat([
    createDiscriminator,
    nameBuffer,
    symbolBuffer,
    uriBuffer,
  ]);

  const keys = [
    { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: PUMP_ADDRESSES.PUMP_GLOBAL, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: PUMP_ADDRESSES.SYSTEM_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: PUMP_ADDRESSES.TOKEN_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: PUMP_ADDRESSES.ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: PUMP_ADDRESSES.RENT, isSigner: false, isWritable: false },
    { pubkey: PUMP_ADDRESSES.PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const createIx = new anchor.web3.TransactionInstruction({
    keys,
    programId: PUMP_ADDRESSES.PUMP_PROGRAM,
    data: instructionData,
  });

  // Build and send transaction
  const tx = new Transaction().add(createIx);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;

  console.log("⏳ Sending transaction...");

  try {
    const signature = await provider.sendAndConfirm(tx, [mintKeypair], {
      skipPreflight: false,
      commitment: "confirmed",
    });

    console.log("✅ Token created successfully!\n");
    console.log("📝 Transaction Details:");
    console.log("  Signature:", signature);
    console.log("  Explorer:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    console.log();

    const tokenInfo: CreatedTokenInfo = {
      mint: mintKeypair.publicKey.toString(),
      creator: wallet.publicKey.toString(),
      bondingCurve: bondingCurve.toString(),
      associatedBondingCurve: associatedBondingCurve.toString(),
      timestamp: new Date().toISOString(),
      signature,
      config,
    };

    return tokenInfo;
  } catch (error) {
    console.error("❌ Transaction failed:", error);

    if (error && typeof error === 'object' && 'logs' in error) {
      console.log("\n📋 Program Logs:");
      (error.logs as string[]).forEach((log: string) => console.log("  ", log));
    }

    throw error;
  }
}

/**
 * Sauvegarde les informations du token créé
 */
function saveTokenInfo(tokenInfo: CreatedTokenInfo) {
  const outputPath = path.join(__dirname, "..", "devnet-token-info.json");

  console.log("💾 Saving token information...");
  console.log("  Path:", outputPath);

  fs.writeFileSync(outputPath, JSON.stringify(tokenInfo, null, 2));

  console.log("✅ Token information saved!");
  console.log();
}

/**
 * Génère le fichier de configuration devnet
 */
function generateDevnetConfig(tokenInfo: CreatedTokenInfo) {
  const configPath = path.join(__dirname, "..", "devnet-config.json");

  console.log("⚙️  Generating devnet configuration...");

  const config = {
    network: "devnet",
    timestamp: new Date().toISOString(),
    token: {
      mint: tokenInfo.mint,
      name: tokenInfo.config.name,
      symbol: tokenInfo.config.symbol,
      decimals: tokenInfo.config.decimals,
      creator: tokenInfo.creator,
    },
    pump: {
      bondingCurve: tokenInfo.bondingCurve,
      associatedBondingCurve: tokenInfo.associatedBondingCurve,
      pumpProgram: PUMP_ADDRESSES.PUMP_PROGRAM.toString(),
      pumpGlobal: PUMP_ADDRESSES.PUMP_GLOBAL.toString(),
    },
    programs: {
      wsol: PUMP_ADDRESSES.WSOL.toString(),
      tokenProgram: TOKEN_PROGRAM_ID.toString(),
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID.toString(),
    },
    transaction: {
      signature: tokenInfo.signature,
      explorer: `https://explorer.solana.com/tx/${tokenInfo.signature}?cluster=devnet`,
    },
    nextSteps: [
      "1. Wait a few seconds for the token to be indexed",
      "2. Make some initial trades on PumpFun to create the pool",
      "3. Note the pool address from the bonding curve",
      "4. Update lib.rs with the token mint and pool addresses",
      "5. Deploy and test the DAT protocol",
    ],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log("✅ Configuration saved to:", configPath);
  console.log();
}

/**
 * Main execution
 */
async function main() {
  const tokenConfig: TokenConfig = {
    name: "ASDF Test Token",
    symbol: "ASDFT",
    uri: "https://arweave.net/placeholder", // Replace with actual metadata URI
    decimals: 6,
  };

  console.log("================================");
  console.log("PUMPFUN TOKEN CREATOR - DEVNET");
  console.log("================================\n");

  try {
    // Create token
    const tokenInfo = await createToken(tokenConfig);

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
    console.log();

    console.log("📍 Bonding Curve:");
    console.log("  Address:", tokenInfo.bondingCurve);
    console.log("  Token Account:", tokenInfo.associatedBondingCurve);
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
    console.log("1. Wait for the token to be indexed (~30 seconds)");
    console.log();
    console.log("2. Make initial trades on PumpFun to create liquidity:");
    console.log("   https://pump.fun (switch to devnet)");
    console.log();
    console.log("3. The pool will be created automatically by PumpFun");
    console.log("   (bonding curve address: " + tokenInfo.bondingCurve + ")");
    console.log();
    console.log("4. Update lib.rs with your token mint:");
    console.log("   pub const ASDF_MINT: Pubkey = solana_program::pubkey!(\"" + tokenInfo.mint + "\");");
    console.log();
    console.log("5. Update lib.rs with bonding curve (acts as pool):");
    console.log("   pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!(\"" + tokenInfo.bondingCurve + "\");");
    console.log();
    console.log("6. Build and deploy:");
    console.log("   anchor build");
    console.log("   anchor deploy --provider.cluster devnet");
    console.log();
    console.log("7. Initialize the protocol:");
    console.log("   ts-node scripts/devnet-init.ts");
    console.log();

    console.log("💡 Tip: Keep devnet-token-info.json for reference!");
    console.log();

  } catch (error) {
    console.error("\n❌ Failed to create token:", error instanceof Error ? error.message : String(error));
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
