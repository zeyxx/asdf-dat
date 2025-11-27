/**
 * RPC Utilities for Production Resilience
 *
 * Provides retry logic, timeouts, and rate limit handling for Solana RPC calls.
 * Designed for mainnet conditions with Helius as primary provider.
 */

import { Connection, ConnectionConfig, Commitment, Transaction, Keypair, SendOptions } from '@solana/web3.js';

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
 * Determine if an error is retryable
 */
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Rate limit errors (429)
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
    return true;
  }

  // Network errors
  if (message.includes('econnreset') || message.includes('enotfound') || message.includes('etimedout')) {
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

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.state = 'half-open';
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
        this.state = 'closed';
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open' || this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = 'closed';
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
          return fn(this.fallbackConnection);
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
      const confirmResult = await Promise.race([
        connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          commitment
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Confirmation timeout')), confirmationTimeout)
        ),
      ]);

      if (confirmResult.value.err) {
        throw new RpcError(`Transaction failed: ${JSON.stringify(confirmResult.value.err)}`);
      }

      return signature;
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
