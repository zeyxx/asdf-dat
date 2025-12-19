/**
 * ASDF Burn Engine - Transaction Builder
 *
 * Builds batch transactions for cycle execution.
 * Handles both Bonding Curve and PumpSwap AMM tokens.
 *
 * Batch pattern: [ComputeBudget] + [Collect] + [Buy] + [Finalize] + [Burn] + [DevFee]
 */

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
  Keypair,
  Connection,
} from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  PROGRAM_ID,
  DAT_STATE_SEED,
  DAT_AUTHORITY_SEED,
  TOKEN_STATS_SEED,
  ROOT_TREASURY_SEED,
  PUMP_PROGRAM,
  PUMPSWAP_PROGRAM,
  WSOL_MINT,
  getProtocolFeeRecipient,
  PUMPSWAP_PROTOCOL_FEE_RECIPIENT,
} from "./constants";
import {
  getBcCreatorVault,
  getAmmCreatorVaultAta,
  deriveAmmCreatorVaultAuthority,
} from "../pump/amm-utils";
import { TrackedToken, PoolType } from "../types";
import { createLogger } from "../utils/logger";

const log = createLogger("tx-builder");

// ============================================================================
// External Program Constants
// ============================================================================

// ============================================================================
// Pump.fun Program Constants
// ============================================================================

const PUMP_GLOBAL_CONFIG = new PublicKey(
  "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
);
const PUMP_EVENT_AUTHORITY = new PublicKey(
  "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"
);
const FEE_PROGRAM = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

// Dev sustainability wallet - receives 1% of secondary burns
// 1% today = 99% burns forever
const DEV_WALLET = new PublicKey(
  "dcW5uy7wKdKFxkhyBfPv3MyvrCkDcv1rWucoat13KH4"
);

// NOTE: Protocol fee recipients are now centralized in constants.ts
// Use getProtocolFeeRecipient(token, network) instead of hardcoded values
// See: PUMP_FEE_RECIPIENTS in constants.ts for documentation

// ============================================================================
// Types
// ============================================================================

export interface TokenConfig {
  mint: PublicKey;
  symbol: string;
  bondingCurve: PublicKey;
  poolType: PoolType;
  creator: PublicKey;
  isToken2022: boolean;
  mayhemMode?: boolean;
}

export interface BuildSecondaryBatchParams {
  token: TokenConfig;
  allocation: bigint;
  adminPubkey: PublicKey;
  rootMint: PublicKey;
}

export interface BuildRootBatchParams {
  token: TokenConfig;
  allocation: bigint;
  adminPubkey: PublicKey;
}

// ============================================================================
// Transaction Builder
// ============================================================================

export class TransactionBuilder {
  /**
   * Transaction builder for ASDF Burn Engine cycles
   *
   * @param program - Anchor program instance
   * @param network - Network for fee recipient selection
   *                  CRITICAL: devnet uses SPL recipient for ALL tokens
   *                  Using wrong recipient causes Custom:3012 or Custom:6000 errors
   */
  constructor(
    private program: Program,
    private network: 'devnet' | 'mainnet' = 'devnet'
  ) {}

  /**
   * Build batch transaction for secondary token
   * Pattern: ComputeBudget + Collect + Buy + Finalize + Burn + DevFee
   */
  async buildSecondaryBatch(
    params: BuildSecondaryBatchParams,
    priorityFee: number = 10000
  ): Promise<TransactionInstruction[]> {
    const { token, allocation, adminPubkey, rootMint } = params;
    const instructions: TransactionInstruction[] = [];

    log.debug("Building secondary batch", {
      token: token.symbol,
      allocation: allocation.toString(),
      poolType: token.poolType,
    });

    // Derive common PDAs
    const [datState] = PublicKey.findProgramAddressSync(
      [DAT_STATE_SEED],
      this.program.programId
    );
    const [datAuthority] = PublicKey.findProgramAddressSync(
      [DAT_AUTHORITY_SEED],
      this.program.programId
    );
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, token.mint.toBuffer()],
      this.program.programId
    );
    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [ROOT_TREASURY_SEED, rootMint.toBuffer()],
      this.program.programId
    );

    const tokenProgram = token.isToken2022
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    // DAT's token account for this token
    const [datTokenAccount] = PublicKey.findProgramAddressSync(
      [datAuthority.toBuffer(), tokenProgram.toBuffer(), token.mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM
    );

    // Compute budget for complex batch
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
    );

    // Route based on pool type
    if (token.poolType === "pumpswap_amm") {
      instructions.push(
        ...(await this.buildAmmInstructions({
          token,
          allocation,
          datState,
          datAuthority,
          tokenStats,
          datTokenAccount,
          tokenProgram,
        }))
      );
    } else {
      instructions.push(
        ...(await this.buildBondingCurveInstructions({
          token,
          allocation,
          datState,
          datAuthority,
          tokenStats,
          datTokenAccount,
          tokenProgram,
          rootTreasury,
        }))
      );
    }

    // Finalize instruction (reset pending_fees)
    instructions.push(
      await this.buildFinalizeInstruction({
        datState,
        tokenStats,
        adminPubkey,
        actuallyParticipated: true,
      })
    );

    // Burn instruction
    instructions.push(
      await this.buildBurnInstruction({
        datState,
        tokenStats,
        datAuthority,
        tokenMint: token.mint,
        datTokenAccount,
        tokenProgram,
      })
    );

    // Dev fee instruction (1% of secondary share)
    instructions.push(
      await this.buildDevFeeInstruction({
        datState,
        datAuthority,
        allocation,
      })
    );

    log.debug("Secondary batch built", {
      token: token.symbol,
      instructionCount: instructions.length,
    });

    return instructions;
  }

  /**
   * Build batch transaction for root token
   * Pattern: ComputeBudget + Collect + Buy + Finalize + Burn
   * No dev fee for root (100% burn)
   */
  async buildRootBatch(
    params: BuildRootBatchParams,
    priorityFee: number = 10000
  ): Promise<TransactionInstruction[]> {
    const { token, allocation, adminPubkey } = params;
    const instructions: TransactionInstruction[] = [];

    log.debug("Building root batch", {
      token: token.symbol,
      allocation: allocation.toString(),
    });

    // Derive PDAs
    const [datState] = PublicKey.findProgramAddressSync(
      [DAT_STATE_SEED],
      this.program.programId
    );
    const [datAuthority] = PublicKey.findProgramAddressSync(
      [DAT_AUTHORITY_SEED],
      this.program.programId
    );
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, token.mint.toBuffer()],
      this.program.programId
    );
    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [ROOT_TREASURY_SEED, token.mint.toBuffer()],
      this.program.programId
    );

    const tokenProgram = token.isToken2022
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const [datTokenAccount] = PublicKey.findProgramAddressSync(
      [datAuthority.toBuffer(), tokenProgram.toBuffer(), token.mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM
    );

    // Compute budget
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
    );

    // Root collect + buy (similar to secondary but uses root treasury)
    if (token.poolType === "pumpswap_amm") {
      instructions.push(
        ...(await this.buildRootAmmInstructions({
          token,
          allocation,
          datState,
          datAuthority,
          tokenStats,
          datTokenAccount,
          tokenProgram,
          rootTreasury,
        }))
      );
    } else {
      instructions.push(
        ...(await this.buildRootBondingCurveInstructions({
          token,
          allocation,
          datState,
          datAuthority,
          tokenStats,
          datTokenAccount,
          tokenProgram,
          rootTreasury,
        }))
      );
    }

    // Finalize
    instructions.push(
      await this.buildFinalizeInstruction({
        datState,
        tokenStats,
        adminPubkey,
        actuallyParticipated: true,
      })
    );

    // Burn (100% for root, no dev fee)
    instructions.push(
      await this.buildBurnInstruction({
        datState,
        tokenStats,
        datAuthority,
        tokenMint: token.mint,
        datTokenAccount,
        tokenProgram,
      })
    );

    log.debug("Root batch built", {
      token: token.symbol,
      instructionCount: instructions.length,
    });

    return instructions;
  }

  /**
   * Build finalize-only instruction for deferred tokens
   * Preserves pending_fees for next cycle
   */
  async buildDeferredFinalize(
    tokenMint: PublicKey,
    adminPubkey: PublicKey
  ): Promise<TransactionInstruction> {
    const [datState] = PublicKey.findProgramAddressSync(
      [DAT_STATE_SEED],
      this.program.programId
    );
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, tokenMint.toBuffer()],
      this.program.programId
    );

    return this.buildFinalizeInstruction({
      datState,
      tokenStats,
      adminPubkey,
      actuallyParticipated: false, // Preserve pending_fees
    });
  }

  // ============================================================================
  // Private: Bonding Curve Instructions
  // ============================================================================

  private async buildBondingCurveInstructions(params: {
    token: TokenConfig;
    allocation: bigint;
    datState: PublicKey;
    datAuthority: PublicKey;
    tokenStats: PublicKey;
    datTokenAccount: PublicKey;
    tokenProgram: PublicKey;
    rootTreasury: PublicKey;
  }): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];
    const { token, allocation, datState, datAuthority, tokenStats, datTokenAccount, tokenProgram, rootTreasury } = params;

    // Creator vault PDA - use datAuthority as creator (DAT is the creator for fee collection)
    const creatorVault = getBcCreatorVault(datAuthority);

    // Event authority
    const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PUMP_PROGRAM
    );

    // Collect fees instruction
    const collectIx = await this.program.methods
      .collectFees(false, true) // is_root_token=false, for_ecosystem=true
      .accounts({
        datState,
        tokenStats,
        tokenMint: token.mint,
        datAuthority,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    instructions.push(collectIx);

    // Pool token account
    const [poolTokenAccount] = PublicKey.findProgramAddressSync(
      [
        token.bondingCurve.toBuffer(),
        tokenProgram.toBuffer(),
        token.mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM
    );

    // Volume accumulators
    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_volume_accumulator")],
      PUMP_PROGRAM
    );
    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_volume_accumulator"), datAuthority.toBuffer()],
      PUMP_PROGRAM
    );
    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
      FEE_PROGRAM
    );

    // Protocol fee recipient - network-aware selection
    // CRITICAL: Devnet uses SPL recipient for ALL tokens (Token2022 recipient doesn't exist)
    // Using wrong recipient causes Custom:3012 or Custom:6000 errors
    const protocolFeeRecipient = getProtocolFeeRecipient(token, this.network);

    // Buy instruction
    const buyIx = await this.program.methods
      .executeBuySecondary(new BN(allocation.toString()))
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        pool: token.bondingCurve,
        asdfMint: token.mint,
        poolAsdfAccount: poolTokenAccount,
        pumpGlobalConfig: PUMP_GLOBAL_CONFIG,
        protocolFeeRecipient,
        creatorVault,
        pumpEventAuthority: PUMP_EVENT_AUTHORITY,
        pumpSwapProgram: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        rootTreasury,
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    instructions.push(buyIx);

    return instructions;
  }

  // ============================================================================
  // Private: AMM Instructions
  // ============================================================================

  private async buildAmmInstructions(params: {
    token: TokenConfig;
    allocation: bigint;
    datState: PublicKey;
    datAuthority: PublicKey;
    tokenStats: PublicKey;
    datTokenAccount: PublicKey;
    tokenProgram: PublicKey;
  }): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];
    const { token, allocation, datState, datAuthority, tokenStats, datTokenAccount, tokenProgram } = params;

    // DAT's WSOL account
    const [datWsolAccount] = PublicKey.findProgramAddressSync(
      [datAuthority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM
    );

    // AMM creator vault accounts - use datAuthority as creator (DAT is the creator for fee collection)
    const [creatorVaultAuthority] = deriveAmmCreatorVaultAuthority(datAuthority);
    const creatorVaultAta = getAmmCreatorVaultAta(datAuthority);

    const pool = token.bondingCurve; // For AMM, bondingCurve is the pool address

    // Pool token accounts
    const [poolBaseTokenAccount] = PublicKey.findProgramAddressSync(
      [pool.toBuffer(), tokenProgram.toBuffer(), token.mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM
    );
    const [poolQuoteTokenAccount] = PublicKey.findProgramAddressSync(
      [pool.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM
    );

    // Protocol fee recipient ATA
    const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
      [PUMPSWAP_PROTOCOL_FEE_RECIPIENT.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM
    );

    // Volume accumulators
    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_volume_accumulator")],
      PUMPSWAP_PROGRAM
    );
    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_volume_accumulator"), datAuthority.toBuffer()],
      PUMPSWAP_PROGRAM
    );
    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), PUMPSWAP_PROGRAM.toBuffer()],
      FEE_PROGRAM
    );

    // Step 1: Collect fees from AMM creator vault
    const collectAmmIx = await this.program.methods
      .collectFeesAmm()
      .accounts({
        datState,
        tokenStats,
        tokenMint: token.mint,
        datAuthority,
        datWsolAccount,
        creatorVaultAuthority,
        creatorVaultAta,
        wsolMint: WSOL_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        pumpSwapProgram: PUMPSWAP_PROGRAM,
      })
      .instruction();

    instructions.push(collectAmmIx);

    // Step 2: Unwrap WSOL → SOL
    const unwrapIx = await this.program.methods
      .unwrapWsol()
      .accounts({
        datState,
        datAuthority,
        datWsolAccount,
        wsolMint: WSOL_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    instructions.push(unwrapIx);

    // Step 3: Wrap SOL → WSOL for AMM buy
    const wrapIx = await this.program.methods
      .wrapWsol(new BN(allocation.toString()))
      .accounts({
        datState,
        datAuthority,
        datWsolAccount,
        wsolMint: WSOL_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    instructions.push(wrapIx);

    // Step 4: Buy tokens via AMM
    const desiredTokens = new BN(1_000_000); // Minimum, actual determined by CPI
    const maxSolCost = new BN(allocation.toString());

    const buyIx = await this.program.methods
      .executeBuyAmm(desiredTokens, maxSolCost)
      .accounts({
        datState,
        datAuthority,
        datTokenAccount,
        pool,
        globalConfig: PUMP_GLOBAL_CONFIG,
        baseMint: token.mint,
        quoteMint: WSOL_MINT,
        datWsolAccount,
        poolBaseTokenAccount,
        poolQuoteTokenAccount,
        protocolFeeRecipient: PUMPSWAP_PROTOCOL_FEE_RECIPIENT,
        protocolFeeRecipientAta,
        baseTokenProgram: tokenProgram,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
        eventAuthority: PUMP_EVENT_AUTHORITY,
        pumpSwapProgram: PUMPSWAP_PROGRAM,
        coinCreatorVaultAta: creatorVaultAta,
        coinCreatorVaultAuthority: creatorVaultAuthority,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
      })
      .instruction();

    instructions.push(buyIx);

    return instructions;
  }

  // ============================================================================
  // Private: Root Token Instructions
  // ============================================================================

  private async buildRootBondingCurveInstructions(params: {
    token: TokenConfig;
    allocation: bigint;
    datState: PublicKey;
    datAuthority: PublicKey;
    tokenStats: PublicKey;
    datTokenAccount: PublicKey;
    tokenProgram: PublicKey;
    rootTreasury: PublicKey;
  }): Promise<TransactionInstruction[]> {
    // Root bonding curve uses similar pattern but with is_root_token=true
    const instructions: TransactionInstruction[] = [];
    const { token, allocation, datState, datAuthority, tokenStats, datTokenAccount, tokenProgram, rootTreasury } = params;

    // Creator vault PDA - use datAuthority as creator (DAT is the creator for fee collection)
    const creatorVault = getBcCreatorVault(datAuthority);

    const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PUMP_PROGRAM
    );

    // Collect with is_root_token=true
    const collectIx = await this.program.methods
      .collectFees(true, true) // is_root_token=true, for_ecosystem=true
      .accounts({
        datState,
        tokenStats,
        tokenMint: token.mint,
        datAuthority,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    instructions.push(collectIx);

    // Buy root tokens
    const [poolTokenAccount] = PublicKey.findProgramAddressSync(
      [
        token.bondingCurve.toBuffer(),
        tokenProgram.toBuffer(),
        token.mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM
    );

    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_volume_accumulator")],
      PUMP_PROGRAM
    );
    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_volume_accumulator"), datAuthority.toBuffer()],
      PUMP_PROGRAM
    );
    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
      FEE_PROGRAM
    );

    // Protocol fee recipient - network-aware selection
    // CRITICAL: Devnet uses SPL recipient for ALL tokens (Token2022 recipient doesn't exist)
    // Using wrong recipient causes Custom:3012 or Custom:6000 errors
    const protocolFeeRecipient = getProtocolFeeRecipient(token, this.network);

    // ROOT TOKEN: Use executeBuy (not executeBuySecondary) - 100% burn, no split
    // Note: execute_buy does NOT take rootTreasury (that's for secondaries only)
    const buyIx = await this.program.methods
      .executeBuy(new BN(allocation.toString()))
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        pool: token.bondingCurve,
        asdfMint: token.mint,
        poolAsdfAccount: poolTokenAccount,
        pumpGlobalConfig: PUMP_GLOBAL_CONFIG,
        protocolFeeRecipient,
        creatorVault,
        pumpEventAuthority: PUMP_EVENT_AUTHORITY,
        pumpSwapProgram: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    instructions.push(buyIx);

    return instructions;
  }

  private async buildRootAmmInstructions(params: {
    token: TokenConfig;
    allocation: bigint;
    datState: PublicKey;
    datAuthority: PublicKey;
    tokenStats: PublicKey;
    datTokenAccount: PublicKey;
    tokenProgram: PublicKey;
    rootTreasury: PublicKey;
  }): Promise<TransactionInstruction[]> {
    // Similar to secondary AMM but for root token
    // For now, use same pattern - can be specialized if needed
    return this.buildAmmInstructions({
      token: params.token,
      allocation: params.allocation,
      datState: params.datState,
      datAuthority: params.datAuthority,
      tokenStats: params.tokenStats,
      datTokenAccount: params.datTokenAccount,
      tokenProgram: params.tokenProgram,
    });
  }

  // ============================================================================
  // Private: Common Instructions
  // ============================================================================

  private async buildFinalizeInstruction(params: {
    datState: PublicKey;
    tokenStats: PublicKey;
    adminPubkey: PublicKey;
    actuallyParticipated: boolean;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .finalizeAllocatedCycle(params.actuallyParticipated)
      .accounts({
        datState: params.datState,
        tokenStats: params.tokenStats,
        admin: params.adminPubkey,
      })
      .instruction();
  }

  private async buildBurnInstruction(params: {
    datState: PublicKey;
    tokenStats: PublicKey;
    datAuthority: PublicKey;
    tokenMint: PublicKey;
    datTokenAccount: PublicKey;
    tokenProgram: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .burnAndUpdate()
      .accounts({
        datState: params.datState,
        tokenStats: params.tokenStats,
        datAuthority: params.datAuthority,
        asdfMint: params.tokenMint,
        datAsdfAccount: params.datTokenAccount,
        tokenProgram: params.tokenProgram,
      })
      .instruction();
  }

  private async buildDevFeeInstruction(params: {
    datState: PublicKey;
    datAuthority: PublicKey;
    allocation: bigint;
  }): Promise<TransactionInstruction> {
    // 1% dev fee from secondary share (55.2% × 1% = 0.552% of total)
    const SECONDARY_KEEP_RATIO = 0.552;
    const secondaryShareLamports = Math.floor(
      Number(params.allocation) * SECONDARY_KEEP_RATIO
    );

    return this.program.methods
      .transferDevFee(new BN(secondaryShareLamports))
      .accounts({
        datState: params.datState,
        datAuthority: params.datAuthority,
        devWallet: DEV_WALLET,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }
}
