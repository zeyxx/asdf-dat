/**
 * ASDF Burn Engine Monitoring System
 *
 * Provides metrics collection in both Prometheus and JSON formats
 * for production monitoring and alerting.
 *
 * Integrates with:
 * - Alerting system (lib/alerting.ts) for threshold-based notifications
 * - Metrics persistence (lib/metrics-persistence.ts) for historical data
 */

import { getAlerting, AlertingService } from './alerting';

export interface TokenMetrics {
  symbol: string;
  mint: string;
  feesCollected: number;      // lamports
  tokensBurned: number;       // raw units
  cyclesExecuted: number;
  lastCycleTimestamp: number;
  pendingFees: number;        // lamports
  sentToRoot: number;         // lamports (for secondaries)
  // Per-token error tracking
  errorCount: number;
  lastError?: string;
  lastErrorTimestamp?: number;
  lastErrorCategory?: string;
  consecutiveFailures: number;
}

export interface LatencyMetrics {
  samples: number[];          // Last N samples in ms
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  count: number;
}

export type OperationType =
  | 'rpc_call'
  | 'buy_instruction'
  | 'burn_instruction'
  | 'collect_instruction'
  | 'poll_token'
  | 'cycle_complete'
  | 'rebate_process';

export type ErrorCategory =
  | 'rpc'
  | 'transaction'
  | 'slippage'
  | 'timeout'
  | 'insufficient_funds'
  | 'program_error'
  | 'unknown';

export interface DaemonMetrics {
  startTime: number;
  uptime: number;             // seconds
  totalFeesDetected: number;  // lamports
  totalFeesFlushed: number;   // lamports
  pollCount: number;
  flushCount: number;
  errorCount: number;
  lastPollTimestamp: number;
  lastFlushTimestamp: number;
  lastTxDetectedTimestamp: number;  // Last time a new TX was detected (for stale check)
  tokensMonitored: number;
  rootTreasuryBalance: number;      // Last known root treasury balance
}

export interface CycleMetrics {
  totalCycles: number;
  successfulCycles: number;
  failedCycles: number;
  deferredTokens: number;
  totalTokensBurned: number;  // across all tokens
  totalFeesCollected: number; // lamports
  averageCycleTime: number;   // ms
  lastCycleTimestamp: number;
}

export class MonitoringService {
  private tokenMetrics: Map<string, TokenMetrics> = new Map();
  public daemonMetrics: DaemonMetrics;  // Public for direct access in daemon
  public cycleMetrics: CycleMetrics;    // Public for direct access in orchestrator
  private cycleTimes: number[] = [];
  private readonly MAX_CYCLE_TIMES = 100;

  // Latency tracking per operation type
  private operationLatencies: Map<OperationType, LatencyMetrics> = new Map();
  private readonly MAX_LATENCY_SAMPLES = 100;

  constructor() {
    const now = Date.now();
    this.daemonMetrics = {
      startTime: now,
      uptime: 0,
      totalFeesDetected: 0,
      totalFeesFlushed: 0,
      pollCount: 0,
      flushCount: 0,
      errorCount: 0,
      lastPollTimestamp: 0,
      lastFlushTimestamp: 0,
      lastTxDetectedTimestamp: 0,
      tokensMonitored: 0,
      rootTreasuryBalance: 0,
    };

    this.cycleMetrics = {
      totalCycles: 0,
      successfulCycles: 0,
      failedCycles: 0,
      deferredTokens: 0,
      totalTokensBurned: 0,
      totalFeesCollected: 0,
      averageCycleTime: 0,
      lastCycleTimestamp: 0,
    };
  }

  // ============================================================================
  // Token Metrics
  // ============================================================================

  initToken(mint: string, symbol: string): void {
    if (!this.tokenMetrics.has(mint)) {
      this.tokenMetrics.set(mint, {
        symbol,
        mint,
        feesCollected: 0,
        tokensBurned: 0,
        cyclesExecuted: 0,
        lastCycleTimestamp: 0,
        pendingFees: 0,
        sentToRoot: 0,
        errorCount: 0,
        consecutiveFailures: 0,
      });
      this.daemonMetrics.tokensMonitored = this.tokenMetrics.size;
    }
  }

  recordFeeDetected(mint: string, amount: number): void {
    const metrics = this.tokenMetrics.get(mint);
    if (metrics) {
      metrics.pendingFees += amount;
    }
    this.daemonMetrics.totalFeesDetected += amount;
    this.daemonMetrics.lastTxDetectedTimestamp = Date.now();
  }

  /**
   * Update root treasury balance (for tracking fund flow)
   */
  updateRootTreasuryBalance(balanceLamports: number): void {
    const previous = this.daemonMetrics.rootTreasuryBalance;
    this.daemonMetrics.rootTreasuryBalance = balanceLamports;

    // Check for significant changes (via alerting)
    const alerting = getAlerting();
    alerting.checkRootTreasuryChange(balanceLamports, previous);
  }

  recordFeesFlushed(mint: string, amount: number): void {
    const metrics = this.tokenMetrics.get(mint);
    if (metrics) {
      metrics.pendingFees = 0; // Reset after flush
    }
    this.daemonMetrics.totalFeesFlushed += amount;
    this.daemonMetrics.flushCount++;
    this.daemonMetrics.lastFlushTimestamp = Date.now();
  }

  recordCycleExecuted(
    mint: string,
    feesCollected: number,
    tokensBurned: number,
    sentToRoot: number = 0
  ): void {
    const metrics = this.tokenMetrics.get(mint);
    if (metrics) {
      metrics.feesCollected += feesCollected;
      metrics.tokensBurned += tokensBurned;
      metrics.cyclesExecuted++;
      metrics.lastCycleTimestamp = Date.now();
      metrics.sentToRoot += sentToRoot;
      metrics.pendingFees = 0;
    }
  }

  recordPoll(): void {
    this.daemonMetrics.pollCount++;
    this.daemonMetrics.lastPollTimestamp = Date.now();
  }

  recordError(): void {
    this.daemonMetrics.errorCount++;
  }

  // ============================================================================
  // Per-Token Error Tracking
  // ============================================================================

  /**
   * Record an error for a specific token
   */
  recordTokenError(mint: string, category: ErrorCategory, message: string): void {
    const metrics = this.tokenMetrics.get(mint);
    if (metrics) {
      metrics.errorCount++;
      metrics.consecutiveFailures++;
      metrics.lastError = message;
      metrics.lastErrorTimestamp = Date.now();
      metrics.lastErrorCategory = category;
    }
    // Also increment global error count
    this.daemonMetrics.errorCount++;
  }

  /**
   * Clear consecutive failures for a token (call on success)
   */
  recordTokenSuccess(mint: string): void {
    const metrics = this.tokenMetrics.get(mint);
    if (metrics) {
      metrics.consecutiveFailures = 0;
    }
  }

  /**
   * Get error rate for a specific token
   */
  getTokenErrorRate(mint: string): number {
    const metrics = this.tokenMetrics.get(mint);
    if (!metrics || metrics.cyclesExecuted === 0) return 0;
    return metrics.errorCount / (metrics.cyclesExecuted + metrics.errorCount);
  }

  // ============================================================================
  // Latency Tracking
  // ============================================================================

  /**
   * Initialize latency metrics for an operation type
   */
  private initLatencyMetrics(operation: OperationType): LatencyMetrics {
    return {
      samples: [],
      p50: 0,
      p95: 0,
      p99: 0,
      min: Infinity,
      max: 0,
      count: 0,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  /**
   * Record latency for an operation
   */
  recordOperationLatency(operation: OperationType, latencyMs: number): void {
    let metrics = this.operationLatencies.get(operation);
    if (!metrics) {
      metrics = this.initLatencyMetrics(operation);
      this.operationLatencies.set(operation, metrics);
    }

    // Add sample
    metrics.samples.push(latencyMs);
    metrics.count++;

    // Maintain max samples
    if (metrics.samples.length > this.MAX_LATENCY_SAMPLES) {
      metrics.samples.shift();
    }

    // Update min/max
    metrics.min = Math.min(metrics.min, latencyMs);
    metrics.max = Math.max(metrics.max, latencyMs);

    // Recalculate percentiles
    const sorted = [...metrics.samples].sort((a, b) => a - b);
    metrics.p50 = this.percentile(sorted, 50);
    metrics.p95 = this.percentile(sorted, 95);
    metrics.p99 = this.percentile(sorted, 99);
  }

  /**
   * Get latency metrics for an operation
   */
  getOperationLatency(operation: OperationType): LatencyMetrics | undefined {
    return this.operationLatencies.get(operation);
  }

  /**
   * Get all latency metrics
   */
  getAllLatencyMetrics(): Map<OperationType, LatencyMetrics> {
    return this.operationLatencies;
  }

  // ============================================================================
  // Cycle Metrics
  // ============================================================================

  recordCycleComplete(
    success: boolean,
    deferredCount: number,
    tokensBurned: number,
    feesCollected: number,
    cycleTimeMs: number
  ): void {
    this.cycleMetrics.totalCycles++;
    if (success) {
      this.cycleMetrics.successfulCycles++;
    } else {
      this.cycleMetrics.failedCycles++;
    }
    this.cycleMetrics.deferredTokens += deferredCount;
    this.cycleMetrics.totalTokensBurned += tokensBurned;
    this.cycleMetrics.totalFeesCollected += feesCollected;
    this.cycleMetrics.lastCycleTimestamp = Date.now();

    // Track cycle times for average
    this.cycleTimes.push(cycleTimeMs);
    if (this.cycleTimes.length > this.MAX_CYCLE_TIMES) {
      this.cycleTimes.shift();
    }
    this.cycleMetrics.averageCycleTime =
      this.cycleTimes.reduce((a, b) => a + b, 0) / this.cycleTimes.length;
  }

  // ============================================================================
  // Prometheus Format Export
  // ============================================================================

  toPrometheus(): string {
    const lines: string[] = [];
    const now = Date.now();
    this.daemonMetrics.uptime = Math.floor((now - this.daemonMetrics.startTime) / 1000);

    // Daemon metrics
    lines.push('# HELP asdf_daemon_uptime_seconds Daemon uptime in seconds');
    lines.push('# TYPE asdf_daemon_uptime_seconds gauge');
    lines.push(`asdf_daemon_uptime_seconds ${this.daemonMetrics.uptime}`);

    lines.push('# HELP asdf_daemon_fees_detected_lamports Total fees detected');
    lines.push('# TYPE asdf_daemon_fees_detected_lamports counter');
    lines.push(`asdf_daemon_fees_detected_lamports ${this.daemonMetrics.totalFeesDetected}`);

    lines.push('# HELP asdf_daemon_fees_flushed_lamports Total fees flushed to on-chain');
    lines.push('# TYPE asdf_daemon_fees_flushed_lamports counter');
    lines.push(`asdf_daemon_fees_flushed_lamports ${this.daemonMetrics.totalFeesFlushed}`);

    lines.push('# HELP asdf_daemon_poll_count Total poll operations');
    lines.push('# TYPE asdf_daemon_poll_count counter');
    lines.push(`asdf_daemon_poll_count ${this.daemonMetrics.pollCount}`);

    lines.push('# HELP asdf_daemon_flush_count Total flush operations');
    lines.push('# TYPE asdf_daemon_flush_count counter');
    lines.push(`asdf_daemon_flush_count ${this.daemonMetrics.flushCount}`);

    lines.push('# HELP asdf_daemon_error_count Total errors');
    lines.push('# TYPE asdf_daemon_error_count counter');
    lines.push(`asdf_daemon_error_count ${this.daemonMetrics.errorCount}`);

    lines.push('# HELP asdf_daemon_tokens_monitored Number of tokens being monitored');
    lines.push('# TYPE asdf_daemon_tokens_monitored gauge');
    lines.push(`asdf_daemon_tokens_monitored ${this.daemonMetrics.tokensMonitored}`);

    // Cycle metrics
    lines.push('# HELP asdf_cycles_total Total ecosystem cycles');
    lines.push('# TYPE asdf_cycles_total counter');
    lines.push(`asdf_cycles_total ${this.cycleMetrics.totalCycles}`);

    lines.push('# HELP asdf_cycles_successful Successful cycles');
    lines.push('# TYPE asdf_cycles_successful counter');
    lines.push(`asdf_cycles_successful ${this.cycleMetrics.successfulCycles}`);

    lines.push('# HELP asdf_cycles_failed Failed cycles');
    lines.push('# TYPE asdf_cycles_failed counter');
    lines.push(`asdf_cycles_failed ${this.cycleMetrics.failedCycles}`);

    lines.push('# HELP asdf_tokens_burned_total Total tokens burned across all tokens');
    lines.push('# TYPE asdf_tokens_burned_total counter');
    lines.push(`asdf_tokens_burned_total ${this.cycleMetrics.totalTokensBurned}`);

    lines.push('# HELP asdf_fees_collected_lamports Total fees collected');
    lines.push('# TYPE asdf_fees_collected_lamports counter');
    lines.push(`asdf_fees_collected_lamports ${this.cycleMetrics.totalFeesCollected}`);

    lines.push('# HELP asdf_cycle_duration_ms Average cycle duration');
    lines.push('# TYPE asdf_cycle_duration_ms gauge');
    lines.push(`asdf_cycle_duration_ms ${this.cycleMetrics.averageCycleTime.toFixed(2)}`);

    // Per-token metrics
    lines.push('# HELP asdf_token_fees_collected_lamports Fees collected per token');
    lines.push('# TYPE asdf_token_fees_collected_lamports counter');
    for (const [mint, m] of this.tokenMetrics) {
      lines.push(`asdf_token_fees_collected_lamports{mint="${mint}",symbol="${m.symbol}"} ${m.feesCollected}`);
    }

    lines.push('# HELP asdf_token_burned Tokens burned per token');
    lines.push('# TYPE asdf_token_burned counter');
    for (const [mint, m] of this.tokenMetrics) {
      lines.push(`asdf_token_burned{mint="${mint}",symbol="${m.symbol}"} ${m.tokensBurned}`);
    }

    lines.push('# HELP asdf_token_cycles Cycles executed per token');
    lines.push('# TYPE asdf_token_cycles counter');
    for (const [mint, m] of this.tokenMetrics) {
      lines.push(`asdf_token_cycles{mint="${mint}",symbol="${m.symbol}"} ${m.cyclesExecuted}`);
    }

    lines.push('# HELP asdf_token_pending_fees_lamports Pending fees per token');
    lines.push('# TYPE asdf_token_pending_fees_lamports gauge');
    for (const [mint, m] of this.tokenMetrics) {
      lines.push(`asdf_token_pending_fees_lamports{mint="${mint}",symbol="${m.symbol}"} ${m.pendingFees}`);
    }

    lines.push('# HELP asdf_token_sent_to_root_lamports SOL sent to root treasury per token');
    lines.push('# TYPE asdf_token_sent_to_root_lamports counter');
    for (const [mint, m] of this.tokenMetrics) {
      lines.push(`asdf_token_sent_to_root_lamports{mint="${mint}",symbol="${m.symbol}"} ${m.sentToRoot}`);
    }

    // Per-token error metrics
    lines.push('# HELP asdf_token_error_count Errors per token');
    lines.push('# TYPE asdf_token_error_count counter');
    for (const [mint, m] of this.tokenMetrics) {
      lines.push(`asdf_token_error_count{mint="${mint}",symbol="${m.symbol}"} ${m.errorCount}`);
    }

    lines.push('# HELP asdf_token_consecutive_failures Consecutive failures per token');
    lines.push('# TYPE asdf_token_consecutive_failures gauge');
    for (const [mint, m] of this.tokenMetrics) {
      lines.push(`asdf_token_consecutive_failures{mint="${mint}",symbol="${m.symbol}"} ${m.consecutiveFailures}`);
    }

    // Latency percentiles per operation
    lines.push('# HELP asdf_operation_latency_p50_ms 50th percentile latency');
    lines.push('# TYPE asdf_operation_latency_p50_ms gauge');
    for (const [op, lat] of this.operationLatencies) {
      lines.push(`asdf_operation_latency_p50_ms{operation="${op}"} ${lat.p50.toFixed(2)}`);
    }

    lines.push('# HELP asdf_operation_latency_p95_ms 95th percentile latency');
    lines.push('# TYPE asdf_operation_latency_p95_ms gauge');
    for (const [op, lat] of this.operationLatencies) {
      lines.push(`asdf_operation_latency_p95_ms{operation="${op}"} ${lat.p95.toFixed(2)}`);
    }

    lines.push('# HELP asdf_operation_latency_p99_ms 99th percentile latency');
    lines.push('# TYPE asdf_operation_latency_p99_ms gauge');
    for (const [op, lat] of this.operationLatencies) {
      lines.push(`asdf_operation_latency_p99_ms{operation="${op}"} ${lat.p99.toFixed(2)}`);
    }

    lines.push('# HELP asdf_operation_latency_count Total latency samples per operation');
    lines.push('# TYPE asdf_operation_latency_count counter');
    for (const [op, lat] of this.operationLatencies) {
      lines.push(`asdf_operation_latency_count{operation="${op}"} ${lat.count}`);
    }

    return lines.join('\n');
  }

  // ============================================================================
  // JSON Format Export
  // ============================================================================

  toJSON(): object {
    const now = Date.now();
    this.daemonMetrics.uptime = Math.floor((now - this.daemonMetrics.startTime) / 1000);

    return {
      timestamp: new Date().toISOString(),
      daemon: {
        ...this.daemonMetrics,
        startTimeISO: new Date(this.daemonMetrics.startTime).toISOString(),
        lastPollISO: this.daemonMetrics.lastPollTimestamp
          ? new Date(this.daemonMetrics.lastPollTimestamp).toISOString()
          : null,
        lastFlushISO: this.daemonMetrics.lastFlushTimestamp
          ? new Date(this.daemonMetrics.lastFlushTimestamp).toISOString()
          : null,
        // Human readable
        totalFeesDetectedSOL: this.daemonMetrics.totalFeesDetected / 1e9,
        totalFeesFlushedSOL: this.daemonMetrics.totalFeesFlushed / 1e9,
      },
      cycles: {
        ...this.cycleMetrics,
        lastCycleISO: this.cycleMetrics.lastCycleTimestamp
          ? new Date(this.cycleMetrics.lastCycleTimestamp).toISOString()
          : null,
        successRate: this.cycleMetrics.totalCycles > 0
          ? (this.cycleMetrics.successfulCycles / this.cycleMetrics.totalCycles * 100).toFixed(2) + '%'
          : 'N/A',
        totalFeesCollectedSOL: this.cycleMetrics.totalFeesCollected / 1e9,
      },
      tokens: Array.from(this.tokenMetrics.values()).map(m => ({
        ...m,
        feesCollectedSOL: m.feesCollected / 1e9,
        pendingFeesSOL: m.pendingFees / 1e9,
        sentToRootSOL: m.sentToRoot / 1e9,
        lastCycleISO: m.lastCycleTimestamp
          ? new Date(m.lastCycleTimestamp).toISOString()
          : null,
        lastErrorISO: m.lastErrorTimestamp
          ? new Date(m.lastErrorTimestamp).toISOString()
          : null,
        errorRate: m.cyclesExecuted > 0
          ? (m.errorCount / (m.cyclesExecuted + m.errorCount) * 100).toFixed(2) + '%'
          : 'N/A',
      })),
      latencies: Object.fromEntries(
        Array.from(this.operationLatencies.entries()).map(([op, lat]) => [
          op,
          {
            p50: lat.p50,
            p95: lat.p95,
            p99: lat.p99,
            min: lat.min === Infinity ? 0 : lat.min,
            max: lat.max,
            count: lat.count,
          },
        ])
      ),
    };
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  getHealth(): { status: string; checks: Record<string, boolean>; details: Record<string, string> } {
    const now = Date.now();
    const checks: Record<string, boolean> = {};
    const details: Record<string, string> = {};

    // Check 1: Daemon is running (uptime > 0)
    checks['daemon_running'] = this.daemonMetrics.startTime > 0;
    details['daemon_running'] = checks['daemon_running']
      ? `Uptime: ${Math.floor((now - this.daemonMetrics.startTime) / 1000)}s`
      : 'Daemon not started';

    // Check 2: Recent poll activity (within last 60s)
    const pollAge = now - this.daemonMetrics.lastPollTimestamp;
    checks['recent_poll'] = this.daemonMetrics.lastPollTimestamp > 0 && pollAge < 60000;
    details['recent_poll'] = this.daemonMetrics.lastPollTimestamp > 0
      ? `Last poll: ${Math.floor(pollAge / 1000)}s ago`
      : 'No polls yet';

    // Check 3: Low error rate (< 10% of polls)
    const errorRate = this.daemonMetrics.pollCount > 0
      ? this.daemonMetrics.errorCount / this.daemonMetrics.pollCount
      : 0;
    checks['low_error_rate'] = errorRate < 0.1;
    details['low_error_rate'] = `Error rate: ${(errorRate * 100).toFixed(2)}%`;

    // Check 4: Tokens monitored
    checks['tokens_monitored'] = this.daemonMetrics.tokensMonitored > 0;
    details['tokens_monitored'] = `${this.daemonMetrics.tokensMonitored} tokens`;

    // Overall status
    const allHealthy = Object.values(checks).every(v => v);
    const status = allHealthy ? 'healthy' : 'degraded';

    return { status, checks, details };
  }

  // ============================================================================
  // Update pending fees (for sync with on-chain data)
  // ============================================================================

  updatePendingFees(mint: string, amount: number): void {
    const metrics = this.tokenMetrics.get(mint);
    if (metrics) {
      metrics.pendingFees = amount;
    }
  }

  // ============================================================================
  // Alert Checking
  // ============================================================================

  /**
   * Check all alert conditions based on current metrics.
   * Should be called periodically (e.g., every 30 seconds).
   * @param expectedPollIntervalMs The expected poll interval for lag detection
   */
  checkAlertConditions(expectedPollIntervalMs: number = 5000): void {
    const alerting = getAlerting();
    const now = Date.now();

    // Check error rate
    if (this.daemonMetrics.pollCount > 10) {  // Only check after sufficient data
      const errorRate = this.daemonMetrics.errorCount / this.daemonMetrics.pollCount;
      alerting.checkErrorRate(errorRate);
    }

    // Check poll lag
    if (this.daemonMetrics.lastPollTimestamp > 0) {
      const timeSinceLastPoll = now - this.daemonMetrics.lastPollTimestamp;
      if (timeSinceLastPoll > expectedPollIntervalMs * 2) {
        alerting.checkPollLag(timeSinceLastPoll, expectedPollIntervalMs);
      }
    }

    // Check pending fees stuck
    if (this.daemonMetrics.lastFlushTimestamp > 0) {
      const timeSinceFlush = now - this.daemonMetrics.lastFlushTimestamp;
      const totalPending = Array.from(this.tokenMetrics.values())
        .reduce((sum, m) => sum + m.pendingFees, 0);
      const pendingSOL = totalPending / 1e9;

      alerting.checkPendingFees(timeSinceFlush, pendingSOL);
    }

    // Check daemon stale (no new transactions detected)
    if (this.daemonMetrics.lastTxDetectedTimestamp > 0) {
      const timeSinceLastTx = now - this.daemonMetrics.lastTxDetectedTimestamp;
      // Default threshold: 1 hour (configurable via parameter in future)
      alerting.checkDaemonStale(timeSinceLastTx, 3600000);
    }

    // Check memory usage
    alerting.checkMemory();
  }

  /**
   * Check fee collection divergence
   * Call this after a cycle with expected vs actual fees
   */
  checkFeeDivergence(expectedFees: number, actualFees: number): void {
    const alerting = getAlerting();
    alerting.checkFeeDivergence(expectedFees, actualFees);
  }

  // ============================================================================
  // System Metrics
  // ============================================================================

  /**
   * Get current system metrics for persistence snapshots
   */
  getSystemMetrics(): {
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
    uptimeSeconds: number;
  } {
    const mem = process.memoryUsage();
    return {
      heapUsedMB: mem.heapUsed / 1024 / 1024,
      heapTotalMB: mem.heapTotal / 1024 / 1024,
      externalMB: mem.external / 1024 / 1024,
      uptimeSeconds: process.uptime(),
    };
  }
}

// Singleton instance for global access
export const monitoring = new MonitoringService();
