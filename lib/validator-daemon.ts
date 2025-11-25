/**
 * Validator Daemon - Trustless Per-Token Fee Attribution
 *
 * This daemon monitors PumpFun trades and extracts exact fee amounts from
 * transaction logs, then commits them on-chain via the permissionless
 * register_validated_fees instruction.
 *
 * Architecture:
 * 1. Subscribe to bonding curve account changes (indicates a trade)
 * 2. Parse transaction logs for "Transfer X lamports to creator-vault"
 * 3. Accumulate fees per token in memory
 * 4. Batch commit to on-chain every 30 seconds via register_validated_fees
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';

const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const VALIDATOR_STATE_SEED = Buffer.from('validator_v1');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

// Max slot range allowed by on-chain program (lib.rs:554)
const MAX_SLOT_RANGE = 1000;

// Adaptive flush threshold: trigger early flush when approaching max slot range
// 80% of MAX_SLOT_RANGE provides a safety buffer
const ADAPTIVE_FLUSH_THRESHOLD = 800;

// Adaptive flush check interval (milliseconds)
const ADAPTIVE_CHECK_INTERVAL = 5000; // 5 seconds

export interface TokenConfig {
  mint: PublicKey;
  bondingCurve: PublicKey;
  creator: PublicKey;
  symbol: string;
}

interface PendingValidation {
  feeAmount: bigint;
  txSignatures: string[];
  startSlot: number;
  endSlot: number;
}

interface ValidatorDaemonConfig {
  connection: Connection;
  program: Program;
  tokens: TokenConfig[];
  flushInterval?: number; // ms, default 30000
  verbose?: boolean;
}

export class ValidatorDaemon {
  private connection: Connection;
  private program: Program;
  private tokens: Map<string, TokenConfig>;
  private pendingValidations: Map<string, PendingValidation>;
  private subscriptionIds: Map<string, number>;
  private flushInterval: number;
  private verbose: boolean;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private adaptiveCheckTimer: ReturnType<typeof setInterval> | null = null;
  private running: boolean = false;

  constructor(config: ValidatorDaemonConfig) {
    this.connection = config.connection;
    this.program = config.program;
    this.tokens = new Map(config.tokens.map(t => [t.mint.toBase58(), t]));
    this.pendingValidations = new Map();
    this.subscriptionIds = new Map();
    this.flushInterval = config.flushInterval || 30000;
    this.verbose = config.verbose || false;
  }

  /**
   * Start monitoring all tokens for trades
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('Validator daemon already running');
      return;
    }

    this.running = true;
    console.log('🚀 Starting Validator Daemon...');
    console.log(`📊 Monitoring ${this.tokens.size} tokens`);
    console.log(`⏱️  Flush interval: ${this.flushInterval / 1000}s`);

    const currentSlot = await this.connection.getSlot();

    for (const [mintKey, config] of this.tokens) {
      // Initialize pending validation
      this.pendingValidations.set(mintKey, {
        feeAmount: 0n,
        txSignatures: [],
        startSlot: currentSlot,
        endSlot: currentSlot,
      });

      // Subscribe to bonding curve changes
      try {
        const subId = this.connection.onAccountChange(
          config.bondingCurve,
          async (accountInfo, context) => {
            await this.handleBondingCurveChange(mintKey, context.slot);
          },
          'confirmed'
        );

        this.subscriptionIds.set(mintKey, subId);
        console.log(`📡 Subscribed to ${config.symbol} (${config.bondingCurve.toBase58().slice(0, 8)}...)`);
      } catch (error) {
        console.error(`❌ Failed to subscribe to ${config.symbol}:`, error);
      }
    }

    // Start periodic flush (normal interval)
    this.flushTimer = setInterval(() => this.flushAllPendingFees(), this.flushInterval);

    // Start adaptive flush check (checks every 5s if any token is approaching slot limit)
    this.adaptiveCheckTimer = setInterval(() => this.checkAdaptiveFlush(), ADAPTIVE_CHECK_INTERVAL);

    console.log('\n✅ Validator Daemon started successfully');
    console.log(`🔄 Adaptive flush enabled (threshold: ${ADAPTIVE_FLUSH_THRESHOLD} slots)\n`);
  }

  /**
   * Handle bonding curve state change (indicates a trade)
   */
  private async handleBondingCurveChange(mintKey: string, slot: number): Promise<void> {
    const config = this.tokens.get(mintKey);
    const pending = this.pendingValidations.get(mintKey);

    if (!config || !pending) return;

    try {
      // Get recent signatures for this bonding curve
      const signatures = await this.connection.getSignaturesForAddress(
        config.bondingCurve,
        { limit: 10 },
        'confirmed'
      );

      // Process new signatures
      for (const sigInfo of signatures) {
        if (pending.txSignatures.includes(sigInfo.signature)) continue;
        if (sigInfo.err) continue; // Skip failed transactions

        // Skip transactions older than our start slot to avoid slot range issues
        const txSlot = sigInfo.slot || slot;
        if (txSlot < pending.startSlot) {
          continue; // Skip old transactions
        }

        const fee = await this.extractFeeFromTransaction(
          sigInfo.signature,
          config
        );

        if (fee > 0) {
          pending.feeAmount += BigInt(fee);
          pending.txSignatures.push(sigInfo.signature);
          pending.endSlot = Math.max(pending.endSlot, txSlot);

          if (this.verbose) {
            console.log(`💰 ${config.symbol}: +${(fee / 1e9).toFixed(6)} SOL (TX: ${sigInfo.signature.slice(0, 8)}...)`);
          }
        }
      }
    } catch (error) {
      if (this.verbose) {
        console.error(`Error processing ${config.symbol}:`, error);
      }
    }
  }

  /**
   * Extract exact fee from transaction logs
   * This is the KEY method - parses PumpFun logs for creator vault transfers
   */
  private async extractFeeFromTransaction(
    signature: string,
    config: TokenConfig
  ): Promise<number> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx?.meta?.logMessages) return 0;

      // Derive creator vault PDA
      const [creatorVault] = PublicKey.findProgramAddressSync(
        [Buffer.from('creator-vault'), config.creator.toBuffer()],
        PUMP_PROGRAM
      );

      const creatorVaultStr = creatorVault.toBase58();

      // Parse logs for transfer to creator vault
      // Multiple patterns to catch different log formats
      for (const log of tx.meta.logMessages) {
        // Pattern 1: "Transfer: X lamports... creator-vault"
        if (log.includes('creator-vault') || log.includes(creatorVaultStr)) {
          const match = log.match(/(\d+)\s+lamports/);
          if (match) {
            return parseInt(match[1], 10);
          }
        }

        // Pattern 2: Check for lamport transfer to the vault address
        if (log.includes(creatorVaultStr)) {
          const lamportMatch = log.match(/(\d{6,})/); // At least 6 digits (microlamports)
          if (lamportMatch) {
            const amount = parseInt(lamportMatch[1], 10);
            // Sanity check: creator fees are typically 0.001-0.1 SOL per trade
            if (amount >= 1000 && amount <= 100_000_000) {
              return amount;
            }
          }
        }
      }

      // Alternative: Check pre/post balances for the creator vault
      if (tx.meta.preBalances && tx.meta.postBalances && tx.transaction.message) {
        const accountKeys = tx.transaction.message.getAccountKeys();
        const vaultIndex = accountKeys.staticAccountKeys.findIndex(
          key => key.equals(creatorVault)
        );

        if (vaultIndex !== -1) {
          const preBalance = tx.meta.preBalances[vaultIndex];
          const postBalance = tx.meta.postBalances[vaultIndex];
          const delta = postBalance - preBalance;

          if (delta > 0) {
            return delta;
          }
        }
      }

      return 0;
    } catch (error) {
      if (this.verbose) {
        console.error(`Error extracting fee from ${signature}:`, error);
      }
      return 0;
    }
  }

  /**
   * Read the on-chain validator state to get last_validated_slot
   */
  private async getOnChainValidatorState(mintKey: string): Promise<{ lastValidatedSlot: number } | null> {
    try {
      const [validatorState] = PublicKey.findProgramAddressSync(
        [VALIDATOR_STATE_SEED, new PublicKey(mintKey).toBuffer()],
        this.program.programId
      );

      const account = await this.connection.getAccountInfo(validatorState);
      if (!account) return null;

      // ValidatorState layout: discriminator(8) + mint(32) + bonding_curve(32) + last_validated_slot(8) + ...
      // last_validated_slot is at offset 72 (8 + 32 + 32)
      const lastValidatedSlot = account.data.readBigUInt64LE(72);
      return { lastValidatedSlot: Number(lastValidatedSlot) };
    } catch (error) {
      if (this.verbose) {
        console.error(`Error reading validator state for ${mintKey}:`, error);
      }
      return null;
    }
  }

  /**
   * Check if any token is approaching the slot limit and needs early flush
   * This prevents SlotRangeTooLarge errors by proactively flushing
   */
  private async checkAdaptiveFlush(): Promise<void> {
    for (const [mintKey, pending] of this.pendingValidations) {
      // Skip if no pending fees
      if (pending.txSignatures.length === 0) continue;

      const config = this.tokens.get(mintKey);
      if (!config) continue;

      try {
        // Read on-chain validator state
        const onChainState = await this.getOnChainValidatorState(mintKey);
        if (!onChainState) continue;

        const slotDelta = pending.endSlot - onChainState.lastValidatedSlot;

        // If approaching the limit, trigger early flush
        if (slotDelta >= ADAPTIVE_FLUSH_THRESHOLD) {
          console.log(`\n⚡ Adaptive flush triggered for ${config.symbol} (slot delta: ${slotDelta} >= ${ADAPTIVE_FLUSH_THRESHOLD})`);
          await this.flushSingleToken(mintKey, pending, config);
        } else if (this.verbose && slotDelta > 500) {
          // Log warning when getting close to threshold
          console.log(`📊 ${config.symbol}: slot delta ${slotDelta}/${ADAPTIVE_FLUSH_THRESHOLD}`);
        }
      } catch (error) {
        if (this.verbose) {
          console.error(`Error in adaptive flush check for ${config.symbol}:`, error);
        }
      }
    }
  }

  /**
   * Flush a single token's pending fees
   */
  private async flushSingleToken(mintKey: string, pending: PendingValidation, config: TokenConfig): Promise<void> {
    try {
      const [validatorState] = PublicKey.findProgramAddressSync(
        [VALIDATOR_STATE_SEED, new PublicKey(mintKey).toBuffer()],
        this.program.programId
      );

      const [tokenStats] = PublicKey.findProgramAddressSync(
        [TOKEN_STATS_SEED, new PublicKey(mintKey).toBuffer()],
        this.program.programId
      );

      const feeAmountBN = new BN(pending.feeAmount.toString());

      const tx = await this.program.methods
        .registerValidatedFees(
          feeAmountBN,
          new BN(pending.endSlot),
          pending.txSignatures.length
        )
        .accounts({
          validatorState,
          tokenStats,
        })
        .rpc();

      console.log(`✅ ${config.symbol}: ${Number(pending.feeAmount) / 1e9} SOL (${pending.txSignatures.length} TXs)`);
      console.log(`   TX: ${tx}`);

      // Reset pending with new start slot
      pending.feeAmount = 0n;
      pending.txSignatures = [];
      pending.startSlot = pending.endSlot;

    } catch (error: any) {
      console.error(`❌ Failed to flush ${config.symbol}:`, error.message || error);

      // Handle errors by resetting state
      if (error.message?.includes('StaleValidation') ||
          error.message?.includes('SlotRangeTooLarge') ||
          error.message?.includes('6019') ||
          error.message?.includes('6018')) {
        await this.resetPendingState(mintKey, 'Validation error');
      }
    }
  }

  /**
   * Reset pending state with fresh slots from current slot
   */
  private async resetPendingState(mintKey: string, reason: string): Promise<void> {
    const currentSlot = await this.connection.getSlot();
    const newPending = this.pendingValidations.get(mintKey);
    if (newPending) {
      const config = this.tokens.get(mintKey);
      console.log(`   ↳ ${reason} - Resetting ${config?.symbol || mintKey} from slot ${currentSlot}`);
      newPending.feeAmount = 0n;
      newPending.txSignatures = [];
      newPending.startSlot = currentSlot;
      newPending.endSlot = currentSlot;
    }
  }

  /**
   * Flush pending fees to on-chain (PERMISSIONLESS call)
   */
  private async flushAllPendingFees(): Promise<void> {
    const tokensToFlush: Array<{ mintKey: string; pending: PendingValidation; config: TokenConfig }> = [];

    // Get current slot for reference
    const currentSlot = await this.connection.getSlot();

    // Collect tokens that need flushing
    for (const [mintKey, pending] of this.pendingValidations) {
      if (pending.feeAmount > 0n) {
        const config = this.tokens.get(mintKey);
        if (config) {
          // Pre-check: Read on-chain validator state to verify slot range
          const onChainState = await this.getOnChainValidatorState(mintKey);

          if (onChainState) {
            const slotDelta = pending.endSlot - onChainState.lastValidatedSlot;

            // If slot range would be too large, reset and skip this flush
            if (slotDelta > MAX_SLOT_RANGE) {
              console.log(`⚠️  ${config.symbol}: Slot range too large (${slotDelta} > ${MAX_SLOT_RANGE})`);
              await this.resetPendingState(mintKey, 'Slot range exceeded');
              continue;
            }

            // If our endSlot is behind the on-chain state, reset (stale data)
            if (pending.endSlot <= onChainState.lastValidatedSlot) {
              console.log(`⚠️  ${config.symbol}: Stale data (endSlot ${pending.endSlot} <= onChain ${onChainState.lastValidatedSlot})`);
              await this.resetPendingState(mintKey, 'Stale validation data');
              continue;
            }
          }

          tokensToFlush.push({ mintKey, pending, config });
        }
      }
    }

    if (tokensToFlush.length === 0) {
      if (this.verbose) {
        console.log('📭 No pending fees to flush');
      }
      return;
    }

    console.log(`\n📤 Flushing ${tokensToFlush.length} token(s)...`);

    for (const { mintKey, pending, config } of tokensToFlush) {
      try {
        const [validatorState] = PublicKey.findProgramAddressSync(
          [VALIDATOR_STATE_SEED, new PublicKey(mintKey).toBuffer()],
          this.program.programId
        );

        const [tokenStats] = PublicKey.findProgramAddressSync(
          [TOKEN_STATS_SEED, new PublicKey(mintKey).toBuffer()],
          this.program.programId
        );

        // Convert BigInt to BN for Anchor
        const feeAmountBN = new BN(pending.feeAmount.toString());

        // PERMISSIONLESS - no admin signer needed!
        const tx = await this.program.methods
          .registerValidatedFees(
            feeAmountBN,
            new BN(pending.endSlot),
            pending.txSignatures.length
          )
          .accounts({
            validatorState,
            tokenStats,
          })
          .rpc();

        console.log(`✅ ${config.symbol}: ${Number(pending.feeAmount) / 1e9} SOL (${pending.txSignatures.length} TXs)`);
        console.log(`   TX: ${tx}`);

        // Reset pending with new start slot
        const newPending = this.pendingValidations.get(mintKey);
        if (newPending) {
          newPending.feeAmount = 0n;
          newPending.txSignatures = [];
          newPending.startSlot = pending.endSlot;
          newPending.endSlot = pending.endSlot;
        }

      } catch (error: any) {
        console.error(`❌ Failed to flush ${config.symbol}:`, error.message || error);

        // Handle specific errors by resetting state
        if (error.message?.includes('StaleValidation') ||
            error.message?.includes('SlotRangeTooLarge') ||
            error.message?.includes('6019') || // SlotRangeTooLarge error code
            error.message?.includes('6018')) { // StaleValidation error code
          await this.resetPendingState(mintKey, 'Validation error');
        }
      }
    }

    console.log('');
  }

  /**
   * Get current pending fees for a token
   */
  getPendingFees(mintKey: string): { amount: bigint; txCount: number } | null {
    const pending = this.pendingValidations.get(mintKey);
    if (!pending) return null;
    return {
      amount: pending.feeAmount,
      txCount: pending.txSignatures.length,
    };
  }

  /**
   * Get all pending fees
   */
  getAllPendingFees(): Map<string, { symbol: string; amount: bigint; txCount: number }> {
    const result = new Map();
    for (const [mintKey, pending] of this.pendingValidations) {
      const config = this.tokens.get(mintKey);
      if (config) {
        result.set(mintKey, {
          symbol: config.symbol,
          amount: pending.feeAmount,
          txCount: pending.txSignatures.length,
        });
      }
    }
    return result;
  }

  /**
   * Force flush all pending fees immediately
   */
  async forceFlush(): Promise<void> {
    await this.flushAllPendingFees();
  }

  /**
   * Stop the daemon
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log('\n🛑 Stopping Validator Daemon...');

    // Clear flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Clear adaptive check timer
    if (this.adaptiveCheckTimer) {
      clearInterval(this.adaptiveCheckTimer);
      this.adaptiveCheckTimer = null;
    }

    // Unsubscribe from all accounts
    for (const [mintKey, subId] of this.subscriptionIds) {
      try {
        await this.connection.removeAccountChangeListener(subId);
        const config = this.tokens.get(mintKey);
        if (this.verbose && config) {
          console.log(`📴 Unsubscribed from ${config.symbol}`);
        }
      } catch (error) {
        // Ignore unsubscribe errors
      }
    }

    this.subscriptionIds.clear();
    this.running = false;

    console.log('✅ Validator Daemon stopped');
  }

  /**
   * Check if daemon is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Helper to create a ValidatorDaemon from token config files
 */
export async function createValidatorDaemon(
  connection: Connection,
  program: Program,
  tokenFiles: string[],
  options?: { flushInterval?: number; verbose?: boolean }
): Promise<ValidatorDaemon> {
  const fs = await import('fs');

  const tokens: TokenConfig[] = [];

  for (const file of tokenFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      tokens.push({
        mint: new PublicKey(data.mint),
        bondingCurve: new PublicKey(data.bondingCurve),
        creator: new PublicKey(data.creator),
        symbol: data.symbol || data.name || 'UNKNOWN',
      });
    } catch (error) {
      console.error(`Failed to load token config from ${file}:`, error);
    }
  }

  return new ValidatorDaemon({
    connection,
    program,
    tokens,
    flushInterval: options?.flushInterval,
    verbose: options?.verbose,
  });
}
