/**
 * Generate volume on a token by making multiple small purchases
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

async function main() {
  const tokenFile = process.argv[2];
  const numBuys = parseInt(process.argv[3] || "5");
  const buyAmount = parseFloat(process.argv[4] || "0.001"); // SOL per buy

  if (!tokenFile) {
    console.log("Usage: npx ts-node scripts/generate-volume.ts <token-file> [num-buys] [buy-amount-sol]");
    process.exit(1);
  }

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  console.log(`\n🔥 Generating Volume\n`);
  console.log(`👤 Buyer: ${buyer.publicKey.toString()}`);
  console.log(`🔢 Number of buys: ${numBuys}`);
  console.log(`💰 Amount per buy: ${buyAmount} SOL\n`);

  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const isMayhem = tokenInfo.tokenProgram === "Token2022";
  const TOKEN_PROGRAM = isMayhem ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  console.log(`🪙 Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
  console.log(`🔗 Mint: ${tokenMint.toString()}`);
  console.log(`📈 Bonding Curve: ${bondingCurve.toString()}`);
  console.log(`🔧 Token Program: ${isMayhem ? "Token2022" : "SPL"}\n`);

  // Get buyer ATA
  const buyerAta = await getAssociatedTokenAddress(
    tokenMint,
    buyer.publicKey,
    false,
    TOKEN_PROGRAM
  );

  // Check if ATA exists, create if not
  let needsAtaCreation = false;
  try {
    await getAccount(connection, buyerAta, "confirmed", TOKEN_PROGRAM);
    console.log("✅ Buyer ATA exists");
  } catch {
    console.log("⚠️  Buyer ATA doesn't exist, will create it");
    needsAtaCreation = true;
  }

  // Get pool ATAs
  const poolAta = await getAssociatedTokenAddress(tokenMint, bondingCurve, true, TOKEN_PROGRAM);
  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  const poolWsolAta = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true, TOKEN_PROGRAM_ID);

  // Protocol fee recipient - different for SPL vs Token2022 (Mayhem Mode)
  const SPL_FEE_RECIPIENT = "6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs";
  const MAYHEM_FEE_RECIPIENT = "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS";
  const protocolFeeRecipient = new PublicKey(isMayhem ? MAYHEM_FEE_RECIPIENT : SPL_FEE_RECIPIENT);
  const protocolAta = await getAssociatedTokenAddress(tokenMint, protocolFeeRecipient, true, TOKEN_PROGRAM);

  // Creator vault
  const tokenCreator = new PublicKey(tokenInfo.creator);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_PROGRAM
  );

  // PumpFun PDAs
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM);
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_PROGRAM);
  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], PUMP_PROGRAM);
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), buyer.publicKey.toBuffer()], PUMP_PROGRAM);
  const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()], FEE_PROGRAM);

  let successfulBuys = 0;
  let totalTokensBought = 0;

  for (let i = 1; i <= numBuys; i++) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`BUY ${i}/${numBuys}`);
    console.log("=".repeat(50));

    try {
      const buyAmountLamports = Math.floor(buyAmount * 1e9);

      // Fetch current bonding curve state to calculate expected tokens
      const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
      if (!bondingCurveInfo) throw new Error("Bonding curve not found");

      // Parse bonding curve data (skip 8-byte discriminator)
      const bcData = bondingCurveInfo.data;
      const virtualTokenReserves = bcData.readBigUInt64LE(8);
      const virtualSolReserves = bcData.readBigUInt64LE(16);

      // Calculate tokens out using PumpFun formula: tokens = (sol * tokenReserves) / (solReserves + sol)
      const solIn = BigInt(buyAmountLamports);
      const tokensOut = (solIn * virtualTokenReserves) / (virtualSolReserves + solIn);

      // Apply 30% slippage tolerance (accept 70% of expected)
      const minTokens = (tokensOut * BigInt(70)) / BigInt(100);

      console.log(`📊 Bonding Curve: ${Number(virtualTokenReserves)/1e6}M tokens, ${Number(virtualSolReserves)/1e9} SOL`);
      console.log(`🎯 Expected: ${Number(tokensOut)/1e6} tokens, Min: ${Number(minTokens)/1e6} tokens`);

      // Build buy instruction
      const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
      const minOutBuf = Buffer.alloc(8);
      minOutBuf.writeBigUInt64LE(BigInt(minTokens));
      const maxInBuf = Buffer.alloc(8);
      maxInBuf.writeBigUInt64LE(BigInt(buyAmountLamports * 200));
      const useWsolBuf = Buffer.from([0]);

      const data = Buffer.concat([discriminator, minOutBuf, maxInBuf, useWsolBuf]);

      const keys = [
        { pubkey: pumpGlobalConfig, isSigner: false, isWritable: false },
        { pubkey: protocolFeeRecipient, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: true },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: poolAta, isSigner: false, isWritable: true },
        { pubkey: buyerAta, isSigner: false, isWritable: true },
        { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: creatorVault, isSigner: false, isWritable: true },
        { pubkey: pumpEventAuthority, isSigner: false, isWritable: false },
        { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
      ];

      const instructions = [];

      // Add ATA creation on first buy if needed
      if (i === 1 && needsAtaCreation) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            buyer.publicKey,
            buyerAta,
            buyer.publicKey,
            tokenMint,
            TOKEN_PROGRAM
          )
        );
        console.log("📝 Creating buyer ATA...");
      }

      instructions.push({ programId: PUMP_PROGRAM, keys, data });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

      const message = new TransactionMessage({
        payerKey: buyer.publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(message);
      tx.sign([buyer]);

      const sig = await connection.sendTransaction(tx, { skipPreflight: false });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });

      // Get token balance
      const tokenAccount = await getAccount(connection, buyerAta, "confirmed", TOKEN_PROGRAM);
      const tokensBought = Number(tokenAccount.amount) / 1e6;
      totalTokensBought = tokensBought;

      console.log(`✅ Buy ${i} successful!`);
      console.log(`💎 Tokens: ${tokensBought.toLocaleString()}`);
      console.log(`🔗 TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);

      successfulBuys++;

      // Wait between buys
      if (i < numBuys) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error: any) {
      console.log(`❌ Buy ${i} failed: ${error.message}`);
      if (error.logs) {
        console.log("\n📋 Error logs:");
        error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
      }
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`📊 SUMMARY`);
  console.log("=".repeat(50));
  console.log(`✅ Successful buys: ${successfulBuys}/${numBuys}`);
  console.log(`💎 Total tokens: ${totalTokensBought.toLocaleString()}`);
  console.log(`\n🎉 Volume generation complete!`);

  // Check creator vault balance
  const vaultInfo = await connection.getAccountInfo(creatorVault);
  const vaultBalance = vaultInfo ? vaultInfo.lamports / 1e9 : 0;
  console.log(`\n💰 Creator Vault: ${vaultBalance.toFixed(6)} SOL`);
  console.log(`\n✅ Ready to test DAT cycle!`);
  console.log(`📝 npx ts-node scripts/execute-cycle-secondary.ts ${tokenFile}`);
}

main();
