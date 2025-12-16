/**
 * RPC Utilities for Production Resilience
 *
 * Provides retry logic, timeouts, rate limit handling, and global rate limiting
 * for Solana RPC calls. Designed for mainnet conditions with Helius as primary provider.
 */

import { Connection, ConnectionConfig, Commitment, Transaction, Keypair, SendOptions } from '@solana/web3.js';

// ============================================================================
// Global Rate Limiter (Token Bucket)
// ============================================================================

/**
 * Token bucket rate limiter for RPC calls
 * Prevents overwhelming the RPC endpoint
 */
class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number = 100, refillRate: number = 50) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
  }

  /**
   * Try to acquire a token for an RPC call
   * @returns true if token acquired, false if rate limited
   */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Acquire a token, waiting if necessary
   * @param maxWaitMs - Maximum time to wait
   * @returns true if token acquired, false if timeout
   */
  async acquire(maxWaitMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      if (this.tryAcquire()) {
        return true;
      }
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Get current state for monitoring
   */
  getState(): { tokens: number; maxTokens: number; refillRate: number } {
    this.refill();
    return {
      tokens: Math.floor(this.tokens),
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
    };
  }
}

// Global rate limiter instance (100 tokens, refill 50/sec)
const globalRateLimiter = new TokenBucketRateLimiter(100, 50);

/**
 * Get the global rate limiter state for monitoring
 */
export function getRateLimiterState(): { tokens: number; maxTokens: number; refillRate: number } {
  return globalRateLimiter.getState();
}

/**
 * Acquire rate limit token before making RPC call
 * @param maxWaitMs - Max time to wait for a token
 * @throws Error if rate limit exceeded
 */
export async function acquireRateLimitToken(maxWaitMs: number = 5000): Promise<void> {
  const acquired = await globalRateLimiter.acquire(maxWaitMs);
  if (!acquired) {
    throw new RpcError('Rate limit exceeded: too many RPC requests', 429, true);
  }
}

// ============================================================================
// Configuration
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

export interface TimeoutConfig {
  defaultTimeoutMs: number;
  confirmationTimeoutMs: number;
}

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  defaultTimeoutMs: 30000,      // 30s for most RPC calls
  confirmationTimeoutMs: 90000, // 90s for TX confirmation on mainnet
};

// ============================================================================
// Error Types
// ============================================================================

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly isRateLimited: boolean = false,
    public readonly isTimeout: boolean = false,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(public readonly resetAtMs: number) {
    super(`Circuit breaker open. Resets at ${new Date(resetAtMs).toISOString()}`);
    this.name = 'CircuitBreakerOpenError';
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Execute a function with exponential backoff retry
 * @param fn - Async function to execute
 * @param config - Retry configuration
 * @param onRetry - Optional callback on each retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, backoffMultiplier } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (!isRetryableError(lastError)) {
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt > maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
      const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
      const delayMs = Math.min(exponentialDelay + jitter, maxDelayMs);

      // Notify caller
      if (onRetry) {
        onRetry(attempt, lastError, delayMs);
      }

      // Wait before retry
      await sleep(delayMs);
    }
  }

  throw new RpcError(
    `Failed after ${maxRetries} retries: ${lastError?.message}`,
    undefined,
    false,
    false,
    lastError ?? undefined
  );
}

/**
 * Determine if an error is retryable (transient RPC/network error)
 * Exported for use in orchestrator error handling
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Rate limit errors (429)
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
    return true;
  }

  // Network errors
  if (message.includes('econnreset') || message.includes('enotfound') || message.includes('etimedout') || message.includes('fetch failed')) {
    return true;
  }

  // Solana-specific retryable errors
  if (message.includes('blockhash not found') || message.includes('block height exceeded')) {
    return true;
  }

  // Server errors (5xx)
  if (message.includes('503') || message.includes('502') || message.includes('500')) {
    return true;
  }

  // Transaction simulation errors that might resolve
  if (message.includes('simulation failed') && message.includes('blockhash')) {
    return true;
  }

  return false;
}

// ============================================================================
// Timeout Logic
// ============================================================================

/**
 * Execute a function with a timeout
 * @param fn - Async function to execute
 * @param timeoutMs - Timeout in milliseconds
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_CONFIG.defaultTimeoutMs
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new RpcError(`Operation timed out after ${timeoutMs}ms`, undefined, false, true));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Execute with both retry and timeout
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  retryConfig: Partial<RetryConfig> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_CONFIG.defaultTimeoutMs,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
): Promise<T> {
  return withRetry(
    () => withTimeout(fn, timeoutMs),
    retryConfig,
    onRetry
  );
}

// ============================================================================
// Circuit Breaker
// ============================================================================

export interface CircuitBreakerConfig {
  failureThreshold: number;    // Number of failures before opening
  resetTimeoutMs: number;      // Time to wait before half-open
  halfOpenSuccessThreshold: number; // Successes needed to close
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000,       // 1 minute
  halfOpenSuccessThreshold: 2,
};

type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerMetrics {
  state: CircuitState;
  stateCode: number;            // 0=closed, 1=open, 2=half-open
  failureCount: number;
  successCount: number;
  totalTransitions: number;
  timeInOpenStateMs: number;    // Cumulative time spent in open state
  lastTransitionTimestamp?: number;
  lastFailureTimestamp?: number;
  openEvents: number;           // How many times circuit opened
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;

  // Metrics tracking
  private totalTransitions = 0;
  private timeInOpenStateMs = 0;
  private openStateStartTime = 0;
  private lastTransitionTimestamp = 0;
  private openEvents = 0;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.transitionTo('half-open');
        this.successCount = 0;
      } else {
        throw new CircuitBreakerOpenError(this.lastFailureTime + this.config.resetTimeoutMs);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.halfOpenSuccessThreshold) {
        this.transitionTo('closed');
        this.failureCount = 0;
        this.lastFailureTime = 0;
      }
    } else {
      this.failureCount = 0;
      this.lastFailureTime = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open' || this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const now = Date.now();

    // Track time spent in open state
    if (this.state === 'open' && this.openStateStartTime > 0) {
      this.timeInOpenStateMs += now - this.openStateStartTime;
      this.openStateStartTime = 0;
    }

    // Track opening events
    if (newState === 'open') {
      this.openStateStartTime = now;
      this.openEvents++;
    }

    this.state = newState;
    this.totalTransitions++;
    this.lastTransitionTimestamp = now;
  }

  getState(): CircuitState {
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    const stateCodeMap: Record<CircuitState, number> = {
      closed: 0,
      open: 1,
      'half-open': 2,
    };

    // Calculate current open time if still in open state
    let currentOpenTime = this.timeInOpenStateMs;
    if (this.state === 'open' && this.openStateStartTime > 0) {
      currentOpenTime += Date.now() - this.openStateStartTime;
    }

    return {
      state: this.state,
      stateCode: stateCodeMap[this.state],
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalTransitions: this.totalTransitions,
      timeInOpenStateMs: currentOpenTime,
      lastTransitionTimestamp: this.lastTransitionTimestamp || undefined,
      lastFailureTimestamp: this.lastFailureTime || undefined,
      openEvents: this.openEvents,
    };
  }

  reset(): void {
    this.transitionTo('closed');
    this.failureCount = 0;
    this.successCount = 0;
  }
}

// ============================================================================
// Helius Connection Wrapper
// ============================================================================

export interface HeliusConnectionConfig {
  primaryUrl: string;
  fallbackUrl?: string;
  retryConfig?: Partial<RetryConfig>;
  timeoutConfig?: Partial<TimeoutConfig>;
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
}

/**
 * Enhanced Connection wrapper with built-in resilience
 */
export class ResilientConnection {
  private primaryConnection: Connection;
  private fallbackConnection: Connection | null = null;
  private retryConfig: RetryConfig;
  private timeoutConfig: TimeoutConfig;
  private circuitBreaker: CircuitBreaker;
  private usingFallback = false;

  constructor(config: HeliusConnectionConfig) {
    const connectionConfig: ConnectionConfig = {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 90000,
    };

    this.primaryConnection = new Connection(config.primaryUrl, connectionConfig);
    if (config.fallbackUrl) {
      this.fallbackConnection = new Connection(config.fallbackUrl, connectionConfig);
    }

    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retryConfig };
    this.timeoutConfig = { ...DEFAULT_TIMEOUT_CONFIG, ...config.timeoutConfig };
    this.circuitBreaker = new CircuitBreaker(config.circuitBreakerConfig);
  }

  /**
   * Get the active connection (primary or fallback)
   */
  getConnection(): Connection {
    if (this.usingFallback && this.fallbackConnection) {
      return this.fallbackConnection;
    }
    return this.primaryConnection;
  }

  /**
   * Execute an RPC call with full resilience stack
   */
  async call<T>(
    fn: (connection: Connection) => Promise<T>,
    options: {
      timeoutMs?: number;
      retryConfig?: Partial<RetryConfig>;
      onRetry?: (attempt: number, error: Error, delayMs: number) => void;
    } = {}
  ): Promise<T> {
    const execute = async (): Promise<T> => {
      try {
        return await this.circuitBreaker.execute(() =>
          withRetryAndTimeout(
            () => fn(this.getConnection()),
            { ...this.retryConfig, ...options.retryConfig },
            options.timeoutMs ?? this.timeoutConfig.defaultTimeoutMs,
            options.onRetry
          )
        );
      } catch (error) {
        // Try fallback if primary fails and fallback is available
        if (!this.usingFallback && this.fallbackConnection && error instanceof CircuitBreakerOpenError) {
          this.usingFallback = true;
          console.log('[RPC] Switching to fallback connection');
          // Apply same retry logic to fallback connection
          return withRetryAndTimeout(
            () => fn(this.fallbackConnection!),
            { ...this.retryConfig, ...options.retryConfig },
            options.timeoutMs ?? this.timeoutConfig.defaultTimeoutMs,
            options.onRetry
          );
        }
        throw error;
      }
    };

    return execute();
  }

  /**
   * Switch back to primary connection
   */
  resetToPrimary(): void {
    this.usingFallback = false;
    this.circuitBreaker.reset();
  }

  /**
   * Get connection status
   */
  getStatus(): {
    usingFallback: boolean;
    circuitState: string;
  } {
    return {
      usingFallback: this.usingFallback,
      circuitState: this.circuitBreaker.getState(),
    };
  }

  /**
   * Get detailed circuit breaker metrics for monitoring
   */
  getCircuitBreakerMetrics(): CircuitBreakerMetrics {
    return this.circuitBreaker.getMetrics();
  }
}

// ============================================================================
// Transaction Confirmation with Retry
// ============================================================================

export interface ConfirmationOptions {
  commitment?: Commitment;
  maxRetries?: number;
  retryDelayMs?: number;
  onRetry?: (attempt: number) => void;
}

/**
 * Confirm a transaction with retry logic
 */
export async function confirmTransactionWithRetry(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
  options: ConfirmationOptions = {}
): Promise<void> {
  const {
    commitment = 'finalized',
    maxRetries = 30,
    retryDelayMs = 3000,
    onRetry,
  } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        commitment
      );

      if (result.value.err) {
        throw new RpcError(`Transaction failed: ${JSON.stringify(result.value.err)}`);
      }

      return; // Success
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if block height exceeded (tx expired)
      if (errorMessage.includes('block height exceeded')) {
        throw new RpcError('Transaction expired (block height exceeded)', undefined, false, true);
      }

      // Last attempt
      if (attempt >= maxRetries) {
        throw new RpcError(
          `Failed to confirm transaction after ${maxRetries} attempts: ${errorMessage}`,
          undefined,
          false,
          false,
          error instanceof Error ? error : undefined
        );
      }

      // Notify and retry
      if (onRetry) {
        onRetry(attempt);
      }

      await sleep(retryDelayMs);
    }
  }
}

// ============================================================================
// Dynamic Priority Fee Estimation
// ============================================================================

/**
 * Get recommended priority fee based on recent transactions
 * Uses getRecentPrioritizationFees API to estimate competitive fee
 *
 * @param connection - Solana connection
 * @param percentile - Which percentile to use (default: 75 for good inclusion)
 * @returns Priority fee in microlamports
 */
export async function getRecommendedPriorityFee(
  connection: Connection,
  percentile: number = 75
): Promise<number> {
  const MIN_PRIORITY_FEE = 1_000;      // 1,000 microlamports minimum
  const MAX_PRIORITY_FEE = 1_000_000;  // 1M microlamports cap
  const DEFAULT_PRIORITY_FEE = 50_000; // 50k microlamports fallback

  try {
    const recentFees = await connection.getRecentPrioritizationFees();

    if (!recentFees || recentFees.length === 0) {
      return DEFAULT_PRIORITY_FEE;
    }

    // Extract non-zero fees and sort
    const fees = recentFees
      .map(f => f.prioritizationFee)
      .filter(f => f > 0)
      .sort((a, b) => a - b);

    if (fees.length === 0) {
      return DEFAULT_PRIORITY_FEE;
    }

    // Calculate percentile
    const index = Math.ceil((percentile / 100) * fees.length) - 1;
    const fee = fees[Math.max(0, index)];

    // Clamp to reasonable bounds
    return Math.min(Math.max(fee, MIN_PRIORITY_FEE), MAX_PRIORITY_FEE);

  } catch (error) {
    // Fallback on error
    return DEFAULT_PRIORITY_FEE;
  }
}

// ============================================================================
// Transaction with Blockhash Refresh
// ============================================================================

export interface SendTransactionWithRefreshOptions {
  maxRetries?: number;
  confirmationTimeout?: number;
  commitment?: Commitment;
  skipPreflight?: boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Send a transaction with automatic blockhash refresh on expiration
 * This is critical for mainnet where congestion can cause blockhash to expire
 * before the transaction is confirmed.
 *
 * @param connection - Solana connection
 * @param transaction - Transaction to send (will be modified with new blockhash)
 * @param signers - Signers for the transaction
 * @param options - Send options
 * @returns Transaction signature
 */
export async function sendTransactionWithBlockhashRefresh(
  connection: Connection,
  transaction: Transaction,
  signers: Keypair[],
  options: SendTransactionWithRefreshOptions = {}
): Promise<string> {
  const {
    maxRetries = 3,
    confirmationTimeout = 45000,
    commitment = 'confirmed',
    skipPreflight = false,
    onRetry,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Get fresh blockhash for each attempt
      const { blockhash, lastValidBlockHeight } = await withRetryAndTimeout(
        () => connection.getLatestBlockhash(commitment),
        { maxRetries: 2, baseDelayMs: 500 },
        15000
      );

      // Update transaction with fresh blockhash
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = signers[0].publicKey;

      // Sign transaction
      transaction.sign(...signers);

      // Send transaction
      const sendOptions: SendOptions = {
        skipPreflight,
        preflightCommitment: commitment,
        maxRetries: 0, // We handle retries ourselves
      };

      const signature = await connection.sendRawTransaction(
        transaction.serialize(),
        sendOptions
      );

      // Wait for confirmation with timeout
      // Using proper cleanup to avoid unhandled promise rejection
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Confirmation timeout')), confirmationTimeout);
      });

      try {
        const confirmResult = await Promise.race([
          connection.confirmTransaction(
            { signature, blockhash, lastValidBlockHeight },
            commitment
          ),
          timeoutPromise,
        ]);

        // Clear timeout on success
        if (timeoutId) clearTimeout(timeoutId);

        if (confirmResult.value.err) {
          throw new RpcError(`Transaction failed: ${JSON.stringify(confirmResult.value.err)}`);
        }

        return signature;
      } catch (raceError) {
        // Clear timeout on error to prevent memory leaks
        if (timeoutId) clearTimeout(timeoutId);
        throw raceError;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message.toLowerCase();

      // Check if this is a blockhash-related error that warrants retry
      const isBlockhashError =
        errorMessage.includes('blockhash') ||
        errorMessage.includes('expired') ||
        errorMessage.includes('block height exceeded') ||
        errorMessage.includes('confirmation timeout');

      if (!isBlockhashError || attempt >= maxRetries) {
        throw lastError;
      }

      // Notify caller of retry
      if (onRetry) {
        onRetry(attempt, lastError);
      }

      // Small delay before retry
      await sleep(1000);
    }
  }

  throw lastError || new Error('Transaction failed after retries');
}

// ============================================================================
// Utilities
// ============================================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse rate limit headers from Helius response
 */
export function parseRateLimitHeaders(headers: Headers): {
  remaining: number;
  resetAtMs: number;
} | null {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');

  if (remaining && reset) {
    return {
      remaining: parseInt(remaining, 10),
      resetAtMs: parseInt(reset, 10) * 1000,
    };
  }

  return null;
}

// ============================================================================
// Batch RPC Operations
// ============================================================================

export interface BatchConfig {
  batchSize: number;       // Max accounts per request (default: 100)
  delayBetweenBatches: number; // ms delay between batches (default: 100)
  retryConfig?: Partial<RetryConfig>;
}

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  batchSize: 100,
  delayBetweenBatches: 100,
};

/**
 * Fetch multiple accounts in batches with retry
 * More efficient than individual getAccountInfo calls
 */
export async function batchGetMultipleAccounts<T>(
  connection: Connection,
  pubkeys: import('@solana/web3.js').PublicKey[],
  config: Partial<BatchConfig> = {},
  decoder?: (data: Buffer) => T
): Promise<(T | null)[]> {
  const { batchSize, delayBetweenBatches, retryConfig } = {
    ...DEFAULT_BATCH_CONFIG,
    ...config,
  };

  const results: (T | null)[] = new Array(pubkeys.length).fill(null);
  const batches: import('@solana/web3.js').PublicKey[][] = [];

  // Split into batches
  for (let i = 0; i < pubkeys.length; i += batchSize) {
    batches.push(pubkeys.slice(i, i + batchSize));
  }

  // Process batches sequentially with delay
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const startIdx = batchIdx * batchSize;

    // Add delay between batches (except first)
    if (batchIdx > 0 && delayBetweenBatches > 0) {
      await sleep(delayBetweenBatches);
    }

    // Fetch batch with retry
    const batchResults = await withRetry(
      async () => {
        await acquireRateLimitToken();
        return connection.getMultipleAccountsInfo(batch);
      },
      retryConfig
    );

    // Process results
    for (let i = 0; i < batchResults.length; i++) {
      const account = batchResults[i];
      if (account && decoder) {
        try {
          results[startIdx + i] = decoder(account.data);
        } catch {
          results[startIdx + i] = null;
        }
      } else if (account) {
        results[startIdx + i] = account as unknown as T;
      }
    }
  }

  return results;
}

/**
 * Parallel batch fetch with concurrency control
 * Faster than sequential but uses more connections
 */
export async function parallelBatchGetMultipleAccounts<T>(
  connection: Connection,
  pubkeys: import('@solana/web3.js').PublicKey[],
  config: Partial<BatchConfig> & { maxConcurrency?: number } = {},
  decoder?: (data: Buffer) => T
): Promise<(T | null)[]> {
  const { batchSize, retryConfig, maxConcurrency = 3 } = {
    ...DEFAULT_BATCH_CONFIG,
    ...config,
  };

  const results: (T | null)[] = new Array(pubkeys.length).fill(null);
  const batches: { startIdx: number; keys: import('@solana/web3.js').PublicKey[] }[] = [];

  // Split into batches with index tracking
  for (let i = 0; i < pubkeys.length; i += batchSize) {
    batches.push({
      startIdx: i,
      keys: pubkeys.slice(i, i + batchSize),
    });
  }

  // Process batches with limited concurrency
  const inFlight: Promise<void>[] = [];

  for (const batch of batches) {
    // Wait if at max concurrency
    while (inFlight.length >= maxConcurrency) {
      await Promise.race(inFlight);
    }

    const promise = (async () => {
      const batchResults = await withRetry(
        async () => {
          await acquireRateLimitToken();
          return connection.getMultipleAccountsInfo(batch.keys);
        },
        retryConfig
      );

      for (let i = 0; i < batchResults.length; i++) {
        const account = batchResults[i];
        if (account && decoder) {
          try {
            results[batch.startIdx + i] = decoder(account.data);
          } catch {
            results[batch.startIdx + i] = null;
          }
        } else if (account) {
          results[batch.startIdx + i] = account as unknown as T;
        }
      }
    })();

    // Track promise and remove when done
    inFlight.push(promise);
    promise.finally(() => {
      const idx = inFlight.indexOf(promise);
      if (idx > -1) inFlight.splice(idx, 1);
    });
  }

  // Wait for all remaining
  await Promise.all(inFlight);

  return results;
}

/**
 * Batch fetch token balances for multiple accounts
 */
export async function batchGetTokenBalances(
  connection: Connection,
  tokenAccounts: import('@solana/web3.js').PublicKey[],
  config: Partial<BatchConfig> = {}
): Promise<(bigint | null)[]> {
  return batchGetMultipleAccounts(
    connection,
    tokenAccounts,
    config,
    (data: Buffer) => {
      // SPL Token account data layout: first 8 bytes after 32-byte mint is amount
      if (data.length >= 72) {
        const amount = data.readBigUInt64LE(64);
        return amount;
      }
      return null;
    }
  );
}

/**
 * Chunk array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
