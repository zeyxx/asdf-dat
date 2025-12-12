/**
 * WebSocket Manager for Solana RPC Subscriptions
 *
 * Real-time fee detection via account change subscriptions.
 * Inspired by asdf-validator - ~400ms latency vs 30s polling.
 *
 * Features:
 * - Account change subscriptions for vault monitoring
 * - Automatic reconnection with exponential backoff
 * - Subscription persistence across reconnects
 * - Event-based architecture for integration
 */

import { Connection, PublicKey, AccountChangeCallback, Context } from "@solana/web3.js";
import { EventEmitter } from "events";
import { createLogger, Logger } from "./logger";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface AccountUpdate {
  pubkey: PublicKey;
  lamports: number;
  slot: number;
  timestamp: number;
}

export interface SubscriptionInfo {
  pubkey: PublicKey;
  subscriptionId: number;
  callback: (update: AccountUpdate) => void;
}

export interface WebSocketManagerConfig {
  connection: Connection;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  verbose?: boolean;
}

export class WebSocketManager extends EventEmitter {
  private connection: Connection;
  private state: ConnectionState = "disconnected";
  private subscriptions: Map<string, SubscriptionInfo> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectDelayMs: number;
  private maxReconnectDelayMs: number;
  private logger: Logger;
  private verbose: boolean;
  private isShuttingDown = false;

  constructor(config: WebSocketManagerConfig) {
    super();
    this.connection = config.connection;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = config.maxReconnectDelayMs ?? 30000;
    this.verbose = config.verbose ?? false;
    this.logger = createLogger("ws-manager", {
      level: this.verbose ? "debug" : "info",
      console: true,
    });
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get number of active subscriptions
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Subscribe to account changes for a vault
   * Returns subscription ID or null if already subscribed
   */
  async subscribeToAccount(
    pubkey: PublicKey,
    callback: (update: AccountUpdate) => void
  ): Promise<number | null> {
    const key = pubkey.toBase58();

    // Deduplicate subscriptions
    if (this.subscriptions.has(key)) {
      this.logger.debug(`Already subscribed to ${key.slice(0, 8)}...`);
      return this.subscriptions.get(key)!.subscriptionId;
    }

    try {
      this.state = "connecting";

      // Create wrapper that enriches updates with metadata
      const wrappedCallback: AccountChangeCallback = (accountInfo, context: Context) => {
        const update: AccountUpdate = {
          pubkey,
          lamports: accountInfo.lamports,
          slot: context.slot,
          timestamp: Date.now(),
        };

        try {
          callback(update);
        } catch (err: any) {
          this.logger.error(`Callback error for ${key.slice(0, 8)}...`, { error: err.message });
        }
      };

      const subscriptionId = this.connection.onAccountChange(
        pubkey,
        wrappedCallback,
        "confirmed"
      );

      this.subscriptions.set(key, {
        pubkey,
        subscriptionId,
        callback,
      });

      this.state = "connected";
      this.reconnectAttempts = 0;

      this.logger.info(`Subscribed to ${key.slice(0, 8)}...`, { subscriptionId });
      this.emit("subscribed", { pubkey, subscriptionId });

      return subscriptionId;
    } catch (err: any) {
      this.logger.error(`Failed to subscribe to ${key.slice(0, 8)}...`, { error: err.message });
      this.emit("error", err);
      await this.handleReconnect();
      return null;
    }
  }

  /**
   * Unsubscribe from account changes
   */
  async unsubscribe(pubkey: PublicKey): Promise<boolean> {
    const key = pubkey.toBase58();
    const sub = this.subscriptions.get(key);

    if (!sub) {
      return false;
    }

    try {
      await this.connection.removeAccountChangeListener(sub.subscriptionId);
      this.subscriptions.delete(key);
      this.logger.info(`Unsubscribed from ${key.slice(0, 8)}...`);
      this.emit("unsubscribed", { pubkey });
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to unsubscribe from ${key.slice(0, 8)}...`, { error: err.message });
      return false;
    }
  }

  /**
   * Resubscribe all accounts after reconnection
   */
  private async resubscribeAll(): Promise<void> {
    this.logger.info(`Resubscribing to ${this.subscriptions.size} accounts...`);

    const entries = Array.from(this.subscriptions.entries());
    let success = 0;
    let failed = 0;

    for (const [key, sub] of entries) {
      try {
        // Remove old subscription
        this.subscriptions.delete(key);

        // Create new subscription with same callback
        const wrappedCallback: AccountChangeCallback = (accountInfo, context: Context) => {
          const update: AccountUpdate = {
            pubkey: sub.pubkey,
            lamports: accountInfo.lamports,
            slot: context.slot,
            timestamp: Date.now(),
          };

          try {
            sub.callback(update);
          } catch (err: any) {
            this.logger.error(`Callback error for ${key.slice(0, 8)}...`, { error: err.message });
          }
        };

        const subscriptionId = this.connection.onAccountChange(
          sub.pubkey,
          wrappedCallback,
          "confirmed"
        );

        this.subscriptions.set(key, {
          pubkey: sub.pubkey,
          subscriptionId,
          callback: sub.callback,
        });

        success++;
      } catch (err: any) {
        this.logger.error(`Failed to resubscribe ${key.slice(0, 8)}...`, { error: err.message });
        failed++;
      }
    }

    this.logger.info(`Resubscription complete`, { success, failed });
    this.emit("resubscribed", { success, failed });
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private async handleReconnect(): Promise<void> {
    if (this.isShuttingDown) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error("Max reconnection attempts reached");
      this.state = "disconnected";
      this.emit("disconnected", { reason: "max_attempts" });
      return;
    }

    this.state = "reconnecting";
    this.reconnectAttempts++;

    // Exponential backoff with cap
    const delay = Math.min(
      this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelayMs
    );

    this.logger.info(`Reconnecting in ${delay}ms...`, { attempt: this.reconnectAttempts });
    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (this.isShuttingDown) return;

    try {
      await this.resubscribeAll();
      this.state = "connected";
      this.reconnectAttempts = 0;
      this.emit("connected");
    } catch (err: any) {
      this.logger.error("Reconnection failed", { error: err.message });
      await this.handleReconnect();
    }
  }

  /**
   * Graceful shutdown - unsubscribe all
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Shutting down WebSocket manager...");

    for (const [key, sub] of this.subscriptions.entries()) {
      try {
        await this.connection.removeAccountChangeListener(sub.subscriptionId);
        this.logger.debug(`Unsubscribed ${key.slice(0, 8)}...`);
      } catch (err: any) {
        this.logger.warn(`Error unsubscribing ${key.slice(0, 8)}...`, { error: err.message });
      }
    }

    this.subscriptions.clear();
    this.state = "disconnected";
    this.emit("shutdown");
    this.logger.info("WebSocket manager shutdown complete");
  }

  /**
   * Get all subscribed pubkeys
   */
  getSubscribedAccounts(): PublicKey[] {
    return Array.from(this.subscriptions.values()).map((s) => s.pubkey);
  }
}

/**
 * Factory function to create a vault monitor
 * Simplifies setup for monitoring specific vault accounts
 */
export function createVaultMonitor(
  connection: Connection,
  vaults: PublicKey[],
  onUpdate: (update: AccountUpdate) => void,
  options?: Partial<WebSocketManagerConfig>
): WebSocketManager {
  const manager = new WebSocketManager({
    connection,
    ...options,
  });

  // Subscribe to all vaults
  for (const vault of vaults) {
    manager.subscribeToAccount(vault, onUpdate).catch((err) => {
      console.error(`Failed to subscribe to vault ${vault.toBase58().slice(0, 8)}...`, err);
    });
  }

  return manager;
}
