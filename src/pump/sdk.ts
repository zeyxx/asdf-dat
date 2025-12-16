/**
 * PumpFun SDK Wrapper - Centralized Trading Operations
 *
 * Single source of truth for all PumpFun interactions.
 * Handles SPL, Token2022, and Mayhem Mode correctly.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { OnlinePumpSdk, PumpSdk } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import * as fs from "fs";
import { TokenConfig, validateTokenConfig } from "../core/types";

// ============================================================================
// Constants
// ============================================================================

export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

// Fee recipients - based on token type
export const FEE_RECIPIENTS = {
  // Standard SPL tokens use this recipient
  SPL: new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs"),
  // Token2022 with Mayhem Mode uses this recipient
  MAYHEM: new PublicKey("GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS"),
  // Token2022 WITHOUT Mayhem Mode - same as SPL (standard create_v2)
  TOKEN2022_STANDARD: new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs"),
};

// ============================================================================
// Token Config Loading
// ============================================================================

/**
 * Load and validate a token config from file
 */
export function loadTokenConfig(filePath: string): TokenConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Token config file not found: ${filePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  // Handle legacy configs that don't have mayhemMode explicitly set
  if (raw.mayhemMode === undefined) {
    // Legacy: if tokenProgram is Token2022 and we don't know, assume NOT mayhem
    // This is safer as Mayhem Mode requires explicit setup
    raw.mayhemMode = false;
  }

  // Handle legacy tokenProgram values
  if (raw.tokenProgram === "Token2022") {
    // Already correct
  } else if (raw.tokenProgram === "SPL" || !raw.tokenProgram) {
    raw.tokenProgram = "SPL";
  }

  if (!validateTokenConfig(raw)) {
    throw new Error(
      `Invalid token config: ${filePath}. Required fields: mint, bondingCurve, creator, name, symbol, tokenProgram, mayhemMode`
    );
  }

  return raw as TokenConfig;
}

// ============================================================================
// PDA Derivation
// ============================================================================

/**
 * Get the correct token program PublicKey
 */
export function getTokenProgram(config: TokenConfig): PublicKey {
  return config.tokenProgram === "Token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

/**
 * Get the correct fee recipient for a token
 */
export function getFeeRecipient(config: TokenConfig): PublicKey {
  if (config.mayhemMode) {
    return FEE_RECIPIENTS.MAYHEM;
  }
  // Both SPL and Token2022 (non-mayhem) use the same recipient
  return FEE_RECIPIENTS.SPL;
}

/**
 * Derive creator vault PDA
 */
export function deriveCreatorVault(creator: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM
  );
  return vault;
}

/**
 * Get all PumpFun PDAs for trading
 */
export function getPumpPDAs(buyer: PublicKey) {
  const [globalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM);
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_PROGRAM);
  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM
  );
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), buyer.toBuffer()],
    PUMP_PROGRAM
  );
  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
    FEE_PROGRAM
  );

  return {
    globalConfig,
    eventAuthority,
    globalVolumeAccumulator,
    userVolumeAccumulator,
    feeConfig,
  };
}

// ============================================================================
// Buy Operation
// ============================================================================

export interface BuyResult {
  success: boolean;
  signature?: string;
  tokensReceived?: number;
  error?: string;
}

/**
 * Buy tokens from PumpFun bonding curve
 */
export async function buyTokens(
  connection: Connection,
  buyer: Keypair,
  config: TokenConfig,
  solAmount: number,
  slippagePct: number = 30
): Promise<BuyResult> {
  const tokenMint = new PublicKey(config.mint);
  const bondingCurve = new PublicKey(config.bondingCurve);
  const creator = new PublicKey(config.creator);
  const TOKEN_PROGRAM = getTokenProgram(config);
  const feeRecipient = getFeeRecipient(config);

  // Get buyer ATA
  const buyerAta = await getAssociatedTokenAddress(tokenMint, buyer.publicKey, false, TOKEN_PROGRAM);

  // Check if ATA exists
  let needsAtaCreation = false;
  try {
    await getAccount(connection, buyerAta, "confirmed", TOKEN_PROGRAM);
  } catch {
    needsAtaCreation = true;
  }

  // Get pool ATAs
  const poolAta = await getAssociatedTokenAddress(tokenMint, bondingCurve, true, TOKEN_PROGRAM);
  const protocolAta = await getAssociatedTokenAddress(tokenMint, feeRecipient, true, TOKEN_PROGRAM);
  const creatorVault = deriveCreatorVault(creator);
  const pdas = getPumpPDAs(buyer.publicKey);

  // Fetch bonding curve state
  const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
  if (!bondingCurveInfo) {
    return { success: false, error: "Bonding curve not found" };
  }

  // Parse bonding curve data (skip 8-byte discriminator)
  const bcData = bondingCurveInfo.data;
  const virtualTokenReserves = bcData.readBigUInt64LE(8);
  const virtualSolReserves = bcData.readBigUInt64LE(16);

  // Calculate tokens out
  const solIn = BigInt(Math.floor(solAmount * 1e9));
  const tokensOut = (solIn * virtualTokenReserves) / (virtualSolReserves + solIn);
  const minTokens = (tokensOut * BigInt(100 - slippagePct)) / BigInt(100);

  // Build buy instruction
  const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
  const minOutBuf = Buffer.alloc(8);
  minOutBuf.writeBigUInt64LE(BigInt(minTokens));
  const maxInBuf = Buffer.alloc(8);
  maxInBuf.writeBigUInt64LE(BigInt(solIn * BigInt(2))); // 2x max
  const useWsolBuf = Buffer.from([0]);

  const data = Buffer.concat([discriminator, minOutBuf, maxInBuf, useWsolBuf]);

  const keys = [
    { pubkey: pdas.globalConfig, isSigner: false, isWritable: false },
    { pubkey: feeRecipient, isSigner: false, isWritable: true },
    { pubkey: tokenMint, isSigner: false, isWritable: true },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: poolAta, isSigner: false, isWritable: true },
    { pubkey: buyerAta, isSigner: false, isWritable: true },
    { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
    { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: pdas.eventAuthority, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: pdas.globalVolumeAccumulator, isSigner: false, isWritable: false },
    { pubkey: pdas.userVolumeAccumulator, isSigner: false, isWritable: true },
    { pubkey: pdas.feeConfig, isSigner: false, isWritable: false },
    { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
  ];

  const instructions = [];

  // Add ATA creation if needed
  if (needsAtaCreation) {
    instructions.push(
      createAssociatedTokenAccountInstruction(buyer.publicKey, buyerAta, buyer.publicKey, tokenMint, TOKEN_PROGRAM)
    );
  }

  instructions.push({ programId: PUMP_PROGRAM, keys, data });

  try {
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

    // Get final balance
    const tokenAccount = await getAccount(connection, buyerAta, "confirmed", TOKEN_PROGRAM);
    const tokensReceived = Number(tokenAccount.amount) / 1e6;

    return { success: true, signature: sig, tokensReceived };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Sell Operation
// ============================================================================

export interface SellResult {
  success: boolean;
  signature?: string;
  solReceived?: number;
  error?: string;
}

/**
 * Sell tokens on PumpFun bonding curve
 */
export async function sellTokens(
  connection: Connection,
  seller: Keypair,
  config: TokenConfig,
  slippagePct: number = 25
): Promise<SellResult> {
  const tokenMint = new PublicKey(config.mint);
  const TOKEN_PROGRAM = getTokenProgram(config);

  // Get seller's token account
  const sellerAta = await getAssociatedTokenAddress(tokenMint, seller.publicKey, false, TOKEN_PROGRAM);

  // Get token balance
  let tokenBalance: bigint;
  try {
    const account = await getAccount(connection, sellerAta, "confirmed", TOKEN_PROGRAM);
    tokenBalance = account.amount;
  } catch {
    return { success: false, error: "No token account found" };
  }

  if (tokenBalance === 0n) {
    return { success: false, error: "No tokens to sell" };
  }

  // Skip dust
  const tokenBalanceNum = Number(tokenBalance) / 1e6;
  if (tokenBalanceNum < 100) {
    return { success: false, error: `Skipping dust: ${tokenBalanceNum.toFixed(2)} tokens (< 100)` };
  }

  // Use PumpFun SDK for sell
  const sdk = new OnlinePumpSdk(connection);
  const offlineSdk = new PumpSdk();

  try {
    const global = await sdk.fetchGlobal();
    const { bondingCurveAccountInfo, bondingCurve } = await sdk.fetchSellState(
      tokenMint,
      seller.publicKey,
      TOKEN_PROGRAM
    );

    const instructions = await offlineSdk.sellInstructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      mint: tokenMint,
      user: seller.publicKey,
      amount: new BN(tokenBalance.toString()),
      solAmount: new BN(1), // Minimal, slippage handles the rest
      slippage: slippagePct,
      tokenProgram: TOKEN_PROGRAM,
      mayhemMode: config.mayhemMode,
    });

    const tx = new Transaction();
    for (const ix of instructions) {
      tx.add(ix);
    }

    const balanceBefore = await connection.getBalance(seller.publicKey);
    const sig = await sendAndConfirmTransaction(connection, tx, [seller], { commitment: "confirmed" });
    const balanceAfter = await connection.getBalance(seller.publicKey);

    const solReceived = (balanceAfter - balanceBefore) / 1e9;

    return { success: true, signature: sig, solReceived };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Volume Generation
// ============================================================================

export interface VolumeResult {
  successfulBuys: number;
  totalBuys: number;
  totalTokens: number;
  transactions: string[];
  errors: string[];
}

/**
 * Generate trading volume on a token
 */
export async function generateVolume(
  connection: Connection,
  buyer: Keypair,
  config: TokenConfig,
  numBuys: number,
  solPerBuy: number
): Promise<VolumeResult> {
  const result: VolumeResult = {
    successfulBuys: 0,
    totalBuys: numBuys,
    totalTokens: 0,
    transactions: [],
    errors: [],
  };

  for (let i = 0; i < numBuys; i++) {
    const buyResult = await buyTokens(connection, buyer, config, solPerBuy);

    if (buyResult.success) {
      result.successfulBuys++;
      result.totalTokens = buyResult.tokensReceived || 0;
      if (buyResult.signature) result.transactions.push(buyResult.signature);
    } else {
      result.errors.push(`Buy ${i + 1}: ${buyResult.error}`);
    }

    // Wait between buys
    if (i < numBuys - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return result;
}

// ============================================================================
// Wallet Loading
// ============================================================================

/**
 * Load wallet from JSON file
 */
export function loadWallet(path: string): Keypair {
  if (!fs.existsSync(path)) {
    throw new Error(`Wallet file not found: ${path}`);
  }
  const data = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(data));
}
