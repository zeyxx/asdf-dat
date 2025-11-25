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

    // Start periodic flush
    this.flushTimer = setInterval(() => this.flushAllPendingFees(), this.flushInterval);
    console.log('\n✅ Validator Daemon started successfully\n');
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

        const fee = await this.extractFeeFromTransaction(
          sigInfo.signature,
          config
        );

        if (fee > 0) {
          pending.feeAmount += BigInt(fee);
          pending.txSignatures.push(sigInfo.signature);
          pending.endSlot = Math.max(pending.endSlot, slot);

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
   * Flush pending fees to on-chain (PERMISSIONLESS call)
   */
  private async flushAllPendingFees(): Promise<void> {
    const tokensToFlush: Array<{ mintKey: string; pending: PendingValidation; config: TokenConfig }> = [];

    // Collect tokens that need flushing
    for (const [mintKey, pending] of this.pendingValidations) {
      if (pending.feeAmount > 0n) {
        const config = this.tokens.get(mintKey);
        if (config) {
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

        // Reset pending
        const newPending = this.pendingValidations.get(mintKey);
        if (newPending) {
          newPending.feeAmount = 0n;
          newPending.txSignatures = [];
          newPending.startSlot = pending.endSlot;
        }

      } catch (error: any) {
        console.error(`❌ Failed to flush ${config.symbol}:`, error.message || error);

        // Check if it's a stale validation error (slot already processed)
        if (error.message?.includes('StaleValidation')) {
          console.log(`   ↳ Slot already validated, resetting...`);
          const newPending = this.pendingValidations.get(mintKey);
          if (newPending) {
            newPending.feeAmount = 0n;
            newPending.txSignatures = [];
          }
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
