/**
 * ASDF Burn Engine
 *
 * Main orchestrator that composes all managers and runs the fee tracking loop.
 * - Startup sequence with auto-discovery
 * - Graceful shutdown
 * - State persistence for crash recovery
 */

import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { createLogger, setGlobalLogLevel, LogLevel } from "./utils/logger";
import { loadState, saveState } from "./utils/state-persistence";
import { HistoryManager, initHistory } from "./utils/history-manager";
import { PROGRAM_ID, DAT_STATE_SEED } from "./core/constants";
import { RpcManager, createRpcManager } from "./managers/rpc-manager";
import { TokenManager } from "./managers/token-manager";
import { FeeTracker } from "./managers/fee-tracker";
import { CycleManager } from "./managers/cycle-manager";
import { ApiServer } from "./api/server";
import { WebSocketServer } from "./api/websocket";
import { HealthStatus, DaemonConfig } from "./types";

const log = createLogger("daemon");

// Default configuration
const DEFAULT_CONFIG: Partial<DaemonConfig> = {
  apiPort: 3030,
  wsPort: 3031,
  stateFile: ".asdf-state.json",
  pollIntervalMs: 5000,
  verbose: false,
  rpcFallbackEndpoints: [],
};

export class Daemon {
  private config: DaemonConfig & { walletPath?: string };
  private rpcManager: RpcManager;
  private tokenManager: TokenManager;
  private feeTracker: FeeTracker;
  private cycleManager: CycleManager;
  private apiServer: ApiServer;
  private wsServer: WebSocketServer;
  private historyManager: HistoryManager;

  // State
  private startTime: number = 0;
  private isRunning: boolean = false;
  private cycleInProgress: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private saveInterval: NodeJS.Timeout | null = null;
  private reconciliationInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<DaemonConfig> & { creatorPubkey: PublicKey; network: "devnet" | "mainnet"; walletPath?: string }) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      rpcEndpoint: config.rpcEndpoint || this.getDefaultRpc(config.network),
      rpcFallbackEndpoints: config.rpcFallbackEndpoints || [],
    } as DaemonConfig;

    // Set log level
    if (this.config.verbose) {
      setGlobalLogLevel("debug");
    }

    // Initialize PoH history manager
    this.historyManager = initHistory({
      dataDir: "./data/history",
      verbose: this.config.verbose,
    });

    // Initialize managers
    const endpoints = [this.config.rpcEndpoint, ...this.config.rpcFallbackEndpoints];
    this.rpcManager = new RpcManager({ endpoints });

    this.tokenManager = new TokenManager(
      this.rpcManager,
      this.config.creatorPubkey,
      this.config.network,
      this.config.rootTokenMint
    );

    const creatorVault = this.tokenManager.getCreatorVaultPda();
    this.feeTracker = new FeeTracker(this.rpcManager, this.tokenManager, creatorVault, this.historyManager);

    // Initialize cycle manager
    // Note: CycleManager doesn't use PoH - burns are already on-chain
    this.cycleManager = new CycleManager(
      this.rpcManager,
      this.tokenManager,
      this.feeTracker,
      {
        network: this.config.network,
        walletPath: config.walletPath || `./${this.config.network}-wallet.json`,
      }
    );

    // Initialize API servers
    this.apiServer = new ApiServer({
      port: this.config.apiPort,
      tokenManager: this.tokenManager,
      feeTracker: this.feeTracker,
      rpcManager: this.rpcManager,
      cycleManager: this.cycleManager,
      historyManager: this.historyManager,
      getHealth: () => this.getHealth(),
    });

    this.wsServer = new WebSocketServer({
      port: this.config.wsPort,
    });
  }

  private getDefaultRpc(network: "devnet" | "mainnet"): string {
    return network === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    log.info("Starting ASDF Burn Engine", {
      network: this.config.network,
      creator: this.config.creatorPubkey.toBase58().slice(0, 8) + "...",
    });

    this.startTime = Date.now();

    // 0. Initialize PoH chain
    await this.historyManager.initialize();
    await this.historyManager.recordDaemonStart();
    log.info("PoH chain initialized", {
      entries: this.historyManager.getMetadata().totalEntries,
      latestHash: this.historyManager.getMetadata().latestHash.slice(0, 12) + "...",
    });

    // 1. Try to load persisted state
    const hasState = await this.loadPersistedState();

    // 2. Discover tokens
    await this.discoverTokens();

    // 2.5. If no state was loaded, do cold start (mark existing sigs as processed)
    if (!hasState) {
      await this.feeTracker.coldStartInit();
    }

    // 3. Load root token from on-chain DATState
    await this.loadRootTokenFromDATState();

    // 4. Start API servers
    await this.apiServer.start();
    await this.wsServer.start();

    // 4. Start polling loop
    this.startPolling();

    // 5. Start state persistence
    this.startStatePersistence();

    // 6. Start periodic reconciliation
    this.startPeriodicReconciliation();

    this.isRunning = true;

    log.info("Daemon started successfully", {
      tokens: this.tokenManager.getTrackedTokens().length,
      apiPort: this.config.apiPort,
      wsPort: this.config.wsPort,
    });
  }

  /**
   * Stop the daemon gracefully
   */
  async stop(): Promise<void> {
    log.info("Stopping daemon...");

    this.isRunning = false;

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Stop state persistence
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    // Stop reconciliation
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
    }

    // Final state save
    await this.persistState();

    // Record daemon stop in PoH
    await this.historyManager.recordDaemonStop();

    // Stop servers
    await this.wsServer.stop();
    await this.apiServer.stop();

    log.info("Daemon stopped", {
      pohEntries: this.historyManager.getMetadata().totalEntries,
    });
  }

  /**
   * Load persisted state for crash recovery
   * Returns true if state was loaded, false if cold start needed
   */
  private async loadPersistedState(): Promise<boolean> {
    try {
      const state = await loadState(this.config.stateFile);
      if (!state) {
        log.info("No persisted state found, will do cold start");
        return false;
      }

      // Verify creator matches
      if (state.creatorPubkey !== this.config.creatorPubkey.toBase58()) {
        log.warn("State file creator mismatch, starting fresh");
        return false;
      }

      // Verify network matches
      if (state.network !== this.config.network) {
        log.warn("State file network mismatch, starting fresh");
        return false;
      }

      // Load tokens
      this.tokenManager.loadTrackedTokens(state.tokens);

      // Load fee tracker state
      this.feeTracker.loadState({
        lastProcessedSignature: state.lastProcessedSignature,
        processedSignatures: state.processedSignatures,
        pollCount: state.pollCount,
        errorCount: state.errorCount,
      });

      log.info("Recovered from persisted state");
      return true;
    } catch (error) {
      log.warn("Failed to load persisted state", {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Discover tokens via getProgramAccounts
   */
  private async discoverTokens(): Promise<void> {
    log.info("Discovering tokens...");

    const discovered = await this.tokenManager.discoverTokens();

    if (discovered.length === 0) {
      log.warn("No tokens discovered for creator");
      return;
    }

    // Initialize tracking for each
    for (const token of discovered) {
      await this.tokenManager.initializeTracking(token);
    }

    // Broadcast new tokens
    for (const token of this.tokenManager.getTrackedTokens()) {
      this.wsServer.broadcastTokenDiscovered(
        token.mint.toBase58(),
        token.symbol
      );
    }
  }

  /**
   * Load root token from on-chain DATState using Anchor
   * This allows the daemon to know which token is the root for treasury display
   */
  private async loadRootTokenFromDATState(): Promise<void> {
    try {
      // Derive DATState PDA
      const [datStatePda] = PublicKey.findProgramAddressSync(
        [DAT_STATE_SEED],
        PROGRAM_ID
      );

      // Load IDL
      const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
      if (!fs.existsSync(idlPath)) {
        log.debug("IDL not found, skipping root token detection");
        return;
      }
      const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

      // Create dummy provider for read-only access
      const connection = this.rpcManager.getConnection();
      const dummyWallet = {
        publicKey: PublicKey.default,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any) => txs,
      };
      const provider = new AnchorProvider(connection, dummyWallet as any, {});

      // Create program
      const program = new Program(idl, provider);

      // Fetch DATState using Anchor
      const datState = await (program.account as any).datState.fetch(datStatePda);

      if (datState && datState.rootTokenMint) {
        const rootMint = datState.rootTokenMint as PublicKey;

        log.info("Root token loaded from DATState", {
          mint: rootMint.toBase58().slice(0, 8) + "...",
        });

        // Ensure root token is tracked (may not be discovered if bonding curve closed)
        const existingToken = this.tokenManager.getToken(rootMint);
        if (!existingToken) {
          // Derive bonding curve PDA
          const [bondingCurve] = PublicKey.findProgramAddressSync(
            [Buffer.from("bonding-curve"), rootMint.toBuffer()],
            new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P")
          );

          // Initialize tracking for root token
          await this.tokenManager.initializeTracking({
            mint: rootMint,
            bondingCurve,
            poolType: "bonding_curve",
            discoveredAt: Date.now(),
          });

          log.info("Root token added to tracking", {
            mint: rootMint.toBase58().slice(0, 8) + "...",
          });
        }

        // Set in TokenManager
        this.tokenManager.setRootToken(rootMint);
      } else {
        log.debug("No root token configured in DATState");
      }
    } catch (error) {
      log.warn("Failed to load root token from DATState", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Start the polling loop
   */
  private startPolling(): void {
    const poll = async () => {
      if (!this.isRunning) return;

      const events = await this.feeTracker.poll();

      // Broadcast updates if any fees detected
      if (events.length > 0) {
        this.wsServer.broadcastFees(
          this.feeTracker.getTotals(),
          this.feeTracker.getFeeRecords()
        );
      }

      // Auto-cycle: Check if cycle is ready and execute automatically
      await this.checkAndExecuteAutoCycle();
    };

    // Initial poll
    poll();

    // Start interval
    this.pollInterval = setInterval(poll, this.config.pollIntervalMs);
  }

  /**
   * Check if cycle is ready and execute automatically
   */
  private async checkAndExecuteAutoCycle(): Promise<void> {
    // Prevent concurrent cycles
    if (this.cycleInProgress) {
      log.debug("Cycle already in progress, skipping");
      return;
    }

    try {
      const readiness = await this.cycleManager.checkCycleReadiness();

      if (readiness.ready && readiness.eligibleTokens.length > 0) {
        this.cycleInProgress = true;

        log.info("Auto-cycle triggered", {
          eligibleTokens: readiness.eligibleTokens.map(t => t.symbol),
          totalPending: Number(readiness.totalPending) / 1e9,
        });

        // Execute the cycle
        const result = await this.cycleManager.executeCycle();

        if (result.success) {
          log.info("Auto-cycle completed", {
            cycleId: result.cycleId,
            flushed: Number(result.totalFlushedLamports) / 1e9,
            burned: Number(result.totalBurnedTokens),
          });

          // Broadcast cycle completion
          this.wsServer.broadcastCycleComplete(result);
        } else {
          log.warn("Auto-cycle failed", {
            errors: result.errors,
          });
        }

        this.cycleInProgress = false;
      }
    } catch (error) {
      this.cycleInProgress = false;
      log.error("Auto-cycle check failed", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Start periodic state persistence
   */
  private startStatePersistence(): void {
    this.saveInterval = setInterval(async () => {
      await this.persistState();
    }, 30000); // Every 30 seconds
  }

  /**
   * Start periodic reconciliation (10 minutes)
   * Compares internal state vs on-chain reality
   */
  private startPeriodicReconciliation(): void {
    const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

    this.reconciliationInterval = setInterval(async () => {
      if (!this.isRunning) return;

      const result = await this.feeTracker.periodicReconciliation();

      if (result.reconciled) {
        log.warn("Periodic reconciliation triggered auto-correction", {
          divergencePercent: result.divergencePercent,
          details: result.details,
        });
      }
    }, RECONCILIATION_INTERVAL_MS);

    log.info("Periodic reconciliation started (10 min interval)");
  }

  /**
   * Persist current state to disk
   */
  private async persistState(): Promise<void> {
    try {
      const feeState = this.feeTracker.getState();

      await saveState(
        this.config.stateFile,
        this.config.creatorPubkey,
        this.config.network,
        this.tokenManager.getTrackedTokens(),
        feeState.processedSignatures,
        feeState.lastProcessedSignature,
        feeState.pollCount,
        feeState.errorCount
      );
    } catch (error) {
      log.error("Failed to persist state", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get current health status
   */
  getHealth(): { status: HealthStatus; uptime: number } {
    const uptime = Date.now() - this.startTime;
    const rpcHealth = this.rpcManager.getHealth();
    const stats = this.feeTracker.getStats();
    const tokens = this.tokenManager.getTrackedTokens();

    // Determine status
    let status: HealthStatus = "healthy";

    if (!rpcHealth.connected || rpcHealth.circuitBreakerOpen) {
      status = "unhealthy";
    } else if (
      stats.errorRate > 0.1 ||
      tokens.length === 0 ||
      stats.pollCount === 0
    ) {
      status = "degraded";
    }

    return { status, uptime };
  }

  /**
   * Get daemon stats
   */
  getStats(): {
    uptime: number;
    tokens: number;
    pollCount: number;
    errorRate: number;
    wsClients: number;
  } {
    const stats = this.feeTracker.getStats();

    return {
      uptime: Date.now() - this.startTime,
      tokens: this.tokenManager.getTrackedTokens().length,
      pollCount: stats.pollCount,
      errorRate: stats.errorRate,
      wsClients: this.wsServer.getClientCount(),
    };
  }
}

/**
 * Create and configure daemon from environment/options
 */
export function createDaemon(options: {
  creator: string;
  network: "devnet" | "mainnet";
  rootToken?: string;
  apiPort?: number;
  wsPort?: number;
  stateFile?: string;
  rpcEndpoint?: string;
  heliusApiKey?: string;
  verbose?: boolean;
}): Daemon {
  const creatorPubkey = new PublicKey(options.creator);
  const rootTokenMint = options.rootToken ? new PublicKey(options.rootToken) : undefined;

  // Build RPC endpoint
  let rpcEndpoint = options.rpcEndpoint;
  if (!rpcEndpoint && options.heliusApiKey) {
    const heliusBase = options.network === "devnet"
      ? "https://devnet.helius-rpc.com"
      : "https://mainnet.helius-rpc.com";
    rpcEndpoint = `${heliusBase}/?api-key=${options.heliusApiKey}`;
  }

  return new Daemon({
    creatorPubkey,
    network: options.network,
    rootTokenMint,
    apiPort: options.apiPort,
    wsPort: options.wsPort,
    stateFile: options.stateFile,
    rpcEndpoint,
    verbose: options.verbose,
  });
}
