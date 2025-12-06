/**
 * ASDF Validator Daemon
 *
 * Standalone daemon to track fees for tokens sharing a creator vault.
 * Anyone can run this to monitor their own creator address.
 *
 * @example
 * ```typescript
 * import { ValidatorDaemon } from '@asdf/validator-sdk';
 *
 * const daemon = new ValidatorDaemon({
 *   rpcUrl: 'https://api.mainnet-beta.solana.com',
 *   creatorAddress: 'YOUR_CREATOR_WALLET',
 *   onFeeDetected: (mint, amount) => {
 *     console.log(`${mint}: +${amount / 1e9} SOL`);
 *   }
 * });
 *
 * await daemon.start();
 * ```
 */

import { Connection, PublicKey } from '@solana/web3.js';

// ============================================================================
// Constants
// ============================================================================

/** PumpFun Program ID */
export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

/** PumpSwap AMM Program ID */
export const PUMPSWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

/** WSOL Mint */
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ============================================================================
// Types
// ============================================================================

export type PoolType = 'bonding_curve' | 'pumpswap_amm';

export interface TokenConfig {
  mint: string;
  symbol: string;
  bondingCurve: string;
  poolType: PoolType;
}

export interface FeeRecord {
  mint: string;
  symbol: string;
  amount: bigint;
  timestamp: number;
  slot: number;
}

export interface TokenStats {
  mint: string;
  symbol: string;
  totalFees: bigint;
  feeCount: number;
  lastFeeTimestamp: number;
}

export interface DaemonConfig {
  /** Solana RPC URL */
  rpcUrl: string;

  /** Creator wallet address (owner of the vault) */
  creatorAddress: string;

  /** Tokens to track (optional - auto-detect if not provided) */
  tokens?: TokenConfig[];

  /** Poll interval in milliseconds (default: 5000) */
  pollInterval?: number;

  /** Callback when fees detected */
  onFeeDetected?: (record: FeeRecord) => void;

  /** Callback for periodic stats */
  onStats?: (stats: TokenStats[]) => void;

  /** Stats interval in milliseconds (default: 60000) */
  statsInterval?: number;

  /** Enable verbose logging */
  verbose?: boolean;
}

// ============================================================================
// Vault Address Derivation
// ============================================================================

/**
 * Derive creator vault address for PumpFun bonding curve
 * Seeds: ["creator-vault", creator] (with hyphen)
 */
export function deriveBondingCurveVault(creator: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return vault;
}

/**
 * Derive creator vault address for PumpSwap AMM
 * Seeds: ["creator_vault", creator] (with underscore)
 */
export function derivePumpSwapVault(creator: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), creator.toBuffer()],
    PUMPSWAP_PROGRAM_ID
  );
  return vault;
}

// ============================================================================
// Validator Daemon
// ============================================================================

/**
 * Standalone validator daemon for tracking creator fees
 */
export class ValidatorDaemon {
  private connection: Connection;
  private creator: PublicKey;
  private tokens: Map<string, TokenConfig>;
  private tokenStats: Map<string, TokenStats>;

  private bcVault: PublicKey;
  private ammVault: PublicKey;
  private lastBcBalance: bigint = 0n;
  private lastAmmBalance: bigint = 0n;

  private pollInterval: number;
  private statsInterval: number;
  private verbose: boolean;

  private onFeeDetected?: (record: FeeRecord) => void;
  private onStats?: (stats: TokenStats[]) => void;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: DaemonConfig) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.creator = new PublicKey(config.creatorAddress);
    this.tokens = new Map();
    this.tokenStats = new Map();

    // Derive vault addresses
    this.bcVault = deriveBondingCurveVault(this.creator);
    this.ammVault = derivePumpSwapVault(this.creator);

    // Load tokens if provided
    if (config.tokens) {
      for (const token of config.tokens) {
        this.tokens.set(token.mint, token);
        this.tokenStats.set(token.mint, {
          mint: token.mint,
          symbol: token.symbol,
          totalFees: 0n,
          feeCount: 0,
          lastFeeTimestamp: 0,
        });
      }
    }

    this.pollInterval = config.pollInterval || 5000;
    this.statsInterval = config.statsInterval || 60000;
    this.verbose = config.verbose || false;
    this.onFeeDetected = config.onFeeDetected;
    this.onStats = config.onStats;
  }

  /**
   * Add a token to track
   */
  addToken(config: TokenConfig): void {
    this.tokens.set(config.mint, config);
    if (!this.tokenStats.has(config.mint)) {
      this.tokenStats.set(config.mint, {
        mint: config.mint,
        symbol: config.symbol,
        totalFees: 0n,
        feeCount: 0,
        lastFeeTimestamp: 0,
      });
    }
  }

  /**
   * Get current stats for all tokens
   */
  getStats(): TokenStats[] {
    return Array.from(this.tokenStats.values());
  }

  /**
   * Get total fees across all tokens
   */
  getTotalFees(): bigint {
    let total = 0n;
    for (const stats of this.tokenStats.values()) {
      total += stats.totalFees;
    }
    return total;
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    if (this.running) {
      this.log('Daemon already running');
      return;
    }

    this.running = true;
    this.log('Starting validator daemon...');
    this.log(`Creator: ${this.creator.toBase58()}`);
    this.log(`BC Vault: ${this.bcVault.toBase58()}`);
    this.log(`AMM Vault: ${this.ammVault.toBase58()}`);
    this.log(`Tokens: ${this.tokens.size}`);
    this.log(`Poll interval: ${this.pollInterval}ms`);

    // Get initial balances
    await this.initializeBalances();

    // Start polling
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);

    // Start stats reporting
    if (this.onStats) {
      this.statsTimer = setInterval(() => {
        this.onStats!(this.getStats());
      }, this.statsInterval);
    }

    this.log('Daemon started');
  }

  /**
   * Stop the daemon
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    this.log('Daemon stopped');
  }

  /**
   * Check if daemon is running
   */
  isRunning(): boolean {
    return this.running;
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  private async initializeBalances(): Promise<void> {
    try {
      // Get bonding curve vault balance (native SOL)
      this.lastBcBalance = BigInt(await this.connection.getBalance(this.bcVault));
      this.log(`BC vault initial: ${Number(this.lastBcBalance) / 1e9} SOL`);
    } catch {
      this.lastBcBalance = 0n;
    }

    try {
      // Get AMM vault balance (WSOL token account)
      const ammAccount = await this.connection.getTokenAccountBalance(this.ammVault);
      this.lastAmmBalance = BigInt(ammAccount.value.amount);
      this.log(`AMM vault initial: ${Number(this.lastAmmBalance) / 1e9} WSOL`);
    } catch {
      this.lastAmmBalance = 0n;
    }
  }

  private async poll(): Promise<void> {
    const slot = await this.connection.getSlot();
    const timestamp = Date.now();

    // Poll bonding curve vault
    await this.pollVault('bonding_curve', this.bcVault, slot, timestamp);

    // Poll AMM vault
    await this.pollVault('pumpswap_amm', this.ammVault, slot, timestamp);
  }

  private async pollVault(
    poolType: PoolType,
    vault: PublicKey,
    slot: number,
    timestamp: number
  ): Promise<void> {
    try {
      let currentBalance: bigint;
      let lastBalance: bigint;

      if (poolType === 'bonding_curve') {
        currentBalance = BigInt(await this.connection.getBalance(vault));
        lastBalance = this.lastBcBalance;
      } else {
        try {
          const account = await this.connection.getTokenAccountBalance(vault);
          currentBalance = BigInt(account.value.amount);
        } catch {
          currentBalance = 0n;
        }
        lastBalance = this.lastAmmBalance;
      }

      const delta = currentBalance - lastBalance;

      if (delta > 0n) {
        // Fees detected!
        this.handleFeeDetected(poolType, delta, slot, timestamp);
      }

      // Update last known balance
      if (poolType === 'bonding_curve') {
        this.lastBcBalance = currentBalance;
      } else {
        this.lastAmmBalance = currentBalance;
      }
    } catch (error) {
      if (this.verbose) {
        console.error(`Poll error (${poolType}):`, error);
      }
    }
  }

  private handleFeeDetected(
    poolType: PoolType,
    amount: bigint,
    slot: number,
    timestamp: number
  ): void {
    // Find matching token(s) for this pool type
    const matchingTokens = Array.from(this.tokens.values())
      .filter(t => t.poolType === poolType);

    if (matchingTokens.length === 0) {
      // No specific token configured, attribute to "unknown"
      const record: FeeRecord = {
        mint: 'unknown',
        symbol: poolType === 'bonding_curve' ? 'BC' : 'AMM',
        amount,
        timestamp,
        slot,
      };

      this.log(`Fee detected: +${Number(amount) / 1e9} SOL (${poolType})`);

      if (this.onFeeDetected) {
        this.onFeeDetected(record);
      }
      return;
    }

    if (matchingTokens.length === 1) {
      // Single token - attribute all fees to it
      const token = matchingTokens[0];
      this.attributeFee(token, amount, slot, timestamp);
    } else {
      // Multiple tokens - split equally (or implement custom logic)
      // For now, attribute to first token and log warning
      this.log(`Warning: ${matchingTokens.length} tokens share ${poolType} vault`);
      const token = matchingTokens[0];
      this.attributeFee(token, amount, slot, timestamp);
    }
  }

  private attributeFee(
    token: TokenConfig,
    amount: bigint,
    slot: number,
    timestamp: number
  ): void {
    // Update stats
    const stats = this.tokenStats.get(token.mint);
    if (stats) {
      stats.totalFees += amount;
      stats.feeCount++;
      stats.lastFeeTimestamp = timestamp;
    }

    // Create record
    const record: FeeRecord = {
      mint: token.mint,
      symbol: token.symbol,
      amount,
      timestamp,
      slot,
    };

    this.log(`${token.symbol}: +${Number(amount) / 1e9} SOL`);

    // Callback
    if (this.onFeeDetected) {
      this.onFeeDetected(record);
    }
  }

  private log(message: string): void {
    if (this.verbose) {
      const time = new Date().toISOString().slice(11, 19);
      console.log(`[${time}] ${message}`);
    }
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

/**
 * Run daemon from command line
 */
export async function runDaemonCLI(args: string[]): Promise<void> {
  // Parse args
  const creatorIdx = args.findIndex(a => a === '--creator' || a === '-c');
  const rpcIdx = args.findIndex(a => a === '--rpc' || a === '-r');
  const verboseFlag = args.includes('--verbose') || args.includes('-v');

  if (creatorIdx === -1 || !args[creatorIdx + 1]) {
    console.log(`
ASDF Validator Daemon

Usage:
  npx @asdf/validator-sdk daemon --creator <ADDRESS> [options]

Options:
  --creator, -c <ADDRESS>  Creator wallet address (required)
  --rpc, -r <URL>          RPC URL (default: mainnet)
  --verbose, -v            Enable verbose logging
  --help, -h               Show help

Example:
  npx @asdf/validator-sdk daemon -c 5ABC...xyz -v
`);
    process.exit(1);
  }

  const creatorAddress = args[creatorIdx + 1];
  const rpcUrl = rpcIdx !== -1 && args[rpcIdx + 1]
    ? args[rpcIdx + 1]
    : 'https://api.mainnet-beta.solana.com';

  console.log('\n🔥 ASDF VALIDATOR DAEMON');
  console.log('='.repeat(50));
  console.log(`Creator: ${creatorAddress}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log('='.repeat(50) + '\n');

  const daemon = new ValidatorDaemon({
    rpcUrl,
    creatorAddress,
    verbose: verboseFlag,
    onFeeDetected: (record) => {
      console.log(`💰 ${record.symbol}: +${Number(record.amount) / 1e9} SOL`);
    },
    onStats: (stats) => {
      const total = stats.reduce((sum, s) => sum + Number(s.totalFees), 0);
      console.log(`\n📊 Total fees: ${total / 1e9} SOL`);
      for (const s of stats) {
        if (s.totalFees > 0n) {
          console.log(`   ${s.symbol}: ${Number(s.totalFees) / 1e9} SOL`);
        }
      }
      console.log('');
    },
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    daemon.stop();
    const total = daemon.getTotalFees();
    console.log(`Total fees tracked: ${Number(total) / 1e9} SOL`);
    process.exit(0);
  });

  await daemon.start();
  console.log('Press Ctrl+C to stop\n');
}

export default ValidatorDaemon;
