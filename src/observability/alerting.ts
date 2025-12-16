/**
 * ASDF Burn Engine Alerting System
 *
 * Webhook-based alerting with support for Discord and Slack.
 * Features:
 * - Auto-detection of webhook platform
 * - Rate limiting (token bucket)
 * - Per-alert-type cooldown
 * - Configurable severity levels and thresholds
 * - Formatted embeds/blocks for rich notifications
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// ============================================================================
// Types
// ============================================================================

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertType =
  | 'error_rate_high'
  | 'poll_lag'
  | 'pending_fees_stuck'
  | 'cycle_failed'
  | 'cycle_success'
  | 'daemon_restart'
  | 'circuit_breaker_open'
  | 'rpc_degraded'
  | 'memory_high'
  | 'daemon_stale'
  | 'fee_divergence'
  | 'root_treasury_change';

export interface Alert {
  severity: AlertSeverity;
  type: AlertType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface AlertConfig {
  webhookUrl: string;
  webhookType: 'discord' | 'slack' | 'auto';
  rateLimitWindowMs: number;
  rateLimitMaxAlerts: number;
  minAlertIntervalMs: number;  // Per-alert-type cooldown
  enabled: boolean;
  testMode: boolean;  // Log instead of send
}

export interface AlertThresholds {
  errorRatePercent: number;
  pollLagMultiplier: number;
  pendingFeesStuckMinutes: number;
  failedCyclesConsecutive: number;
  memoryUsagePercent: number;
}

export interface CycleSummary {
  success: boolean;
  tokensProcessed: number;
  tokensDeferred: number;
  totalBurned: number;
  totalFeesSOL: number;
  durationMs: number;
  network: string;
}

// Discord webhook payload
interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  timestamp: string;
  fields?: Array<{ name: string; value: string; inline: boolean }>;
  footer?: { text: string };
}

interface DiscordWebhookPayload {
  embeds: DiscordEmbed[];
}

// Slack webhook payload
interface SlackBlock {
  type: 'section' | 'header' | 'divider';
  text?: { type: 'mrkdwn' | 'plain_text'; text: string };
  fields?: Array<{ type: 'mrkdwn'; text: string }>;
}

interface SlackWebhookPayload {
  attachments: Array<{
    color: string;
    blocks: SlackBlock[];
  }>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: AlertConfig = {
  webhookUrl: '',
  webhookType: 'auto',
  rateLimitWindowMs: 60000,      // 1 minute
  rateLimitMaxAlerts: 5,         // Max 5 alerts per minute
  minAlertIntervalMs: 300000,    // 5 min cooldown per alert type
  enabled: true,
  testMode: false,
};

const DEFAULT_THRESHOLDS: AlertThresholds = {
  errorRatePercent: 10,
  pollLagMultiplier: 2,
  pendingFeesStuckMinutes: 30,
  failedCyclesConsecutive: 3,
  memoryUsagePercent: 90,
};

// Severity colors
const SEVERITY_COLORS = {
  info: { discord: 0x3498DB, slack: '#3498DB' },      // Blue
  warning: { discord: 0xF1C40F, slack: '#F1C40F' },   // Yellow
  critical: { discord: 0xE74C3C, slack: '#E74C3C' },  // Red
};

const SEVERITY_EMOJI = {
  info: 'information_source',
  warning: 'warning',
  critical: 'rotating_light',
};

// ============================================================================
// AlertingService Class
// ============================================================================

export class AlertingService {
  private config: AlertConfig;
  private thresholds: AlertThresholds;
  private lastAlertTime: Map<AlertType, number> = new Map();
  private recentAlerts: number[] = [];
  private detectedWebhookType: 'discord' | 'slack' | null = null;
  private consecutiveFailedCycles: number = 0;

  constructor(
    config: Partial<AlertConfig> = {},
    thresholds: Partial<AlertThresholds> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };

    // Auto-detect webhook type if needed
    if (this.config.webhookUrl && this.config.webhookType === 'auto') {
      this.detectedWebhookType = this.detectWebhookType(this.config.webhookUrl);
    }
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  updateConfig(config: Partial<AlertConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.webhookUrl && this.config.webhookType === 'auto') {
      this.detectedWebhookType = this.detectWebhookType(config.webhookUrl);
    }
  }

  updateThresholds(thresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  getConfig(): AlertConfig {
    return { ...this.config };
  }

  getThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }

  // ==========================================================================
  // Core Alert Methods
  // ==========================================================================

  async send(alert: Omit<Alert, 'timestamp'>): Promise<boolean> {
    const fullAlert: Alert = { ...alert, timestamp: Date.now() };

    // Check if alerting is enabled
    if (!this.config.enabled) {
      return false;
    }

    // Check if webhook URL is configured
    if (!this.config.webhookUrl) {
      return false;
    }

    // Rate limiting check
    if (this.isRateLimited()) {
      console.warn(`[Alerting] Rate limited, dropping alert: ${alert.title}`);
      return false;
    }

    // Per-alert-type cooldown check
    if (this.isCoolingDown(alert.type)) {
      console.debug(`[Alerting] Cooldown active for ${alert.type}, dropping alert`);
      return false;
    }

    // Test mode: just log
    if (this.config.testMode) {
      console.log(`[Alerting] TEST MODE - Would send: ${JSON.stringify(fullAlert, null, 2)}`);
      this.recordAlert(fullAlert);
      return true;
    }

    // Send the alert
    try {
      const webhookType = this.getWebhookType();
      if (!webhookType) {
        console.error('[Alerting] Could not determine webhook type');
        return false;
      }

      const payload = webhookType === 'discord'
        ? this.formatForDiscord(fullAlert)
        : this.formatForSlack(fullAlert);

      await this.sendWebhook(payload);
      this.recordAlert(fullAlert);

      console.log(`[Alerting] Sent ${alert.severity} alert: ${alert.title}`);
      return true;
    } catch (error: any) {
      console.error(`[Alerting] Failed to send alert: ${error.message}`);
      return false;
    }
  }

  // ==========================================================================
  // Threshold Checking Methods
  // ==========================================================================

  checkErrorRate(errorRate: number): void {
    const ratePercent = errorRate * 100;
    if (ratePercent > this.thresholds.errorRatePercent) {
      this.send({
        severity: 'warning',
        type: 'error_rate_high',
        title: 'High Error Rate Detected',
        message: `Error rate is ${ratePercent.toFixed(1)}%, threshold is ${this.thresholds.errorRatePercent}%`,
        data: { errorRate: ratePercent },
      });
    }
  }

  checkPollLag(currentIntervalMs: number, expectedIntervalMs: number): void {
    const lagMultiplier = currentIntervalMs / expectedIntervalMs;
    if (lagMultiplier > this.thresholds.pollLagMultiplier) {
      this.send({
        severity: 'warning',
        type: 'poll_lag',
        title: 'Poll Lag Detected',
        message: `Poll interval is ${(currentIntervalMs / 1000).toFixed(1)}s, expected ${(expectedIntervalMs / 1000).toFixed(1)}s (${lagMultiplier.toFixed(1)}x slower)`,
        data: { currentIntervalMs, expectedIntervalMs, lagMultiplier },
      });
    }
  }

  checkPendingFees(lastFlushAgoMs: number, pendingFeesSOL: number): void {
    const stuckMinutes = lastFlushAgoMs / 60000;
    if (stuckMinutes > this.thresholds.pendingFeesStuckMinutes && pendingFeesSOL > 0.01) {
      this.send({
        severity: 'warning',
        type: 'pending_fees_stuck',
        title: 'Pending Fees Not Flushing',
        message: `${pendingFeesSOL.toFixed(4)} SOL pending for ${stuckMinutes.toFixed(0)} minutes`,
        data: { pendingFeesSOL, stuckMinutes },
      });
    }
  }

  checkCycleFailure(error: string): void {
    this.consecutiveFailedCycles++;

    if (this.consecutiveFailedCycles >= this.thresholds.failedCyclesConsecutive) {
      this.send({
        severity: 'critical',
        type: 'cycle_failed',
        title: 'Multiple Cycle Failures',
        message: `${this.consecutiveFailedCycles} consecutive cycle failures. Last error: ${error}`,
        data: { consecutiveFailures: this.consecutiveFailedCycles, lastError: error },
      });
    }
  }

  checkMemory(): void {
    const used = process.memoryUsage();
    const heapPercent = (used.heapUsed / used.heapTotal) * 100;

    if (heapPercent > this.thresholds.memoryUsagePercent) {
      this.send({
        severity: 'warning',
        type: 'memory_high',
        title: 'High Memory Usage',
        message: `Heap usage at ${heapPercent.toFixed(1)}% (${(used.heapUsed / 1024 / 1024).toFixed(0)}MB / ${(used.heapTotal / 1024 / 1024).toFixed(0)}MB)`,
        data: {
          heapUsedMB: used.heapUsed / 1024 / 1024,
          heapTotalMB: used.heapTotal / 1024 / 1024,
          heapPercent,
        },
      });
    }
  }

  /**
   * Check if daemon appears stale (no new transactions detected for too long)
   * @param lastTxDetectedAgoMs Time since last transaction was detected
   * @param thresholdMs Threshold in milliseconds (default: 1 hour for devnet, 24 hours for mainnet)
   */
  checkDaemonStale(lastTxDetectedAgoMs: number, thresholdMs: number = 3600000): void {
    if (lastTxDetectedAgoMs > thresholdMs) {
      const hoursAgo = (lastTxDetectedAgoMs / 3600000).toFixed(1);
      this.send({
        severity: 'warning',
        type: 'daemon_stale',
        title: 'Daemon Appears Stale',
        message: `No new transactions detected in ${hoursAgo} hours. Check if trading is occurring or if daemon is stuck.`,
        data: {
          lastTxDetectedAgoMs,
          thresholdMs,
          hoursAgo: parseFloat(hoursAgo),
        },
      });
    }
  }

  /**
   * Check if fee collection diverges from expected (tracked vs. actual)
   * @param expectedFees Expected fees from daemon tracking (lamports)
   * @param actualFees Actual fees collected (lamports)
   * @param tolerancePercent Acceptable divergence (default: 10%)
   */
  checkFeeDivergence(expectedFees: number, actualFees: number, tolerancePercent: number = 10): void {
    if (expectedFees === 0 && actualFees === 0) return;

    const divergencePercent = expectedFees > 0
      ? Math.abs((actualFees - expectedFees) / expectedFees) * 100
      : 100;

    if (divergencePercent > tolerancePercent) {
      this.send({
        severity: 'warning',
        type: 'fee_divergence',
        title: 'Fee Collection Divergence Detected',
        message: `Actual fees (${(actualFees / 1e9).toFixed(6)} SOL) diverged ${divergencePercent.toFixed(1)}% from expected (${(expectedFees / 1e9).toFixed(6)} SOL)`,
        data: {
          expectedFees,
          actualFees,
          divergencePercent,
          tolerancePercent,
        },
      });
    }
  }

  /**
   * Check root treasury balance and alert on significant changes
   * @param balanceLamports Current root treasury balance
   * @param previousBalanceLamports Previous balance for comparison
   * @param minChangeForAlert Minimum change to trigger alert (default: 0.1 SOL)
   */
  checkRootTreasuryChange(
    balanceLamports: number,
    previousBalanceLamports: number,
    minChangeForAlert: number = 100_000_000
  ): void {
    const change = balanceLamports - previousBalanceLamports;
    const absChange = Math.abs(change);

    if (absChange >= minChangeForAlert) {
      const changeSOL = change / 1e9;
      const balanceSOL = balanceLamports / 1e9;
      const direction = change > 0 ? 'increased' : 'decreased';

      this.send({
        severity: 'info',
        type: 'root_treasury_change',
        title: 'Root Treasury Balance Changed',
        message: `Treasury ${direction} by ${Math.abs(changeSOL).toFixed(4)} SOL. New balance: ${balanceSOL.toFixed(4)} SOL`,
        data: {
          balanceLamports,
          previousBalanceLamports,
          changeLamports: change,
          changeSOL,
          direction,
        },
      });
    }
  }

  // ==========================================================================
  // Convenience Alert Methods
  // ==========================================================================

  async sendCycleSuccess(summary: CycleSummary): Promise<void> {
    // Reset consecutive failures counter
    this.consecutiveFailedCycles = 0;

    await this.send({
      severity: 'info',
      type: 'cycle_success',
      title: 'Ecosystem Cycle Completed',
      message: `Processed ${summary.tokensProcessed} tokens, burned ${summary.totalBurned.toLocaleString()} tokens`,
      data: {
        tokensProcessed: summary.tokensProcessed,
        tokensDeferred: summary.tokensDeferred,
        totalBurned: summary.totalBurned,
        totalFeesSOL: summary.totalFeesSOL,
        durationMs: summary.durationMs,
        network: summary.network,
      },
    });
  }

  async sendCycleFailure(error: string, details: Record<string, unknown> = {}): Promise<void> {
    this.checkCycleFailure(error);

    // Always send individual failure alert (separate from consecutive check)
    await this.send({
      severity: 'critical',
      type: 'cycle_failed',
      title: 'Ecosystem Cycle Failed',
      message: error,
      data: details,
    });
  }

  async sendDaemonRestart(previousUptime?: number): Promise<void> {
    await this.send({
      severity: 'info',
      type: 'daemon_restart',
      title: 'Daemon Restarted',
      message: previousUptime
        ? `Daemon restarted after ${(previousUptime / 3600).toFixed(1)}h uptime`
        : 'Daemon started',
      data: { previousUptime },
    });
  }

  async sendCircuitBreakerOpen(details: Record<string, unknown> = {}): Promise<void> {
    await this.send({
      severity: 'warning',
      type: 'circuit_breaker_open',
      title: 'RPC Circuit Breaker Opened',
      message: 'RPC connection experiencing issues, circuit breaker activated',
      data: details,
    });
  }

  async sendRpcDegraded(details: Record<string, unknown> = {}): Promise<void> {
    await this.send({
      severity: 'warning',
      type: 'rpc_degraded',
      title: 'RPC Connection Degraded',
      message: 'Using fallback RPC endpoint',
      data: details,
    });
  }

  // ==========================================================================
  // Rate Limiting & Cooldown
  // ==========================================================================

  private isRateLimited(): boolean {
    const now = Date.now();

    // Remove old entries outside the window
    this.recentAlerts = this.recentAlerts.filter(
      (ts) => now - ts < this.config.rateLimitWindowMs
    );

    // Check if under limit
    return this.recentAlerts.length >= this.config.rateLimitMaxAlerts;
  }

  private isCoolingDown(type: AlertType): boolean {
    const lastTime = this.lastAlertTime.get(type);
    if (!lastTime) return false;

    return Date.now() - lastTime < this.config.minAlertIntervalMs;
  }

  private recordAlert(alert: Alert): void {
    this.recentAlerts.push(alert.timestamp);
    this.lastAlertTime.set(alert.type, alert.timestamp);
  }

  // ==========================================================================
  // Webhook Type Detection
  // ==========================================================================

  private getWebhookType(): 'discord' | 'slack' | null {
    if (this.config.webhookType !== 'auto') {
      return this.config.webhookType;
    }
    return this.detectedWebhookType;
  }

  private detectWebhookType(url: string): 'discord' | 'slack' | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('discord.com') || parsed.hostname.includes('discordapp.com')) {
        return 'discord';
      }
      if (parsed.hostname.includes('slack.com') || parsed.hostname.includes('hooks.slack.com')) {
        return 'slack';
      }
      return null;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // Formatting
  // ==========================================================================

  private formatForDiscord(alert: Alert): DiscordWebhookPayload {
    const color = SEVERITY_COLORS[alert.severity].discord;

    const fields: Array<{ name: string; value: string; inline: boolean }> = [];

    // Add data fields if present
    if (alert.data) {
      for (const [key, value] of Object.entries(alert.data)) {
        // Format value appropriately
        let formattedValue: string;
        if (typeof value === 'number') {
          formattedValue = Number.isInteger(value) ? value.toString() : value.toFixed(4);
        } else {
          formattedValue = String(value);
        }

        fields.push({
          name: this.formatFieldName(key),
          value: formattedValue,
          inline: true,
        });
      }
    }

    return {
      embeds: [{
        title: `${this.getEmojiForSeverity(alert.severity)} ${alert.title}`,
        description: alert.message,
        color,
        timestamp: new Date(alert.timestamp).toISOString(),
        fields: fields.length > 0 ? fields : undefined,
        footer: { text: 'ASDF Burn Engine Monitoring' },
      }],
    };
  }

  private formatForSlack(alert: Alert): SlackWebhookPayload {
    const color = SEVERITY_COLORS[alert.severity].slack;

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${this.getEmojiForSeverity(alert.severity)} ${alert.title}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: alert.message,
        },
      },
    ];

    // Add data fields if present
    if (alert.data && Object.keys(alert.data).length > 0) {
      const fields: Array<{ type: 'mrkdwn'; text: string }> = [];

      for (const [key, value] of Object.entries(alert.data)) {
        let formattedValue: string;
        if (typeof value === 'number') {
          formattedValue = Number.isInteger(value) ? value.toString() : value.toFixed(4);
        } else {
          formattedValue = String(value);
        }

        fields.push({
          type: 'mrkdwn',
          text: `*${this.formatFieldName(key)}:*\n${formattedValue}`,
        });
      }

      blocks.push({
        type: 'section',
        fields,
      });
    }

    // Add timestamp footer
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_${new Date(alert.timestamp).toISOString()}_`,
      },
    });

    return {
      attachments: [{
        color,
        blocks,
      }],
    };
  }

  private getEmojiForSeverity(severity: AlertSeverity): string {
    const emoji = SEVERITY_EMOJI[severity];
    return `:${emoji}:`;
  }

  private formatFieldName(key: string): string {
    // Convert camelCase or snake_case to Title Case
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }

  // ==========================================================================
  // HTTP Request
  // ==========================================================================

  private async sendWebhook(payload: DiscordWebhookPayload | SlackWebhookPayload): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.config.webhookUrl);
      const data = JSON.stringify(payload);

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 10000, // 10 second timeout
      };

      const client = url.protocol === 'https:' ? https : http;

      const req = client.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Webhook returned status ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Webhook request timed out'));
      });

      req.write(data);
      req.end();
    });
  }

  // ==========================================================================
  // Status & Testing
  // ==========================================================================

  getStatus(): {
    enabled: boolean;
    webhookConfigured: boolean;
    webhookType: 'discord' | 'slack' | null;
    recentAlertCount: number;
    lastAlerts: Record<string, number>;
  } {
    return {
      enabled: this.config.enabled,
      webhookConfigured: !!this.config.webhookUrl,
      webhookType: this.getWebhookType(),
      recentAlertCount: this.recentAlerts.length,
      lastAlerts: Object.fromEntries(this.lastAlertTime),
    };
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.config.webhookUrl) {
      return { success: false, error: 'No webhook URL configured' };
    }

    try {
      await this.send({
        severity: 'info',
        type: 'daemon_restart',
        title: 'Test Alert',
        message: 'This is a test alert from ASDF Burn Engine monitoring system.',
        data: { test: true, timestamp: Date.now() },
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let alertingInstance: AlertingService | null = null;

export function getAlerting(): AlertingService {
  if (!alertingInstance) {
    alertingInstance = new AlertingService();
  }
  return alertingInstance;
}

export function initAlerting(
  config: Partial<AlertConfig>,
  thresholds?: Partial<AlertThresholds>
): AlertingService {
  alertingInstance = new AlertingService(config, thresholds);
  return alertingInstance;
}

// Default export for convenience
export const alerting = getAlerting();
