/**
 * Validator Daemon v2 - Unified Balance Polling
 *
 * This daemon monitors creator vault balances for both PumpFun Bonding Curve
 * and PumpSwap AMM tokens. It uses balance polling instead of subscription
 * for a unified, more robust approach.
 *
 * Architecture:
 * 1. Poll vault balances every 5 seconds (SOL for BC, WSOL for AMM)
 * 2. Detect balance increases (delta > 0 = fees accumulated)
 * 3. Accumulate fees per token in memory
 * 4. Batch commit to on-chain every 30 seconds via register_validated_fees
 *
 * This approach works for BOTH pool types with the same logic.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  PoolType,
  getCreatorVaultAddress,
  isAmmToken,
} from './amm-utils';

const VALIDATOR_STATE_SEED = Buffer.from('validator_v1');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

// Max slot range allowed by on-chain program (lib.rs:554)
const MAX_SLOT_RANGE = 1000;

// Adaptive flush threshold: trigger early flush when approaching max slot range
const ADAPTIVE_FLUSH_THRESHOLD = 800;

// Balance polling interval (milliseconds)
const POLL_INTERVAL = 5000; // 5 seconds

// Adaptive flush check interval (milliseconds)
const ADAPTIVE_CHECK_INTERVAL = 5000; // 5 seconds

export interface TokenConfig {
  mint: PublicKey;
  creator: PublicKey;
  symbol: string;
  poolType: PoolType;
  bondingCurve?: PublicKey;  // Required for bonding_curve type
  pool?: PublicKey;          // Required for pumpswap_amm type
}

interface PendingValidation {
  feeAmount: bigint;
  txCount: number;
  startSlot: number;
  endSlot: number;
}

interface VaultState {
  address: PublicKey;
  lastKnownBalance: bigint;
  poolType: PoolType;
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
  private vaultStates: Map<string, VaultState>;
  private flushInterval: number;
  private verbose: boolean;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private adaptiveCheckTimer: ReturnType<typeof setInterval> | null = null;
  private running: boolean = false;

  constructor(config: ValidatorDaemonConfig) {
    this.connection = config.connection;
    this.program = config.program;
    this.tokens = new Map(config.tokens.map(t => [t.mint.toBase58(), t]));
    this.pendingValidations = new Map();
    this.vaultStates = new Map();
    this.flushInterval = config.flushInterval || 30000;
    this.verbose = config.verbose || false;
  }

  /**
   * Start monitoring all tokens for fees via balance polling
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('Validator daemon already running');
      return;
    }

    this.running = true;
    console.log('🚀 Starting Validator Daemon v2 (Balance Polling)...');
    console.log(`📊 Monitoring ${this.tokens.size} tokens`);
    console.log(`⏱️  Poll interval: ${POLL_INTERVAL / 1000}s`);
    console.log(`⏱️  Flush interval: ${this.flushInterval / 1000}s`);

    const currentSlot = await this.connection.getSlot();

    // Initialize vault states and pending validations for each token
    for (const [mintKey, config] of this.tokens) {
      try {
        const vaultAddress = getCreatorVaultAddress(config.creator, config.poolType);
        const initialBalance = await this.getVaultBalance(config.poolType, vaultAddress);

        // Store vault state
        this.vaultStates.set(mintKey, {
          address: vaultAddress,
          lastKnownBalance: BigInt(initialBalance),
          poolType: config.poolType,
        });

        // Initialize pending validation
        this.pendingValidations.set(mintKey, {
          feeAmount: 0n,
          txCount: 0,
          startSlot: currentSlot,
          endSlot: currentSlot,
        });

        const vaultType = isAmmToken(config.poolType) ? 'WSOL' : 'SOL';
        const balanceDisplay = (Number(initialBalance) / 1e9).toFixed(6);
        console.log(`📡 ${config.symbol} (${config.poolType}): vault=${vaultAddress.toBase58().slice(0, 8)}... balance=${balanceDisplay} ${vaultType}`);

      } catch (error) {
        console.error(`❌ Failed to initialize ${config.symbol}:`, error);
      }
    }

    // Start balance polling
    this.pollTimer = setInterval(() => this.pollAllVaults(), POLL_INTERVAL);

    // Start periodic flush
    this.flushTimer = setInterval(() => this.flushAllPendingFees(), this.flushInterval);

    // Start adaptive flush check
    this.adaptiveCheckTimer = setInterval(() => this.checkAdaptiveFlush(), ADAPTIVE_CHECK_INTERVAL);

    console.log('\n✅ Validator Daemon v2 started successfully');
    console.log(`🔄 Adaptive flush enabled (threshold: ${ADAPTIVE_FLUSH_THRESHOLD} slots)\n`);
  }

  /**
   * Get vault balance based on pool type
   * - For bonding_curve: native SOL balance
   * - For pumpswap_amm: WSOL token balance
   */
  private async getVaultBalance(poolType: PoolType, vaultAddress: PublicKey): Promise<number> {
    if (poolType === 'bonding_curve') {
      return await this.connection.getBalance(vaultAddress);
    } else {
      try {
        const account = await this.connection.getTokenAccountBalance(vaultAddress);
        return parseInt(account.value.amount);
      } catch (error) {
        // Token account may not exist yet (no fees accumulated)
        if (this.verbose) {
          console.log(`Note: WSOL vault ${vaultAddress.toBase58().slice(0, 8)}... not yet created`);
        }
        return 0;
      }
    }
  }

  /**
   * Poll all vault balances and detect fee increases
   */
  private async pollAllVaults(): Promise<void> {
    let slot: number;
    try {
      slot = await this.connection.getSlot();
    } catch (error) {
      if (this.verbose) console.warn('Failed to get current slot:', error);
      return;
    }

    for (const [mintKey, vaultState] of this.vaultStates) {
      const config = this.tokens.get(mintKey);
      const pending = this.pendingValidations.get(mintKey);

      if (!config || !pending) continue;

      try {
        const currentBalance = BigInt(await this.getVaultBalance(vaultState.poolType, vaultState.address));
        const delta = currentBalance - vaultState.lastKnownBalance;

        if (delta > 0n) {
          // Fees detected!
          pending.feeAmount += delta;
          pending.txCount += 1; // We count balance increases, not individual TXs
          pending.endSlot = slot;

          // Update last known balance
          vaultState.lastKnownBalance = currentBalance;

          if (this.verbose) {
            const vaultType = isAmmToken(vaultState.poolType) ? 'WSOL' : 'SOL';
            console.log(`💰 ${config.symbol}: +${(Number(delta) / 1e9).toFixed(6)} ${vaultType}`);
          }
        }
      } catch (error) {
        if (this.verbose) {
          console.warn(`Poll error for ${config.symbol}:`, error);
        }
      }
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
   */
  private async checkAdaptiveFlush(): Promise<void> {
    for (const [mintKey, pending] of this.pendingValidations) {
      // Skip if no pending fees
      if (pending.feeAmount === 0n) continue;

      const config = this.tokens.get(mintKey);
      if (!config) continue;

      try {
        const onChainState = await this.getOnChainValidatorState(mintKey);
        if (!onChainState) continue;

        const slotDelta = pending.endSlot - onChainState.lastValidatedSlot;

        if (slotDelta >= ADAPTIVE_FLUSH_THRESHOLD) {
          console.log(`\n⚡ Adaptive flush triggered for ${config.symbol} (slot delta: ${slotDelta} >= ${ADAPTIVE_FLUSH_THRESHOLD})`);
          await this.flushSingleToken(mintKey, pending, config);
        } else if (this.verbose && slotDelta > 500) {
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
          pending.txCount
        )
        .accounts({
          validatorState,
          tokenStats,
        })
        .rpc();

      const vaultType = isAmmToken(config.poolType) ? 'WSOL' : 'SOL';
      console.log(`✅ ${config.symbol}: ${Number(pending.feeAmount) / 1e9} ${vaultType} (${pending.txCount} changes)`);
      console.log(`   TX: ${tx}`);

      // Reset pending with new start slot
      pending.feeAmount = 0n;
      pending.txCount = 0;
      pending.startSlot = pending.endSlot;

    } catch (error: any) {
      console.error(`❌ Failed to flush ${config.symbol}:`, error.message || error);

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
    const pending = this.pendingValidations.get(mintKey);
    if (pending) {
      const config = this.tokens.get(mintKey);
      console.log(`   ↳ ${reason} - Resetting ${config?.symbol || mintKey} from slot ${currentSlot}`);
      pending.feeAmount = 0n;
      pending.txCount = 0;
      pending.startSlot = currentSlot;
      pending.endSlot = currentSlot;
    }
  }

  /**
   * Flush pending fees to on-chain (PERMISSIONLESS call)
   */
  private async flushAllPendingFees(): Promise<void> {
    const tokensToFlush: Array<{ mintKey: string; pending: PendingValidation; config: TokenConfig }> = [];

    // Collect tokens that need flushing
    for (const [mintKey, pending] of this.pendingValidations) {
      if (pending.feeAmount > 0n) {
        const config = this.tokens.get(mintKey);
        if (config) {
          const onChainState = await this.getOnChainValidatorState(mintKey);

          if (onChainState) {
            const slotDelta = pending.endSlot - onChainState.lastValidatedSlot;

            if (slotDelta > MAX_SLOT_RANGE) {
              console.log(`⚠️  ${config.symbol}: Slot range too large (${slotDelta} > ${MAX_SLOT_RANGE})`);
              await this.resetPendingState(mintKey, 'Slot range exceeded');
              continue;
            }

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
      await this.flushSingleToken(mintKey, pending, config);
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
      txCount: pending.txCount,
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
          txCount: pending.txCount,
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

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.adaptiveCheckTimer) {
      clearInterval(this.adaptiveCheckTimer);
      this.adaptiveCheckTimer = null;
    }

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

      // Determine pool type from config
      const poolType: PoolType = data.poolType || 'bonding_curve';

      tokens.push({
        mint: new PublicKey(data.mint),
        creator: new PublicKey(data.creator),
        symbol: data.symbol || data.name || 'UNKNOWN',
        poolType,
        bondingCurve: data.bondingCurve ? new PublicKey(data.bondingCurve) : undefined,
        pool: data.pool ? new PublicKey(data.pool) : undefined,
      });

      console.log(`✅ Loaded ${data.symbol} (${poolType}): ${data.mint}`);
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
