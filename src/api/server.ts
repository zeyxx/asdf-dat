/**
 * ASDF Burn Engine API Server
 *
 * HTTP API for dashboard and external integrations.
 * Endpoints: /health, /fees, /tokens, /burns, /treasury, /rebate-pool
 * Also serves static dashboard files.
 */

import * as http from "http";
import * as fs from "fs";
import * as nodePath from "path";
import { URL } from "url";
import { PublicKey } from "@solana/web3.js";
import { createLogger } from "../utils/logger";
import { TokenManager } from "../managers/token-manager";
import { FeeTracker } from "../managers/fee-tracker";
import { RpcManager } from "../managers/rpc-manager";
import { CycleManager } from "../managers/cycle-manager";
import { HistoryManager } from "../utils/history-manager";
import {
  HealthStatus,
  ApiFeesResponse,
  ApiTokenFee,
  LAMPORTS_PER_SOL,
} from "../types";
import {
  PROGRAM_ID,
  ROOT_TREASURY_SEED,
  REBATE_POOL_SEED,
} from "../core/constants";
import * as ControlPanel from "./control-panel";

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const log = createLogger("api");

export interface ApiServerConfig {
  port: number;
  tokenManager: TokenManager;
  feeTracker: FeeTracker;
  rpcManager: RpcManager;
  cycleManager?: CycleManager;
  historyManager?: HistoryManager;
  wsServer?: { broadcast: (msg: any) => void };
  getHealth: () => { status: HealthStatus; uptime: number };
}

export class ApiServer {
  private server: http.Server | null = null;
  private config: ApiServerConfig;
  private startTime: number = Date.now();

  constructor(config: ApiServerConfig) {
    this.config = config;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", (error) => {
        log.error("Server error", { error: error.message });
        reject(error);
      });

      this.server.listen(this.config.port, () => {
        log.info("API server started", { port: this.config.port });
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          log.info("API server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming request
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const path = url.pathname;

    try {
      // API routes
      switch (path) {
        case "/":
        case "/dashboard":
          await this.serveStaticFile(res, "index.html");
          break;
        case "/admin":
          await this.serveStaticFile(res, "admin.html");
          break;
        case "/health":
          await this.handleHealth(req, res);
          break;
        case "/health/sync":
          await this.handleHealthSync(req, res);
          break;
        case "/fees":
          await this.handleFees(req, res);
          break;
        case "/tokens":
          await this.handleTokens(req, res);
          break;
        case "/burns":
          await this.handleBurns(req, res, url);
          break;
        case "/treasury":
          await this.handleTreasury(req, res);
          break;
        case "/rebate-pool":
          await this.handleRebatePool(req, res);
          break;
        case "/attestation":
          await this.handleAttestation(req, res);
          break;
        case "/history":
          await this.handleHistory(req, res, url);
          break;
        case "/flush":
          await this.handleFlush(req, res);
          break;
        case "/cycle":
          await this.handleCycle(req, res);
          break;
        case "/cycle/status":
          await this.handleCycleStatus(req, res);
          break;
        // Test/Mock endpoints
        case "/test/add-token":
          await this.handleTestAddToken(req, res);
          break;
        case "/test/add-fee":
          await this.handleTestAddFee(req, res);
          break;
        case "/test/simulate-burn":
          await this.handleTestSimulateBurn(req, res);
          break;
        case "/test/clear":
          await this.handleTestClear(req, res);
          break;
        case "/test/scenario":
          await this.handleTestScenario(req, res);
          break;
        // Real Control Panel endpoints (devnet only)
        case "/control/tokens":
          await this.handleControlTokens(req, res);
          break;
        case "/control/wallet":
          await this.handleControlWallet(req, res);
          break;
        case "/control/fees":
          await this.handleControlFees(req, res);
          break;
        case "/control/volume":
          await this.handleControlVolume(req, res);
          break;
        case "/control/sell":
          await this.handleControlSell(req, res);
          break;
        case "/control/cycle":
          await this.handleControlCycle(req, res);
          break;
        case "/control/workflow":
          await this.handleControlWorkflow(req, res);
          break;
        case "/control/create-token":
          await this.handleControlCreateToken(req, res);
          break;
        case "/control/init-token-stats":
          await this.handleControlInitTokenStats(req, res);
          break;
        case "/control/set-root-token":
          await this.handleControlSetRootToken(req, res);
          break;
        case "/control/sync-fees":
          await this.handleControlSyncFees(req, res);
          break;
        default:
          // Try serving as static file from dashboard
          const served = await this.tryServeStatic(path, res);
          if (!served) {
            this.sendJson(res, 404, { error: "Not found" });
          }
      }
    } catch (error) {
      log.error("Request error", {
        path,
        error: (error as Error).message,
      });
      this.sendJson(res, 500, { error: "Internal server error" });
    }
  }

  /**
   * Get dashboard directory path
   * Works both in development (src/) and production (dist/)
   */
  private getDashboardDir(): string {
    // Try multiple possible locations
    const candidates = [
      nodePath.join(__dirname, "../../dashboard"),      // From dist/api/
      nodePath.join(__dirname, "../dashboard"),         // From src/api/
      nodePath.join(process.cwd(), "dashboard"),        // From project root
    ];

    for (const dir of candidates) {
      if (fs.existsSync(nodePath.join(dir, "index.html"))) {
        return dir;
      }
    }

    // Fallback to first candidate
    return candidates[0];
  }

  /**
   * Serve a static file from dashboard directory
   */
  private async serveStaticFile(
    res: http.ServerResponse,
    filename: string
  ): Promise<void> {
    const dashboardDir = this.getDashboardDir();
    const filePath = nodePath.join(dashboardDir, filename);
    const ext = nodePath.extname(filename).toLowerCase();
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": mimeType });
      res.end(content);
    } catch (error) {
      log.warn("Static file not found", { filename, path: filePath });
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("File not found");
    }
  }

  /**
   * Try to serve a path as static file
   * Returns true if file was served, false otherwise
   */
  private async tryServeStatic(
    urlPath: string,
    res: http.ServerResponse
  ): Promise<boolean> {
    // Remove leading slash and sanitize path
    let filename = urlPath.slice(1);

    // Security: prevent directory traversal
    if (filename.includes("..") || filename.includes("~")) {
      return false;
    }

    // Only serve known static file extensions
    const ext = nodePath.extname(filename).toLowerCase();
    if (!MIME_TYPES[ext]) {
      return false;
    }

    const dashboardDir = this.getDashboardDir();
    const filePath = nodePath.join(dashboardDir, filename);

    // Check file exists and is within dashboard dir
    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] });
      res.end(content);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * GET /health - Health check endpoint
   */
  private async handleHealth(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const health = this.config.getHealth();
    const rpcHealth = this.config.rpcManager.getHealth();

    const response = {
      status: health.status,
      uptime: health.uptime,
      details: {
        daemon_running: `Running. Uptime: ${Math.floor(health.uptime / 1000)}s`,
        rpc: {
          connected: rpcHealth.connected,
          latencyMs: rpcHealth.latencyMs,
          errorRate: rpcHealth.errorRate,
        },
        tokens: {
          tracked: this.config.tokenManager.getTrackedTokens().length,
        },
      },
    };

    // Return 200 for healthy/degraded, 503 for unhealthy
    const statusCode = health.status === "unhealthy" ? 503 : 200;
    this.sendJson(res, statusCode, response);
  }

  /**
   * GET /health/sync - State synchronization health check
   * "Don't trust, verify" - Compares daemon state vs on-chain vault balance
   */
  private async handleHealthSync(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const syncStatus = await this.config.feeTracker.verifySyncStatus();
      const feeState = this.config.feeTracker.getState();

      const response = {
        inSync: syncStatus.inSync,
        vault: {
          balance: Number(syncStatus.vaultBalance) / Number(LAMPORTS_PER_SOL),
          balanceLamports: Number(syncStatus.vaultBalance),
        },
        daemon: {
          expectedPending: Number(syncStatus.expectedPending) / Number(LAMPORTS_PER_SOL),
          expectedPendingLamports: Number(syncStatus.expectedPending),
          processedSignatures: feeState.processedSignatures.size,
          lastProcessedSignature: feeState.lastProcessedSignature?.slice(0, 12),
        },
        analysis: {
          discrepancy: Number(syncStatus.discrepancy) / Number(LAMPORTS_PER_SOL),
          discrepancyLamports: Number(syncStatus.discrepancy),
          discrepancyPercent: syncStatus.discrepancyPercent,
          status: syncStatus.inSync ? "HEALTHY" : "DESYNC_DETECTED",
          recommendation: syncStatus.inSync
            ? "State is synchronized"
            : "Consider running reconciliation or restarting daemon",
        },
      };

      // Return 200 for in-sync, 409 for desync (conflict)
      const statusCode = syncStatus.inSync ? 200 : 409;
      this.sendJson(res, statusCode, response);
    } catch (error) {
      log.error("Failed to check sync status", { error: (error as Error).message });
      this.sendJson(res, 500, { error: "Failed to check sync status" });
    }
  }

  /**
   * GET /fees - Fee tracking data
   */
  private async handleFees(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const totals = this.config.feeTracker.getTotals();
    const stats = this.config.feeTracker.getStats();
    const records = this.config.feeTracker.getFeeRecords();

    const tokens: ApiTokenFee[] = records.map((r) => {
      const trackedToken = this.config.tokenManager.getToken(r.mint);
      return {
        mint: r.mint.toBase58(),
        symbol: r.symbol,
        name: trackedToken?.name || r.symbol,
        isRoot: trackedToken?.isRoot ?? false,
        pendingLamports: Number(r.pendingLamports),
        pendingSOL: r.pendingSOL,
      };
    });

    const response: ApiFeesResponse = {
      totals: {
        pendingLamports: Number(totals.pendingLamports),
        pendingSOL: totals.pendingSOL,
        tokenCount: totals.tokenCount,
      },
      daemon: {
        pollCount: stats.pollCount,
        errorRate: stats.errorRate,
        lastPollMs: stats.lastPollMs,
      },
      tokens,
    };

    this.sendJson(res, 200, response);
  }

  /**
   * GET /tokens - Token list
   */
  private async handleTokens(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const tokens = this.config.tokenManager.getTrackedTokens();

    const response = {
      count: tokens.length,
      tokens: tokens.map((t) => ({
        mint: t.mint.toBase58(),
        symbol: t.symbol,
        name: t.name,
        isRoot: t.isRoot,
        bondingCurve: t.bondingCurve.toBase58(),
        poolType: t.poolType,
        pendingFeesLamports: Number(t.pendingFeesLamports),
        totalCollectedLamports: Number(t.totalCollectedLamports),
        totalBurnedTokens: t.totalBurnedTokens.toString(),
        discoveredAt: t.discoveredAt,
      })),
    };

    this.sendJson(res, 200, response);
  }

  /**
   * GET /burns - Recent burn history
   */
  private async handleBurns(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "20", 10),
      100
    );

    if (!this.config.cycleManager) {
      this.sendJson(res, 200, { totalBurns: 0, recentBurns: [] });
      return;
    }

    const burns = this.config.cycleManager.getBurns(limit);
    const totalBurns = this.config.cycleManager.getTotalBurnsCount();

    const response = {
      totalBurns,
      recentBurns: burns.map((burn) => ({
        txSignature: burn.txSignature,
        amount: burn.amount,
        tokenSymbol: burn.tokenSymbol,
        tokenMint: burn.tokenMint,
        timestamp: burn.timestamp,
        network: burn.network,
        explorerUrl:
          burn.network === "mainnet"
            ? `https://explorer.solana.com/tx/${burn.txSignature}`
            : `https://explorer.solana.com/tx/${burn.txSignature}?cluster=devnet`,
      })),
    };

    this.sendJson(res, 200, response);
  }

  /**
   * GET /treasury - Root treasury info
   */
  private async handleTreasury(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const rootToken = this.config.tokenManager.getRootToken();
      const rootMint = rootToken?.mint || this.config.tokenManager.getRootTokenMint();

      if (!rootMint) {
        this.sendJson(res, 200, {
          treasury: {
            address: null,
            initialized: false,
            balance: { lamports: 0, sol: 0 },
            message: "No root token configured",
          },
        });
        return;
      }

      // Derive root treasury PDA: ["root_treasury", root_mint]
      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [ROOT_TREASURY_SEED, rootMint.toBuffer()],
        PROGRAM_ID
      );

      // Fetch balance via RPC
      const connection = this.config.rpcManager.getConnection();
      const balance = await this.config.rpcManager.execute(
        () => connection.getBalance(treasuryPda)
      );

      this.sendJson(res, 200, {
        treasury: {
          address: treasuryPda.toBase58(),
          initialized: balance > 0,
          balance: {
            lamports: balance,
            sol: Number(BigInt(balance) * 1000n / LAMPORTS_PER_SOL) / 1000,
          },
          rootToken: {
            mint: rootMint.toBase58(),
            symbol: rootToken?.symbol || "ROOT",
          },
        },
      });
    } catch (error) {
      log.error("Failed to fetch treasury", { error: (error as Error).message });
      this.sendJson(res, 500, { error: "Failed to fetch treasury info" });
    }
  }

  /**
   * GET /rebate-pool - Rebate pool info
   */
  private async handleRebatePool(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // Derive rebate pool PDA: ["rebate_pool"]
      const [rebatePoolPda] = PublicKey.findProgramAddressSync(
        [REBATE_POOL_SEED],
        PROGRAM_ID
      );

      // Fetch balance via RPC
      const connection = this.config.rpcManager.getConnection();
      const balance = await this.config.rpcManager.execute(
        () => connection.getBalance(rebatePoolPda)
      );

      this.sendJson(res, 200, {
        address: rebatePoolPda.toBase58(),
        initialized: balance > 0,
        balance: {
          lamports: balance,
          sol: Number(BigInt(balance) * 1000n / LAMPORTS_PER_SOL) / 1000,
        },
      });
    } catch (error) {
      log.error("Failed to fetch rebate pool", { error: (error as Error).message });
      this.sendJson(res, 500, { error: "Failed to fetch rebate pool info" });
    }
  }

  /**
   * GET /attestation - PoH chain attestation (cryptographic proof)
   */
  private async handleAttestation(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (!this.config.historyManager) {
      this.sendJson(res, 503, { error: "History manager not available" });
      return;
    }

    try {
      const attestation = this.config.historyManager.getAttestation();
      const metadata = this.config.historyManager.getMetadata();

      // Note: totalBurned not included - burns tracked on-chain with TX signatures
      this.sendJson(res, 200, {
        attestation: {
          latestHash: attestation.hash,
          sequence: attestation.sequence,
          timestamp: attestation.timestamp,
          totalFeesDetected: attestation.totalFeesDetected,
        },
        chain: {
          version: metadata.version,
          createdAt: metadata.createdAt,
          totalEntries: metadata.totalEntries,
        },
      });
    } catch (error) {
      log.error("Failed to get attestation", { error: (error as Error).message });
      this.sendJson(res, 500, { error: "Failed to get attestation" });
    }
  }

  /**
   * GET /history - Recent PoH entries
   * Query params: ?count=50&type=fee_detected
   */
  private async handleHistory(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    if (!this.config.historyManager) {
      this.sendJson(res, 503, { error: "History manager not available" });
      return;
    }

    try {
      const countParam = url.searchParams.get("count");
      const typeParam = url.searchParams.get("type");
      const count = countParam ? parseInt(countParam, 10) : 50;

      let entries;
      if (typeParam) {
        entries = this.config.historyManager.getEntriesByType(typeParam as any, count);
      } else {
        entries = this.config.historyManager.getRecentEntries(count);
      }

      this.sendJson(res, 200, {
        count: entries.length,
        entries,
      });
    } catch (error) {
      log.error("Failed to get history", { error: (error as Error).message });
      this.sendJson(res, 500, { error: "Failed to get history" });
    }
  }

  /**
   * POST /flush - Trigger manual fee flush
   */
  private async handleFlush(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (!this.config.cycleManager) {
      this.sendJson(res, 503, { error: "Cycle manager not available" });
      return;
    }

    try {
      const result = await this.config.cycleManager.forceFlush();
      this.sendJson(res, 200, {
        success: true,
        flushed: result.flushed,
        errors: result.errors,
      });
    } catch (error) {
      this.sendJson(res, 500, {
        success: false,
        error: (error as Error).message,
      });
    }
  }

  /**
   * POST /cycle - Execute a flush cycle
   */
  private async handleCycle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (!this.config.cycleManager) {
      this.sendJson(res, 503, { error: "Cycle manager not available" });
      return;
    }

    try {
      const result = await this.config.cycleManager.executeCycle();
      this.sendJson(res, 200, {
        success: result.success,
        cycleId: result.cycleId,
        totalFlushedSOL: Number(result.totalFlushedLamports) / Number(LAMPORTS_PER_SOL),
        totalBurnedTokens: result.totalBurnedTokens.toString(),
        tokenResults: result.tokenResults.map(r => ({
          mint: r.mint.toBase58(),
          symbol: r.symbol,
          flushedSOL: Number(r.flushedLamports) / Number(LAMPORTS_PER_SOL),
          burnedTokens: r.burnedTokens.toString(),
          burnSignature: r.burnSignature,
          error: r.error,
        })),
        errors: result.errors,
      });
    } catch (error) {
      this.sendJson(res, 500, {
        success: false,
        error: (error as Error).message,
      });
    }
  }

  /**
   * GET /cycle/status - Get cycle readiness status
   */
  private async handleCycleStatus(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (!this.config.cycleManager) {
      this.sendJson(res, 503, { error: "Cycle manager not available" });
      return;
    }

    try {
      const readiness = await this.config.cycleManager.checkCycleReadiness();
      const stats = this.config.cycleManager.getStats();

      this.sendJson(res, 200, {
        ready: readiness.ready,
        reason: readiness.reason,
        eligibleTokens: readiness.eligibleTokens.map(t => ({
          mint: t.mint.toBase58(),
          symbol: t.symbol,
          pendingSOL: Number(t.pendingFeesLamports) / Number(LAMPORTS_PER_SOL),
        })),
        totalPendingSOL: Number(readiness.totalPending) / Number(LAMPORTS_PER_SOL),
        stats: {
          cycleCount: stats.cycleCount,
          lastCycleAt: stats.lastCycleAt,
          timeSinceLastCycle: stats.timeSinceLastCycle,
        },
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  // ============================================================
  // TEST/MOCK ENDPOINTS - For dashboard testing without real tokens
  // ============================================================

  /**
   * Parse JSON body from request
   */
  private async parseBody<T>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(body || "{}") as T);
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  /**
   * POST /test/add-token - Add a mock token
   */
  private async handleTestAddToken(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{
        symbol: string;
        name?: string;
        isRoot?: boolean;
      }>(req);

      if (!body.symbol) {
        this.sendJson(res, 400, { error: "symbol required" });
        return;
      }

      // Generate mock data
      const mockMint = this.generateMockPubkey();
      const mockBondingCurve = this.generateMockPubkey();

      // Add to mock store
      const token = {
        mint: mockMint,
        symbol: body.symbol.toUpperCase(),
        name: body.name || `${body.symbol} Token`,
        isRoot: body.isRoot || false,
        bondingCurve: mockBondingCurve,
        poolType: "bonding_curve",
        pendingFeesLamports: 0,
        totalCollectedLamports: 0,
        totalBurnedTokens: "0",
        discoveredAt: Date.now(),
      };

      this.mockTokens.set(mockMint, token);

      // Broadcast via WebSocket if available
      if (this.config.wsServer) {
        this.config.wsServer.broadcast({
          type: "token_discovered",
          data: token,
        });
      }

      log.info("Mock token added", { symbol: body.symbol, mint: mockMint });
      this.sendJson(res, 200, { success: true, token });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /test/add-fee - Add mock fee to a token
   */
  private async handleTestAddFee(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{
        mint: string;
        amountSOL: number;
      }>(req);

      if (!body.mint || !body.amountSOL) {
        this.sendJson(res, 400, { error: "mint and amountSOL required" });
        return;
      }

      const token = this.mockTokens.get(body.mint);
      if (!token) {
        this.sendJson(res, 404, { error: "Token not found" });
        return;
      }

      const amountLamports = Math.floor(body.amountSOL * 1e9);
      token.pendingFeesLamports += amountLamports;

      // Create fee event
      const feeEvent = {
        type: "fee_detected",
        data: {
          mint: body.mint,
          symbol: token.symbol,
          amountLamports,
          amountSOL: body.amountSOL,
          timestamp: Date.now(),
          signature: this.generateMockSignature(),
        },
      };

      // Broadcast via WebSocket
      if (this.config.wsServer) {
        this.config.wsServer.broadcast(feeEvent);
      }

      log.info("Mock fee added", { symbol: token.symbol, amountSOL: body.amountSOL });
      this.sendJson(res, 200, { success: true, event: feeEvent });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /test/simulate-burn - Simulate a burn for a token
   */
  private async handleTestSimulateBurn(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{ mint: string }>(req);

      if (!body.mint) {
        this.sendJson(res, 400, { error: "mint required" });
        return;
      }

      const token = this.mockTokens.get(body.mint);
      if (!token) {
        this.sendJson(res, 404, { error: "Token not found" });
        return;
      }

      const burnedLamports = token.pendingFeesLamports;
      const burnedTokens = Math.floor(burnedLamports * 1000); // Mock conversion

      // Update token stats
      token.totalCollectedLamports += burnedLamports;
      token.totalBurnedTokens = (BigInt(token.totalBurnedTokens) + BigInt(burnedTokens)).toString();
      token.pendingFeesLamports = 0;

      // Create burn event
      const burnEvent = {
        type: "burn_executed",
        data: {
          mint: body.mint,
          symbol: token.symbol,
          burnedLamports,
          burnedSOL: burnedLamports / 1e9,
          burnedTokens: burnedTokens.toString(),
          signature: this.generateMockSignature(),
          timestamp: Date.now(),
        },
      };

      // Add to burns history
      this.mockBurns.unshift(burnEvent.data);
      if (this.mockBurns.length > 50) this.mockBurns.pop();

      // Broadcast via WebSocket
      if (this.config.wsServer) {
        this.config.wsServer.broadcast(burnEvent);
      }

      log.info("Mock burn executed", { symbol: token.symbol, burnedSOL: burnedLamports / 1e9 });
      this.sendJson(res, 200, { success: true, burn: burnEvent.data });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /test/clear - Clear all mock data
   */
  private async handleTestClear(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    this.mockTokens.clear();
    this.mockBurns.length = 0;

    // Broadcast reset
    if (this.config.wsServer) {
      this.config.wsServer.broadcast({ type: "test_reset", data: {} });
    }

    log.info("Mock data cleared");
    this.sendJson(res, 200, { success: true, message: "All mock data cleared" });
  }

  /**
   * POST /test/scenario - Load a predefined test scenario
   */
  private async handleTestScenario(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{ scenario: string }>(req);

      // Clear existing data
      this.mockTokens.clear();
      this.mockBurns.length = 0;

      switch (body.scenario) {
        case "healthy":
          await this.loadHealthyScenario();
          break;
        case "pending":
          await this.loadHighPendingScenario();
          break;
        case "active":
          await this.loadActiveScenario();
          break;
        default:
          this.sendJson(res, 400, { error: "Unknown scenario" });
          return;
      }

      // Broadcast scenario loaded
      if (this.config.wsServer) {
        this.config.wsServer.broadcast({
          type: "scenario_loaded",
          data: { scenario: body.scenario, tokens: this.mockTokens.size },
        });
      }

      log.info("Test scenario loaded", { scenario: body.scenario });
      this.sendJson(res, 200, {
        success: true,
        scenario: body.scenario,
        tokens: Array.from(this.mockTokens.values()),
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  // Test scenario helpers
  private async loadHealthyScenario(): Promise<void> {
    // Root token with some accumulated fees
    this.addMockToken("ASDF", true, 0.5);
    // Secondary tokens with varying fees
    this.addMockToken("S1", false, 0.15);
    this.addMockToken("S2", false, 0.08);
    this.addMockToken("S3", false, 0.03);
  }

  private async loadHighPendingScenario(): Promise<void> {
    // Root token with high pending
    this.addMockToken("ASDF", true, 2.5);
    // Secondary tokens with high pending
    this.addMockToken("HOT1", false, 1.2);
    this.addMockToken("HOT2", false, 0.8);
    this.addMockToken("HOT3", false, 0.6);
    this.addMockToken("HOT4", false, 0.4);
  }

  private async loadActiveScenario(): Promise<void> {
    // Simulate active trading with many tokens
    this.addMockToken("ASDF", true, 0.1);
    for (let i = 1; i <= 8; i++) {
      this.addMockToken(`TKN${i}`, false, Math.random() * 0.3);
    }
  }

  private addMockToken(symbol: string, isRoot: boolean, pendingSOL: number): void {
    const mint = this.generateMockPubkey();
    this.mockTokens.set(mint, {
      mint,
      symbol,
      name: `${symbol} Token`,
      isRoot,
      bondingCurve: this.generateMockPubkey(),
      poolType: "bonding_curve",
      pendingFeesLamports: Math.floor(pendingSOL * 1e9),
      totalCollectedLamports: Math.floor(Math.random() * 5 * 1e9),
      totalBurnedTokens: Math.floor(Math.random() * 1e12).toString(),
      discoveredAt: Date.now() - Math.floor(Math.random() * 86400000),
    });
  }

  private generateMockPubkey(): string {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let result = "";
    for (let i = 0; i < 44; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private generateMockSignature(): string {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let result = "";
    for (let i = 0; i < 88; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Mock data stores
  private mockTokens: Map<string, any> = new Map();
  private mockBurns: any[] = [];

  /**
   * Get combined tokens (real + mock)
   */
  private getCombinedTokens(): any[] {
    const realTokens = this.config.tokenManager
      ? this.config.tokenManager.getTrackedTokens().map((t) => ({
          mint: t.mint.toBase58(),
          symbol: t.symbol,
          name: t.name,
          isRoot: t.isRoot,
          bondingCurve: t.bondingCurve.toBase58(),
          poolType: t.poolType,
          pendingFeesLamports: Number(t.pendingFeesLamports),
          totalCollectedLamports: Number(t.totalCollectedLamports),
          totalBurnedTokens: t.totalBurnedTokens.toString(),
          discoveredAt: t.discoveredAt,
        }))
      : [];

    const mockTokensArray = Array.from(this.mockTokens.values());
    return [...realTokens, ...mockTokensArray];
  }

  // ============================================================
  // REAL CONTROL PANEL - Execute actual scripts (devnet only)
  // ============================================================

  /**
   * GET /control/tokens - List available tokens for control panel
   * First tries local devnet-tokens files, then falls back to daemon tracked tokens
   */
  private async handleControlTokens(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // First try local files
      let tokens = ControlPanel.listDevnetTokens();

      // If no local files, use daemon tracked tokens
      if (tokens.length === 0 && this.config.tokenManager) {
        const trackedTokens = this.config.tokenManager.getTrackedTokens();
        tokens = trackedTokens.map((t) => ({
          mint: t.mint.toBase58(),
          bondingCurve: t.bondingCurve.toBase58(),
          creator: "", // Will be fetched when needed
          name: t.name,
          symbol: t.symbol,
          isRoot: t.isRoot,
          tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          poolType: t.poolType,
          network: "devnet",
          _file: `${t.symbol.toLowerCase()}-daemon.json`, // Virtual file marker
          _fromDaemon: true,
        }));
      }

      this.sendJson(res, 200, {
        success: true,
        count: tokens.length,
        tokens,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * GET /control/wallet - Get wallet balance
   */
  private async handleControlWallet(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const wallet = await ControlPanel.getWalletBalance();
      this.sendJson(res, 200, {
        success: true,
        wallet,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * GET /control/fees?creator=xxx&rootMint=xxx - Check fees
   */
  private async handleControlFees(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const creator = url.searchParams.get("creator");
      const rootMint = url.searchParams.get("rootMint") || undefined;

      if (!creator) {
        this.sendJson(res, 400, { error: "creator parameter required" });
        return;
      }

      const fees = await ControlPanel.checkFees(creator, rootMint);
      this.sendJson(res, 200, { success: true, ...fees });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /control/volume - Generate volume on a token
   * Body: { tokenFile, numBuys?, buyAmount? }
   */
  private async handleControlVolume(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{
        tokenFile: string;
        numBuys?: number;
        buyAmount?: number;
      }>(req);

      if (!body.tokenFile) {
        this.sendJson(res, 400, { error: "tokenFile required" });
        return;
      }

      log.info("Generating volume", { tokenFile: body.tokenFile, numBuys: body.numBuys });

      const result = await ControlPanel.generateVolume(
        body.tokenFile,
        body.numBuys || 2,
        body.buyAmount || 0.5
      );

      this.sendJson(res, result.success ? 200 : 500, {
        success: result.success,
        output: result.output,
        error: result.error,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /control/sell - Sell tokens
   * Body: { tokenFile }
   */
  private async handleControlSell(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{ tokenFile: string }>(req);

      if (!body.tokenFile) {
        this.sendJson(res, 400, { error: "tokenFile required" });
        return;
      }

      log.info("Selling tokens", { tokenFile: body.tokenFile });

      const result = await ControlPanel.sellTokens(body.tokenFile);

      this.sendJson(res, result.success ? 200 : 500, {
        success: result.success,
        output: result.output,
        error: result.error,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /control/cycle - Execute burn cycle
   * Body: { tokenFile, network? }
   */
  private async handleControlCycle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{
        tokenFile: string;
        network?: string;
      }>(req);

      if (!body.tokenFile) {
        this.sendJson(res, 400, { error: "tokenFile required" });
        return;
      }

      log.info("Executing cycle", { tokenFile: body.tokenFile });

      const result = await ControlPanel.executeCycle(
        body.tokenFile,
        body.network || "devnet"
      );

      this.sendJson(res, result.success ? 200 : 500, {
        success: result.success,
        output: result.output,
        error: result.error,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /control/workflow - Run full E2E workflow
   * Body: { tokenFile, cycles?, solPerCycle?, waitMs? }
   */
  private async handleControlWorkflow(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{
        tokenFile: string;
        cycles?: number;
        solPerCycle?: number;
        waitMs?: number;
      }>(req);

      if (!body.tokenFile) {
        this.sendJson(res, 400, { error: "tokenFile required" });
        return;
      }

      log.info("Running full workflow", { tokenFile: body.tokenFile });

      const result = await ControlPanel.runFullWorkflow(body.tokenFile, {
        cycles: body.cycles,
        solPerCycle: body.solPerCycle,
        waitMs: body.waitMs,
      });

      this.sendJson(res, result.success ? 200 : 500, {
        success: result.success,
        steps: result.steps,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /control/create-token - Create a new token
   * Body: { name, symbol, isRoot?, mayhemMode? }
   */
  private async handleControlCreateToken(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{
        name: string;
        symbol: string;
        isRoot?: boolean;
        mayhemMode?: boolean;
      }>(req);

      if (!body.name || !body.symbol) {
        this.sendJson(res, 400, { error: "name and symbol required" });
        return;
      }

      log.info("Creating token", { name: body.name, symbol: body.symbol, isRoot: body.isRoot });

      const result = await ControlPanel.createToken(
        body.name,
        body.symbol,
        body.isRoot || false,
        body.mayhemMode || false
      );

      this.sendJson(res, result.success ? 200 : 500, {
        success: result.success,
        token: result.token,
        output: result.output,
        error: result.error,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /control/init-token-stats - Initialize TokenStats on-chain
   * Body: { tokenFile }
   */
  private async handleControlInitTokenStats(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{ tokenFile: string }>(req);

      if (!body.tokenFile) {
        this.sendJson(res, 400, { error: "tokenFile required" });
        return;
      }

      log.info("Initializing TokenStats", { tokenFile: body.tokenFile });

      const result = await ControlPanel.initTokenStats(body.tokenFile);

      this.sendJson(res, result.success ? 200 : 500, {
        success: result.success,
        output: result.output,
        error: result.error,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /control/set-root-token - Set a token as root
   * Body: { tokenFile }
   */
  private async handleControlSetRootToken(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{ tokenFile: string }>(req);

      if (!body.tokenFile) {
        this.sendJson(res, 400, { error: "tokenFile required" });
        return;
      }

      log.info("Setting root token", { tokenFile: body.tokenFile });

      const result = await ControlPanel.setRootToken(body.tokenFile);

      this.sendJson(res, result.success ? 200 : 500, {
        success: result.success,
        output: result.output,
        error: result.error,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * POST /control/sync-fees - Sync fees (trigger daemon flush or check on-chain)
   * Body: { tokenFile?, network? }
   */
  private async handleControlSyncFees(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await this.parseBody<{
        tokenFile?: string;
        network?: string;
      }>(req);

      log.info("Syncing fees", { tokenFile: body.tokenFile });

      const result = await ControlPanel.syncFees(
        body.tokenFile,
        body.network || "devnet"
      );

      this.sendJson(res, result.success ? 200 : 500, {
        success: result.success,
        output: result.output,
        error: result.error,
      });
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * Send JSON response
   */
  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    data: unknown
  ): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}
