/**
 * ASDF-DAT Monitoring System
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
}

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
  tokensMonitored: number;
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
      tokensMonitored: 0,
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
      })),
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

    // Check memory usage
    alerting.checkMemory();
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
