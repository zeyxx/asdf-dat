/**
 * ASDF Burn Engine Metrics Persistence
 *
 * Persists monitoring metrics to disk for historical analysis and crash recovery.
 * Features:
 * - Periodic snapshots (configurable interval)
 * - Atomic writes with checksums
 * - Automatic cleanup of old data
 * - Crash recovery from latest snapshot
 * - Query API for historical data
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MonitoringService, TokenMetrics, DaemonMetrics, CycleMetrics } from './monitoring';

// ============================================================================
// Types
// ============================================================================

export interface MetricsPersistenceConfig {
  dataDir: string;
  snapshotIntervalMs: number;
  retentionDays: number;
  maxSnapshotsPerDay: number;
  enabled: boolean;
}

export interface SystemMetrics {
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  uptimeSeconds: number;
  rpcState?: {
    circuitState: 'closed' | 'open' | 'half-open';
    usingFallback: boolean;
    rateLimitTokens: number;
  };
}

export interface MetricsSnapshot {
  timestamp: string;  // ISO 8601
  version: number;
  daemon: DaemonMetrics;
  cycles: CycleMetrics;
  tokens: TokenMetrics[];
  system: SystemMetrics;
  checksum: string;
}

export interface ManifestEntry {
  date: string;  // YYYY-MM-DD
  count: number;
  firstSnapshot: string;
  lastSnapshot: string;
  totalSizeBytes: number;
}

export interface MetricsManifest {
  version: number;
  lastUpdated: string;
  entries: ManifestEntry[];
  totalSnapshots: number;
  oldestSnapshot: string | null;
  newestSnapshot: string | null;
}

export interface MetricsSummary {
  period: {
    from: string;
    to: string;
    days: number;
  };
  daemon: {
    avgUptime: number;
    totalPolls: number;
    totalFlushes: number;
    totalErrors: number;
    avgErrorRate: number;
  };
  cycles: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    avgDuration: number;
  };
  tokens: {
    totalFeesCollected: number;
    totalBurned: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

const SNAPSHOT_VERSION = 1;

const DEFAULT_CONFIG: MetricsPersistenceConfig = {
  dataDir: './data/metrics',
  snapshotIntervalMs: 300000,  // 5 minutes
  retentionDays: 30,
  maxSnapshotsPerDay: 288,     // Every 5 minutes = 288 per day
  enabled: true,
};

// ============================================================================
// MetricsPersistence Class
// ============================================================================

export class MetricsPersistence {
  private config: MetricsPersistenceConfig;
  private monitoring: MonitoringService;
  private manifest: MetricsManifest;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(
    monitoring: MonitoringService,
    config: Partial<MetricsPersistenceConfig> = {}
  ) {
    this.monitoring = monitoring;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.manifest = this.createEmptyManifest();

    // Ensure data directory exists
    if (this.config.enabled) {
      this.ensureDataDir();
      this.loadManifest();
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  start(): void {
    if (!this.config.enabled) {
      console.log('[MetricsPersistence] Disabled, skipping start');
      return;
    }

    if (this.isRunning) {
      console.warn('[MetricsPersistence] Already running');
      return;
    }

    this.isRunning = true;

    // Take initial snapshot
    this.takeSnapshot().catch((err) => {
      console.error('[MetricsPersistence] Initial snapshot failed:', err.message);
    });

    // Start periodic snapshots
    this.snapshotTimer = setInterval(
      () => this.takeSnapshot().catch((err) => {
        console.error('[MetricsPersistence] Snapshot failed:', err.message);
      }),
      this.config.snapshotIntervalMs
    );

    console.log(`[MetricsPersistence] Started (interval: ${this.config.snapshotIntervalMs / 1000}s)`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    // Take final snapshot before stopping
    try {
      await this.takeSnapshot();
      console.log('[MetricsPersistence] Final snapshot saved');
    } catch (err: any) {
      console.error('[MetricsPersistence] Final snapshot failed:', err.message);
    }
  }

  // ==========================================================================
  // Snapshot Operations
  // ==========================================================================

  async takeSnapshot(): Promise<MetricsSnapshot> {
    const now = new Date();

    // Gather all metrics
    const metricsJson = this.monitoring.toJSON() as any;

    // Get system metrics
    const memUsage = process.memoryUsage();
    const system: SystemMetrics = {
      heapUsedMB: memUsage.heapUsed / 1024 / 1024,
      heapTotalMB: memUsage.heapTotal / 1024 / 1024,
      externalMB: memUsage.external / 1024 / 1024,
      uptimeSeconds: process.uptime(),
    };

    // Build snapshot without checksum first
    const snapshotData = {
      timestamp: now.toISOString(),
      version: SNAPSHOT_VERSION,
      daemon: this.monitoring.daemonMetrics,
      cycles: this.monitoring.cycleMetrics,
      tokens: metricsJson.tokens || [],
      system,
    };

    // Calculate checksum
    const checksum = this.calculateChecksum(snapshotData);
    const snapshot: MetricsSnapshot = { ...snapshotData, checksum };

    // Save snapshot
    await this.saveSnapshot(snapshot);

    return snapshot;
  }

  private async saveSnapshot(snapshot: MetricsSnapshot): Promise<void> {
    const date = new Date(snapshot.timestamp);
    const dateStr = this.formatDate(date);
    const timeStr = this.formatTime(date);

    // Ensure date directory exists
    const dateDir = path.join(this.config.dataDir, dateStr);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }

    // Build snapshot path
    const snapshotPath = path.join(dateDir, `snapshot-${timeStr}.json`);
    const snapshotJson = JSON.stringify(snapshot, null, 2);

    // Atomic write: temp file + fsync + rename
    const tempPath = `${snapshotPath}.tmp.${process.pid}`;
    const fd = fs.openSync(tempPath, 'w');
    try {
      fs.writeSync(fd, snapshotJson);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, snapshotPath);

    // Update latest.json symlink/copy
    await this.updateLatest(snapshot);

    // Update manifest
    await this.updateManifest(dateStr, snapshot);

    // Cleanup old data if needed
    await this.cleanup();
  }

  private async updateLatest(snapshot: MetricsSnapshot): Promise<void> {
    const latestPath = path.join(this.config.dataDir, 'latest.json');
    const snapshotJson = JSON.stringify(snapshot, null, 2);

    // Atomic write for latest
    const tempPath = `${latestPath}.tmp.${process.pid}`;
    const fd = fs.openSync(tempPath, 'w');
    try {
      fs.writeSync(fd, snapshotJson);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, latestPath);
  }

  private async updateManifest(dateStr: string, snapshot: MetricsSnapshot): Promise<void> {
    // Find or create entry for this date
    let entry = this.manifest.entries.find((e) => e.date === dateStr);
    if (!entry) {
      entry = {
        date: dateStr,
        count: 0,
        firstSnapshot: snapshot.timestamp,
        lastSnapshot: snapshot.timestamp,
        totalSizeBytes: 0,
      };
      this.manifest.entries.push(entry);
      // Sort by date descending
      this.manifest.entries.sort((a, b) => b.date.localeCompare(a.date));
    }

    // Update entry
    entry.count++;
    entry.lastSnapshot = snapshot.timestamp;
    entry.totalSizeBytes += Buffer.byteLength(JSON.stringify(snapshot));

    // Update manifest totals
    this.manifest.totalSnapshots++;
    this.manifest.lastUpdated = new Date().toISOString();
    this.manifest.newestSnapshot = snapshot.timestamp;
    if (!this.manifest.oldestSnapshot) {
      this.manifest.oldestSnapshot = snapshot.timestamp;
    }

    // Save manifest
    await this.saveManifest();
  }

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  async getLatest(): Promise<MetricsSnapshot | null> {
    const latestPath = path.join(this.config.dataDir, 'latest.json');

    if (!fs.existsSync(latestPath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(latestPath, 'utf8');
      const snapshot: MetricsSnapshot = JSON.parse(data);

      // Validate checksum
      if (!this.validateChecksum(snapshot)) {
        console.warn('[MetricsPersistence] Latest snapshot has invalid checksum');
        return null;
      }

      return snapshot;
    } catch (err: any) {
      console.error('[MetricsPersistence] Failed to load latest:', err.message);
      return null;
    }
  }

  async getRange(from: Date, to: Date): Promise<MetricsSnapshot[]> {
    const snapshots: MetricsSnapshot[] = [];

    // Get all dates in range
    const currentDate = new Date(from);
    while (currentDate <= to) {
      const dateStr = this.formatDate(currentDate);
      const dateDir = path.join(this.config.dataDir, dateStr);

      if (fs.existsSync(dateDir)) {
        const files = fs.readdirSync(dateDir)
          .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
          .sort();

        for (const file of files) {
          try {
            const data = fs.readFileSync(path.join(dateDir, file), 'utf8');
            const snapshot: MetricsSnapshot = JSON.parse(data);

            const snapshotTime = new Date(snapshot.timestamp);
            if (snapshotTime >= from && snapshotTime <= to) {
              if (this.validateChecksum(snapshot)) {
                snapshots.push(snapshot);
              }
            }
          } catch (err) {
            // Skip invalid files
          }
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return snapshots;
  }

  async getSummary(days: number): Promise<MetricsSummary> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const snapshots = await this.getRange(from, to);

    if (snapshots.length === 0) {
      return this.createEmptySummary(from, to, days);
    }

    // Aggregate metrics
    let totalUptime = 0;
    let totalPolls = 0;
    let totalFlushes = 0;
    let totalErrors = 0;
    let totalCycles = 0;
    let successfulCycles = 0;
    let failedCycles = 0;
    let totalCycleDuration = 0;
    let totalFeesCollected = 0;
    let totalBurned = 0;

    for (const snapshot of snapshots) {
      totalUptime += snapshot.daemon.uptime;
      totalPolls += snapshot.daemon.pollCount;
      totalFlushes += snapshot.daemon.flushCount;
      totalErrors += snapshot.daemon.errorCount;

      totalCycles += snapshot.cycles.totalCycles;
      successfulCycles += snapshot.cycles.successfulCycles;
      failedCycles += snapshot.cycles.failedCycles;
      totalCycleDuration += snapshot.cycles.averageCycleTime;

      totalFeesCollected += snapshot.cycles.totalFeesCollected;
      totalBurned += snapshot.cycles.totalTokensBurned;
    }

    const count = snapshots.length;

    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        days,
      },
      daemon: {
        avgUptime: totalUptime / count,
        totalPolls,
        totalFlushes,
        totalErrors,
        avgErrorRate: totalPolls > 0 ? totalErrors / totalPolls : 0,
      },
      cycles: {
        total: totalCycles,
        successful: successfulCycles,
        failed: failedCycles,
        successRate: totalCycles > 0 ? (successfulCycles / totalCycles) * 100 : 0,
        avgDuration: count > 0 ? totalCycleDuration / count : 0,
      },
      tokens: {
        totalFeesCollected,
        totalBurned,
      },
    };
  }

  // ==========================================================================
  // Recovery
  // ==========================================================================

  async loadFromLatest(): Promise<boolean> {
    const latest = await this.getLatest();
    if (!latest) {
      return false;
    }

    console.log(`[MetricsPersistence] Loaded latest snapshot from ${latest.timestamp}`);

    // Note: We don't restore metrics to MonitoringService because
    // it should start fresh. The snapshot is for historical reference.
    // If you want to restore counters, do it here:
    // this.monitoring.daemonMetrics = latest.daemon;

    return true;
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  async cleanup(): Promise<number> {
    if (!this.config.enabled) return 0;

    let deletedCount = 0;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
      const cutoffStr = this.formatDate(cutoffDate);

      // Find and remove old date directories
      const entries = fs.readdirSync(this.config.dataDir);
      for (const entry of entries) {
        // Skip non-date directories and files
        if (!entry.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

        if (entry < cutoffStr) {
          const dirPath = path.join(this.config.dataDir, entry);
          const files = fs.readdirSync(dirPath);
          deletedCount += files.length;

          // Remove all files in directory
          for (const file of files) {
            fs.unlinkSync(path.join(dirPath, file));
          }
          // Remove directory
          fs.rmdirSync(dirPath);

          console.log(`[MetricsPersistence] Cleaned up old data: ${entry} (${files.length} files)`);

          // Update manifest
          this.manifest.entries = this.manifest.entries.filter((e) => e.date !== entry);
        }
      }

      // Update manifest totals
      if (deletedCount > 0) {
        this.manifest.totalSnapshots -= deletedCount;
        if (this.manifest.entries.length > 0) {
          const oldest = this.manifest.entries[this.manifest.entries.length - 1];
          this.manifest.oldestSnapshot = oldest.firstSnapshot;
        } else {
          this.manifest.oldestSnapshot = null;
        }
        await this.saveManifest();
      }
    } catch (err: any) {
      console.error('[MetricsPersistence] Cleanup error:', err.message);
    }

    return deletedCount;
  }

  // ==========================================================================
  // Manifest Management
  // ==========================================================================

  private createEmptyManifest(): MetricsManifest {
    return {
      version: SNAPSHOT_VERSION,
      lastUpdated: new Date().toISOString(),
      entries: [],
      totalSnapshots: 0,
      oldestSnapshot: null,
      newestSnapshot: null,
    };
  }

  private loadManifest(): void {
    const manifestPath = path.join(this.config.dataDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      this.manifest = this.createEmptyManifest();
      return;
    }

    try {
      const data = fs.readFileSync(manifestPath, 'utf8');
      this.manifest = JSON.parse(data);
    } catch (err: any) {
      console.warn('[MetricsPersistence] Failed to load manifest:', err.message);
      this.manifest = this.createEmptyManifest();
    }
  }

  private async saveManifest(): Promise<void> {
    const manifestPath = path.join(this.config.dataDir, 'manifest.json');
    const manifestJson = JSON.stringify(this.manifest, null, 2);

    // Atomic write
    const tempPath = `${manifestPath}.tmp.${process.pid}`;
    const fd = fs.openSync(tempPath, 'w');
    try {
      fs.writeSync(fd, manifestJson);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, manifestPath);
  }

  getManifest(): MetricsManifest {
    return { ...this.manifest };
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  private ensureDataDir(): void {
    if (!fs.existsSync(this.config.dataDir)) {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);  // YYYY-MM-DD
  }

  private formatTime(date: Date): string {
    return date.toISOString().slice(11, 19).replace(/:/g, '-');  // HH-MM-SS
  }

  private calculateChecksum(data: Omit<MetricsSnapshot, 'checksum'>): string {
    const json = JSON.stringify(data);
    return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  }

  private validateChecksum(snapshot: MetricsSnapshot): boolean {
    const { checksum, ...data } = snapshot;
    const expectedChecksum = this.calculateChecksum(data);
    return checksum === expectedChecksum;
  }

  private createEmptySummary(from: Date, to: Date, days: number): MetricsSummary {
    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        days,
      },
      daemon: {
        avgUptime: 0,
        totalPolls: 0,
        totalFlushes: 0,
        totalErrors: 0,
        avgErrorRate: 0,
      },
      cycles: {
        total: 0,
        successful: 0,
        failed: 0,
        successRate: 0,
        avgDuration: 0,
      },
      tokens: {
        totalFeesCollected: 0,
        totalBurned: 0,
      },
    };
  }

  // ==========================================================================
  // Status
  // ==========================================================================

  getStatus(): {
    enabled: boolean;
    isRunning: boolean;
    dataDir: string;
    snapshotIntervalMs: number;
    retentionDays: number;
    totalSnapshots: number;
    oldestSnapshot: string | null;
    newestSnapshot: string | null;
  } {
    return {
      enabled: this.config.enabled,
      isRunning: this.isRunning,
      dataDir: this.config.dataDir,
      snapshotIntervalMs: this.config.snapshotIntervalMs,
      retentionDays: this.config.retentionDays,
      totalSnapshots: this.manifest.totalSnapshots,
      oldestSnapshot: this.manifest.oldestSnapshot,
      newestSnapshot: this.manifest.newestSnapshot,
    };
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let persistenceInstance: MetricsPersistence | null = null;

export function getMetricsPersistence(): MetricsPersistence | null {
  return persistenceInstance;
}

export function initMetricsPersistence(
  monitoring: MonitoringService,
  config: Partial<MetricsPersistenceConfig> = {}
): MetricsPersistence {
  persistenceInstance = new MetricsPersistence(monitoring, config);
  return persistenceInstance;
}
