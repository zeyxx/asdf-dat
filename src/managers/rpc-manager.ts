/**
 * ASDF Burn Engine RPC Manager
 *
 * Connection management with:
 * - Circuit breaker pattern
 * - Automatic failover to backup RPCs
 * - Retry with exponential backoff
 * - Health monitoring
 */

import { Connection, ConnectionConfig, Commitment } from "@solana/web3.js";
import { createLogger } from "../utils/logger";
import { RpcHealth } from "../types";

const log = createLogger("rpc");

// Circuit breaker states
type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerConfig {
  failureThreshold: number;    // Failures before opening
  resetTimeout: number;        // Ms before trying again
  halfOpenRequests: number;    // Test requests in half-open
}

interface RpcManagerConfig {
  endpoints: string[];
  commitment?: Commitment;
  timeout?: number;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,      // 30 seconds
  halfOpenRequests: 2,
};

export class RpcManager {
  private endpoints: string[];
  private currentEndpointIndex: number = 0;
  private connection: Connection;
  private commitment: Commitment;
  private timeout: number;

  // Circuit breaker state
  private circuitState: CircuitState = "closed";
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenSuccesses: number = 0;
  private circuitConfig: CircuitBreakerConfig;

  // Health metrics
  private totalRequests: number = 0;
  private totalErrors: number = 0;
  private latencies: number[] = [];
  private readonly MAX_LATENCY_SAMPLES = 100;

  constructor(config: RpcManagerConfig) {
    if (config.endpoints.length === 0) {
      throw new Error("At least one RPC endpoint is required");
    }

    this.endpoints = config.endpoints;
    this.commitment = config.commitment ?? "confirmed";
    this.timeout = config.timeout ?? 30000;
    this.circuitConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...config.circuitBreaker };

    // Create initial connection
    this.connection = this.createConnection(this.endpoints[0]);
    log.info("RPC manager initialized", {
      endpoints: this.endpoints.length,
      primary: this.maskEndpoint(this.endpoints[0]),
    });
  }

  private createConnection(endpoint: string): Connection {
    const config: ConnectionConfig = {
      commitment: this.commitment,
      confirmTransactionInitialTimeout: this.timeout,
    };
    return new Connection(endpoint, config);
  }

  private maskEndpoint(endpoint: string): string {
    // Hide API keys in logs
    return endpoint.replace(/api-key=[\w-]+/gi, "api-key=***");
  }

  /**
   * Get current connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Execute an RPC operation with circuit breaker and retry
   */
  async execute<T>(operation: () => Promise<T>, retries: number = 3): Promise<T> {
    // Check circuit breaker
    if (this.circuitState === "open") {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.circuitConfig.resetTimeout) {
        this.circuitState = "half-open";
        this.halfOpenSuccesses = 0;
        log.info("Circuit breaker half-open, testing connection");
      } else {
        throw new Error("Circuit breaker is open - RPC unavailable");
      }
    }

    let lastError: Error | null = null;
    const startTime = performance.now();

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.totalRequests++;
        const result = await operation();

        // Record latency
        const latency = performance.now() - startTime;
        this.recordLatency(latency);

        // Success - update circuit breaker
        this.onSuccess();

        return result;
      } catch (error) {
        lastError = error as Error;
        this.totalErrors++;

        log.warn("RPC operation failed", {
          attempt: attempt + 1,
          maxRetries: retries + 1,
          error: lastError.message,
        });

        // Check if we should failover
        if (this.shouldFailover(lastError)) {
          this.failover();
        }

        // Exponential backoff before retry
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.onFailure();
    throw lastError;
  }

  private onSuccess(): void {
    if (this.circuitState === "half-open") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.circuitConfig.halfOpenRequests) {
        this.circuitState = "closed";
        this.failureCount = 0;
        log.info("Circuit breaker closed - connection healthy");
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.circuitState === "half-open") {
      this.circuitState = "open";
      log.warn("Circuit breaker re-opened after half-open failure");
    } else if (this.failureCount >= this.circuitConfig.failureThreshold) {
      this.circuitState = "open";
      log.warn("Circuit breaker opened after threshold reached", {
        failures: this.failureCount,
      });
    }
  }

  private shouldFailover(error: Error): boolean {
    // Failover on connection errors, timeouts, rate limits
    const failoverMessages = [
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "429",            // Rate limit
      "503",            // Service unavailable
      "socket hang up",
      "connection reset",
    ];

    return failoverMessages.some((msg) =>
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  private failover(): void {
    if (this.endpoints.length <= 1) {
      log.warn("No backup endpoints for failover");
      return;
    }

    const previousIndex = this.currentEndpointIndex;
    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.endpoints.length;

    const newEndpoint = this.endpoints[this.currentEndpointIndex];
    this.connection = this.createConnection(newEndpoint);

    log.info("Failover to backup RPC", {
      from: this.maskEndpoint(this.endpoints[previousIndex]),
      to: this.maskEndpoint(newEndpoint),
    });
  }

  private recordLatency(latencyMs: number): void {
    this.latencies.push(latencyMs);
    if (this.latencies.length > this.MAX_LATENCY_SAMPLES) {
      this.latencies.shift();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current health status
   */
  getHealth(): RpcHealth {
    const avgLatency = this.latencies.length > 0
      ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
      : 0;

    const errorRate = this.totalRequests > 0
      ? this.totalErrors / this.totalRequests
      : 0;

    return {
      connected: this.circuitState !== "open",
      latencyMs: Math.round(avgLatency),
      errorRate: Math.round(errorRate * 1000) / 1000,
      circuitBreakerOpen: this.circuitState === "open",
    };
  }

  /**
   * Check if RPC is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.execute(() => this.connection.getSlot());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current endpoint (masked)
   */
  getCurrentEndpoint(): string {
    return this.maskEndpoint(this.endpoints[this.currentEndpointIndex]);
  }

  /**
   * Force switch to specific endpoint index
   */
  switchEndpoint(index: number): void {
    if (index < 0 || index >= this.endpoints.length) {
      throw new Error(`Invalid endpoint index: ${index}`);
    }

    this.currentEndpointIndex = index;
    this.connection = this.createConnection(this.endpoints[index]);
    log.info("Manually switched endpoint", {
      to: this.maskEndpoint(this.endpoints[index]),
    });
  }

  /**
   * Reset circuit breaker (for manual recovery)
   */
  resetCircuitBreaker(): void {
    this.circuitState = "closed";
    this.failureCount = 0;
    this.halfOpenSuccesses = 0;
    log.info("Circuit breaker manually reset");
  }
}

/**
 * Create RPC manager with default Helius endpoints
 */
export function createRpcManager(
  network: "devnet" | "mainnet",
  heliusApiKey?: string
): RpcManager {
  const endpoints: string[] = [];

  // Primary: Helius if API key provided
  if (heliusApiKey) {
    const heliusBase = network === "devnet"
      ? "https://devnet.helius-rpc.com"
      : "https://mainnet.helius-rpc.com";
    endpoints.push(`${heliusBase}/?api-key=${heliusApiKey}`);
  }

  // Fallback: Public RPC
  const publicRpc = network === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
  endpoints.push(publicRpc);

  return new RpcManager({ endpoints });
}
