/**
 * ASDF Burn Engine WebSocket Server
 *
 * Real-time updates for dashboard connections.
 * - Broadcast fee updates
 * - Burn notifications
 * - Token discovery events
 */

import * as http from "http";
import * as WebSocket from "ws";
import { createLogger } from "../utils/logger";
import { WsEvent, WsEventType, FeeTotals, FeeRecord } from "../types";

const log = createLogger("ws");

// Heartbeat interval
const HEARTBEAT_INTERVAL = 30000;
const CLIENT_TIMEOUT = 60000;

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  subscribedChannels: Set<string>;
}

export interface WsServerConfig {
  port: number;
}

export class WebSocketServer {
  private wss: WebSocket.Server | null = null;
  private httpServer: http.Server | null = null;
  private clients: Set<ExtendedWebSocket> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private config: WsServerConfig;

  constructor(config: WsServerConfig) {
    this.config = config;
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer();

      this.wss = new WebSocket.Server({ server: this.httpServer });

      this.wss.on("connection", (ws: WebSocket) => {
        this.handleConnection(ws as ExtendedWebSocket);
      });

      this.wss.on("error", (error) => {
        log.error("WebSocket server error", { error: error.message });
        reject(error);
      });

      this.httpServer.listen(this.config.port, () => {
        log.info("WebSocket server started", { port: this.config.port });
        this.startHeartbeat();
        resolve();
      });
    });
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      // Close all client connections
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();

      if (this.wss) {
        this.wss.close(() => {
          if (this.httpServer) {
            this.httpServer.close(() => {
              log.info("WebSocket server stopped");
              resolve();
            });
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: ExtendedWebSocket): void {
    ws.isAlive = true;
    ws.subscribedChannels = new Set(["all"]);

    this.clients.add(ws);
    log.debug("Client connected", { clients: this.clients.size });

    // Send welcome message
    this.sendToClient(ws, {
      type: "welcome",
      timestamp: Date.now(),
      data: {
        message: "Connected to ASDF Burn Engine daemon",
        channels: Array.from(ws.subscribedChannels),
      },
    });

    // Handle messages
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(ws, message);
      } catch (error) {
        log.debug("Invalid message from client", {
          error: (error as Error).message,
        });
      }
    });

    // Handle pong (heartbeat response)
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // Handle close
    ws.on("close", () => {
      this.clients.delete(ws);
      log.debug("Client disconnected", { clients: this.clients.size });
    });

    // Handle error
    ws.on("error", (error) => {
      log.debug("Client error", { error: error.message });
      this.clients.delete(ws);
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(
    ws: ExtendedWebSocket,
    message: { action: string; channel?: string }
  ): void {
    switch (message.action) {
      case "subscribe":
        if (message.channel) {
          ws.subscribedChannels.add(message.channel);
          this.sendToClient(ws, {
            type: "welcome",
            timestamp: Date.now(),
            data: {
              action: "subscribed",
              channel: message.channel,
            },
          });
        }
        break;

      case "unsubscribe":
        if (message.channel) {
          ws.subscribedChannels.delete(message.channel);
        }
        break;

      case "ping":
        this.sendToClient(ws, {
          type: "welcome",
          timestamp: Date.now(),
          data: { pong: true },
        });
        break;
    }
  }

  /**
   * Start heartbeat to detect dead connections
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.clients) {
        if (!ws.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Send message to specific client
   */
  private sendToClient(ws: ExtendedWebSocket, event: WsEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /**
   * Broadcast to all subscribed clients
   */
  broadcast(event: WsEvent, channel: string = "all"): void {
    const message = JSON.stringify(event);

    for (const client of this.clients) {
      if (
        client.readyState === WebSocket.OPEN &&
        (client.subscribedChannels.has(channel) ||
          client.subscribedChannels.has("all"))
      ) {
        client.send(message);
      }
    }
  }

  /**
   * Broadcast fee update
   */
  broadcastFees(totals: FeeTotals, tokens: FeeRecord[]): void {
    this.broadcast(
      {
        type: "fees",
        timestamp: Date.now(),
        data: {
          totals: {
            pendingLamports: Number(totals.pendingLamports),
            pendingSOL: totals.pendingSOL,
            tokenCount: totals.tokenCount,
          },
          tokens: tokens.map((t) => ({
            mint: t.mint.toBase58(),
            symbol: t.symbol,
            pendingLamports: Number(t.pendingLamports),
            pendingSOL: t.pendingSOL,
          })),
        },
      },
      "fees"
    );
  }

  /**
   * Broadcast burn event
   */
  broadcastBurn(
    mint: string,
    symbol: string,
    amountBurned: number,
    signature: string
  ): void {
    this.broadcast(
      {
        type: "burn",
        timestamp: Date.now(),
        data: {
          mint,
          symbol,
          amountBurned,
          signature,
        },
      },
      "burns"
    );
  }

  /**
   * Broadcast token discovery
   */
  broadcastTokenDiscovered(mint: string, symbol: string): void {
    this.broadcast(
      {
        type: "token_discovered",
        timestamp: Date.now(),
        data: { mint, symbol },
      },
      "tokens"
    );
  }

  /**
   * Broadcast cycle start
   */
  broadcastCycleStart(data: {
    cycleId: string;
    tokenCount: number;
    totalPendingSOL: number;
  }): void {
    this.broadcast(
      {
        type: "cycle_start",
        timestamp: Date.now(),
        data,
      },
      "cycles"
    );
  }

  /**
   * Broadcast cycle completion
   */
  broadcastCycleComplete(result: {
    success: boolean;
    cycleId: string;
    totalFlushedLamports: bigint;
    totalBurnedTokens: bigint;
    tokenResults: Array<{ mint: string | { toBase58(): string }; symbol: string; flushedLamports: bigint; burnedTokens: bigint }>;
  }): void {
    this.broadcast(
      {
        type: "cycle_complete",
        timestamp: Date.now(),
        data: {
          success: result.success,
          cycleId: result.cycleId,
          totalFlushedSOL: Number(result.totalFlushedLamports) / 1e9,
          totalBurnedTokens: Number(result.totalBurnedTokens),
          tokenResults: result.tokenResults.map((t) => ({
            mint: typeof t.mint === "string" ? t.mint : t.mint.toBase58(),
            symbol: t.symbol,
            flushedSOL: Number(t.flushedLamports) / 1e9,
            burnedTokens: Number(t.burnedTokens),
          })),
        },
      },
      "cycles"
    );
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
