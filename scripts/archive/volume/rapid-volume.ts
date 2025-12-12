/**
 * Rapid Volume Generator
 *
 * Generates high volume quickly by executing buy+sell cycles in rapid succession.
 * Each cycle generates ~2x creator fees (fee on buy + fee on sell).
 *
 * Target: 0.05 SOL creator fees in < 2 minutes
 * With ~0.2% fee rate: need ~25 SOL volume total
 * Strategy: 5 tokens × 5 cycles × 1 SOL buy+sell = 50 SOL volume = ~0.1 SOL fees
 */

import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import fs from "fs";
import path from "path";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

interface TokenConfig {
  name: string;
  symbol: string;
  mint: string;
  bondingCurve: string;
  creator: string;
  tokenProgram?: string;
}

async function buyToken(
  connection: Connection,
  buyer: Keypair,
  tokenConfig: TokenConfig,
  amountSol: number
): Promise<string | null> {
  const tokenMint = new PublicKey(tokenConfig.mint);
  const bondingCurve = new PublicKey(tokenConfig.bondingCurve);
  const isMayhem = tokenConfig.tokenProgram === "Token2022";
  const TOKEN_PROGRAM = isMayhem ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const buyerAta = await getAssociatedTokenAddress(tokenMint, buyer.publicKey, false, TOKEN_PROGRAM);
  const poolAta = await getAssociatedTokenAddress(tokenMint, bondingCurve, true, TOKEN_PROGRAM);
  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  const poolWsolAta = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true, TOKEN_PROGRAM_ID);

  const SPL_FEE_RECIPIENT = "6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs";
  const MAYHEM_FEE_RECIPIENT = "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS";
  const protocolFeeRecipient = new PublicKey(isMayhem ? MAYHEM_FEE_RECIPIENT : SPL_FEE_RECIPIENT);
  const protocolAta = await getAssociatedTokenAddress(tokenMint, protocolFeeRecipient, true, TOKEN_PROGRAM);

  const tokenCreator = new PublicKey(tokenConfig.creator);
  const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), tokenCreator.toBuffer()], PUMP_PROGRAM);
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM);
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_PROGRAM);
  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], PUMP_PROGRAM);
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), buyer.publicKey.toBuffer()], PUMP_PROGRAM);
  const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()], FEE_PROGRAM);

  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const buyData = Buffer.alloc(24);
  buyData.set([102, 6, 61, 18, 1, 218, 235, 234], 0);
  buyData.writeBigUInt64LE(BigInt(1), 8); // min tokens
  buyData.writeBigUInt64LE(BigInt(lamports), 16);

  const buyIx = {
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pumpGlobalConfig, isSigner: false, isWritable: false },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: poolAta, isSigner: false, isWritable: true },
      { pubkey: poolWsolAta, isSigner: false, isWritable: true },
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: buyerAta, isSigner: false, isWritable: true },
      { pubkey: protocolFeeRecipient, isSigner: false, isWritable: true },
      { pubkey: protocolAta, isSigner: false, isWritable: true },
      { pubkey: tokenCreator, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), isSigner: false, isWritable: false },
      { pubkey: pumpEventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: buyData,
  };

  try {
    const { blockhash } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: buyer.publicKey,
      recentBlockhash: blockhash,
      instructions: [buyIx],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([buyer]);
    const sig = await connection.sendTransaction(tx, { skipPreflight: true });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  } catch (e: any) {
    console.error(`  ❌ Buy failed: ${e.message?.slice(0, 50)}`);
    return null;
  }
}

async function sellAllTokens(
  connection: Connection,
  seller: Keypair,
  tokenConfig: TokenConfig
): Promise<string | null> {
  const tokenMint = new PublicKey(tokenConfig.mint);
  const bondingCurve = new PublicKey(tokenConfig.bondingCurve);
  const isMayhem = tokenConfig.tokenProgram === "Token2022";
  const TOKEN_PROGRAM = isMayhem ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const sellerAta = await getAssociatedTokenAddress(tokenMint, seller.publicKey, false, TOKEN_PROGRAM);

  let tokenBalance: bigint;
  try {
    const account = await getAccount(connection, sellerAta, "confirmed", TOKEN_PROGRAM);
    tokenBalance = account.amount;
    if (tokenBalance === BigInt(0)) {
      console.error(`  ⚠️ ${tokenConfig.symbol}: No tokens to sell`);
      return null;
    }
  } catch (e: any) {
    console.error(`  ⚠️ ${tokenConfig.symbol}: ATA not found`);
    return null;
  }

  const poolAta = await getAssociatedTokenAddress(tokenMint, bondingCurve, true, TOKEN_PROGRAM);
  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  const poolWsolAta = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true, TOKEN_PROGRAM_ID);

  const SPL_FEE_RECIPIENT = "6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs";
  const MAYHEM_FEE_RECIPIENT = "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS";
  const protocolFeeRecipient = new PublicKey(isMayhem ? MAYHEM_FEE_RECIPIENT : SPL_FEE_RECIPIENT);
  const protocolAta = await getAssociatedTokenAddress(tokenMint, protocolFeeRecipient, true, TOKEN_PROGRAM);

  const tokenCreator = new PublicKey(tokenConfig.creator);
  const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), tokenCreator.toBuffer()], PUMP_PROGRAM);
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM);
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_PROGRAM);
  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], PUMP_PROGRAM);
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), seller.publicKey.toBuffer()], PUMP_PROGRAM);
  const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()], FEE_PROGRAM);

  const sellData = Buffer.alloc(24);
  sellData.set([51, 230, 133, 164, 1, 127, 131, 173], 0);
  sellData.writeBigUInt64LE(tokenBalance, 8);
  sellData.writeBigUInt64LE(BigInt(1), 16); // min SOL out

  const sellIx = {
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: pumpGlobalConfig, isSigner: false, isWritable: false },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: poolAta, isSigner: false, isWritable: true },
      { pubkey: poolWsolAta, isSigner: false, isWritable: true },
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: sellerAta, isSigner: false, isWritable: true },
      { pubkey: protocolFeeRecipient, isSigner: false, isWritable: true },
      { pubkey: protocolAta, isSigner: false, isWritable: true },
      { pubkey: tokenCreator, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: pumpEventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: sellData,
  };

  try {
    const { blockhash } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: seller.publicKey,
      recentBlockhash: blockhash,
      instructions: [sellIx],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([seller]);
    const sig = await connection.sendTransaction(tx, { skipPreflight: true });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  } catch (e: any) {
    console.error(`  ❌ Sell failed: ${e.message?.slice(0, 50)}`);
    return null;
  }
}

async function main() {
  const startTime = Date.now();
  console.log("\n🚀 RAPID VOLUME GENERATOR");
  console.log("═".repeat(60));
  console.log("Target: 0.05 SOL creator fees in < 2 minutes\n");

  // Load tokens
  const tokensDir = "devnet-tokens";
  const tokenFiles = ["01-froot.json", "02-fs1.json", "03-fs2.json", "04-fs3.json", "05-fs4.json"];
  const tokens: TokenConfig[] = tokenFiles.map(f => JSON.parse(fs.readFileSync(path.join(tokensDir, f), "utf-8")));

  const connection = new Connection("https://devnet.helius-rpc.com/?api-key=c4f2afab-a4f7-41e5-8031-7b48ef05de17", "confirmed");
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8"))));

  console.log(`👤 Wallet: ${wallet.publicKey.toString()}`);
  console.log(`🪙 Tokens: ${tokens.map(t => t.symbol).join(", ")}`);

  const BUY_AMOUNT = 0.5; // 0.5 SOL per buy
  const CYCLES = 3; // 3 buy+sell cycles per token (faster)

  console.log(`\n📊 Plan: ${tokens.length} tokens × ${CYCLES} cycles × ${BUY_AMOUNT} SOL`);
  console.log(`   Expected volume: ~${tokens.length * CYCLES * BUY_AMOUNT * 2} SOL`);
  console.log(`   Expected fees: ~${(tokens.length * CYCLES * BUY_AMOUNT * 2 * 0.002).toFixed(3)} SOL\n`);

  let totalBuys = 0;
  let totalSells = 0;

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    console.log(`\n🔄 CYCLE ${cycle}/${CYCLES}`);
    console.log("─".repeat(40));

    // Buy all tokens
    console.log("  📈 Buying...");
    for (const token of tokens) {
      const sig = await buyToken(connection, wallet, token, BUY_AMOUNT);
      if (sig) {
        totalBuys++;
        process.stdout.write(`  ✓ ${token.symbol} `);
      }
    }
    console.log();

    // Wait for buys to be confirmed before selling
    console.log("  ⏳ Waiting 2s for confirmations...");
    await new Promise(r => setTimeout(r, 2000));

    // Sell all tokens
    console.log("  📉 Selling...");
    for (const token of tokens) {
      const sig = await sellAllTokens(connection, wallet, token);
      if (sig) {
        totalSells++;
        process.stdout.write(`  ✓ ${token.symbol} `);
      }
    }
    console.log();
  }

  const elapsed = (Date.now() - startTime) / 1000;

  console.log("\n" + "═".repeat(60));
  console.log("📊 SUMMARY");
  console.log("═".repeat(60));
  console.log(`✅ Buys: ${totalBuys}`);
  console.log(`✅ Sells: ${totalSells}`);
  console.log(`⏱️  Time: ${elapsed.toFixed(1)}s`);
  console.log(`📈 Est. volume: ~${totalBuys * BUY_AMOUNT * 2} SOL`);
  console.log(`💰 Est. fees: ~${(totalBuys * BUY_AMOUNT * 2 * 0.002).toFixed(4)} SOL`);
  console.log();
}

main().catch(console.error);
