/**
 * ASDF Validator SDK
 *
 * Minimal SDK for per-token fee attribution on Pump.fun tokens.
 * Track individual token contributions when multiple tokens share a creator vault.
 *
 * @example
 * ```typescript
 * import { ValidatorSDK } from '@asdf/validator-sdk';
 *
 * const sdk = new ValidatorSDK(connection, programId);
 *
 * // Initialize validator for a token
 * await sdk.initialize(mint, bondingCurve, payer);
 *
 * // Query contribution
 * const contribution = await sdk.getContribution(mint);
 * console.log(`Fees: ${contribution.totalSOL} SOL`);
 * ```
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js';

// ============================================================================
// Constants
// ============================================================================

/** Default ASDF-DAT Program ID */
export const ASDF_PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');

/** PumpFun Program ID */
export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

/** PumpSwap AMM Program ID */
export const PUMPSWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

const VALIDATOR_STATE_SEED = 'validator_v1';

// Anchor discriminators (first 8 bytes of sha256("global:<instruction_name>"))
const DISCRIMINATORS = {
  initializeValidator: Buffer.from([182, 93, 238, 42, 237, 156, 100, 188]),
};

// ============================================================================
// Types
// ============================================================================

/** Validator state stored on-chain */
export interface ValidatorState {
  mint: PublicKey;
  bondingCurve: PublicKey;
  lastValidatedSlot: number;
  totalValidatedLamports: bigint;
  totalValidatedCount: number;
  feeRateBps: number;
  bump: number;
}

/** Token contribution data */
export interface TokenContribution {
  mint: string;
  totalLamports: bigint;
  totalSOL: number;
  validationCount: number;
  lastSlot: number;
  feeRateBps: number;
}

/** Contribution with percentage of total */
export interface RankedContribution extends TokenContribution {
  percentage: number;
  rank: number;
}

// ============================================================================
// SDK Class
// ============================================================================

/**
 * ASDF Validator SDK
 *
 * Enables per-token fee attribution for Pump.fun token ecosystems.
 */
export class ValidatorSDK {
  private connection: Connection;
  private programId: PublicKey;

  /**
   * Create a new ValidatorSDK instance
   *
   * @param connection - Solana RPC connection
   * @param programId - ASDF-DAT program ID (optional, defaults to mainnet)
   */
  constructor(connection: Connection, programId: PublicKey = ASDF_PROGRAM_ID) {
    this.connection = connection;
    this.programId = programId;
  }

  // --------------------------------------------------------------------------
  // PDA Derivation
  // --------------------------------------------------------------------------

  /**
   * Derive ValidatorState PDA for a token
   */
  deriveValidatorPDA(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(VALIDATOR_STATE_SEED), mint.toBuffer()],
      this.programId
    );
  }

  // --------------------------------------------------------------------------
  // Read Operations
  // --------------------------------------------------------------------------

  /**
   * Check if a validator is initialized for a token
   */
  async isInitialized(mint: PublicKey): Promise<boolean> {
    const [pda] = this.deriveValidatorPDA(mint);
    const account = await this.connection.getAccountInfo(pda);
    return account !== null;
  }

  /**
   * Get raw ValidatorState account data
   */
  async getValidatorState(mint: PublicKey): Promise<ValidatorState | null> {
    const [pda] = this.deriveValidatorPDA(mint);
    const account = await this.connection.getAccountInfo(pda);

    if (!account) return null;

    return this.parseValidatorState(account.data);
  }

  /**
   * Get contribution data for a single token
   */
  async getContribution(mint: PublicKey): Promise<TokenContribution | null> {
    const state = await this.getValidatorState(mint);
    if (!state) return null;

    return {
      mint: mint.toBase58(),
      totalLamports: state.totalValidatedLamports,
      totalSOL: Number(state.totalValidatedLamports) / 1e9,
      validationCount: state.totalValidatedCount,
      lastSlot: state.lastValidatedSlot,
      feeRateBps: state.feeRateBps,
    };
  }

  /**
   * Get contributions for multiple tokens
   */
  async getContributions(mints: PublicKey[]): Promise<Map<string, TokenContribution>> {
    const results = new Map<string, TokenContribution>();

    // Batch fetch accounts for efficiency
    const pdas = mints.map(m => this.deriveValidatorPDA(m)[0]);
    const accounts = await this.connection.getMultipleAccountsInfo(pdas);

    for (let i = 0; i < mints.length; i++) {
      const account = accounts[i];
      if (!account) continue;

      const state = this.parseValidatorState(account.data);
      results.set(mints[i].toBase58(), {
        mint: mints[i].toBase58(),
        totalLamports: state.totalValidatedLamports,
        totalSOL: Number(state.totalValidatedLamports) / 1e9,
        validationCount: state.totalValidatedCount,
        lastSlot: state.lastValidatedSlot,
        feeRateBps: state.feeRateBps,
      });
    }

    return results;
  }

  /**
   * Get ranked leaderboard of contributions
   */
  async getLeaderboard(mints: PublicKey[]): Promise<RankedContribution[]> {
    const contributions = await this.getContributions(mints);
    const total = Array.from(contributions.values())
      .reduce((sum, c) => sum + Number(c.totalLamports), 0);

    const ranked: RankedContribution[] = Array.from(contributions.values())
      .map(c => ({
        ...c,
        percentage: total > 0 ? (Number(c.totalLamports) / total) * 100 : 0,
        rank: 0,
      }))
      .sort((a, b) => Number(b.totalLamports) - Number(a.totalLamports));

    // Assign ranks
    ranked.forEach((c, i) => { c.rank = i + 1; });

    return ranked;
  }

  // --------------------------------------------------------------------------
  // Write Operations
  // --------------------------------------------------------------------------

  /**
   * Build transaction to initialize validator for a token
   *
   * @param mint - Token mint address
   * @param bondingCurve - PumpFun bonding curve or PumpSwap pool address
   * @param payer - Transaction payer (will sign)
   * @returns Transaction ready to sign and send
   */
  buildInitializeTransaction(
    mint: PublicKey,
    bondingCurve: PublicKey,
    payer: PublicKey
  ): Transaction {
    const [validatorState] = this.deriveValidatorPDA(mint);

    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: validatorState, isSigner: false, isWritable: true },
        { pubkey: bondingCurve, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: DISCRIMINATORS.initializeValidator,
    });

    const tx = new Transaction().add(instruction);
    tx.feePayer = payer;

    return tx;
  }

  /**
   * Initialize validator for a token (convenience method)
   *
   * @param mint - Token mint address
   * @param bondingCurve - PumpFun bonding curve address
   * @param payer - Payer keypair
   * @param sendTransaction - Function to sign and send transaction
   * @returns Transaction signature
   */
  async initialize(
    mint: PublicKey,
    bondingCurve: PublicKey,
    payer: PublicKey,
    sendTransaction: (tx: Transaction) => Promise<string>
  ): Promise<string> {
    // Check if already initialized
    if (await this.isInitialized(mint)) {
      throw new Error('Validator already initialized for this token');
    }

    const tx = this.buildInitializeTransaction(mint, bondingCurve, payer);
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return sendTransaction(tx);
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Calculate proportional distribution based on contributions
   */
  calculateDistribution(
    contributions: Map<string, TokenContribution>,
    amountLamports: bigint
  ): Map<string, bigint> {
    const total = Array.from(contributions.values())
      .reduce((sum, c) => sum + c.totalLamports, 0n);

    const distribution = new Map<string, bigint>();

    if (total === 0n) return distribution;

    for (const [mint, contribution] of contributions) {
      const share = (amountLamports * contribution.totalLamports) / total;
      distribution.set(mint, share);
    }

    return distribution;
  }

  /**
   * Verify bonding curve is owned by PumpFun or PumpSwap
   */
  async verifyPool(bondingCurve: PublicKey): Promise<'pumpfun' | 'pumpswap' | null> {
    const account = await this.connection.getAccountInfo(bondingCurve);
    if (!account) return null;

    if (account.owner.equals(PUMP_PROGRAM_ID)) return 'pumpfun';
    if (account.owner.equals(PUMPSWAP_PROGRAM_ID)) return 'pumpswap';

    return null;
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  private parseValidatorState(data: Buffer): ValidatorState {
    // Layout: discriminator(8) + mint(32) + bonding_curve(32) +
    //         last_validated_slot(8) + total_validated_lamports(8) +
    //         total_validated_count(8) + fee_rate_bps(2) + bump(1)
    return {
      mint: new PublicKey(data.subarray(8, 40)),
      bondingCurve: new PublicKey(data.subarray(40, 72)),
      lastValidatedSlot: Number(data.readBigUInt64LE(72)),
      totalValidatedLamports: data.readBigUInt64LE(80),
      totalValidatedCount: Number(data.readBigUInt64LE(88)),
      feeRateBps: data.readUInt16LE(96),
      bump: data[98],
    };
  }
}

// ============================================================================
// Standalone Functions (for those who prefer functional style)
// ============================================================================

/**
 * Derive ValidatorState PDA
 */
export function deriveValidatorPDA(
  mint: PublicKey,
  programId: PublicKey = ASDF_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VALIDATOR_STATE_SEED), mint.toBuffer()],
    programId
  );
}

/**
 * Check if validator is initialized
 */
export async function isValidatorInitialized(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey = ASDF_PROGRAM_ID
): Promise<boolean> {
  const [pda] = deriveValidatorPDA(mint, programId);
  const account = await connection.getAccountInfo(pda);
  return account !== null;
}

/**
 * Get token contribution
 */
export async function getTokenContribution(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey = ASDF_PROGRAM_ID
): Promise<TokenContribution | null> {
  const sdk = new ValidatorSDK(connection, programId);
  return sdk.getContribution(mint);
}

// ============================================================================
// Export Default
// ============================================================================

export default ValidatorSDK;
