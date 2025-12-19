/**
 * Helius Integration Module
 *
 * Enhanced RPC and transaction parsing via Helius APIs.
 * Uses direct API calls (no SDK) for better compatibility.
 *
 * Features:
 * - Enhanced transaction parsing (pre-parsed fee, transfers)
 * - Historical backfill with pagination
 * - Priority fee estimates
 *
 * THIS IS FINE 🔥
 */

import { PublicKey } from "@solana/web3.js";
import { createLogger } from "../utils/logger";

const log = createLogger("helius");

// Helius API endpoints
const HELIUS_API_BASE = "https://api.helius.xyz";

export interface HeliusConfig {
  apiKey: string;
  network?: "devnet" | "mainnet-beta";
}

export interface ParsedFeeEvent {
  signature: string;
  fee: number;
  feePayer: string;
  slot: number;
  timestamp: number;
  tokenTransfers: Array<{
    mint: string;
    fromAccount: string;
    toAccount: string;
    amount: number;
  }>;
}

export interface BackfillResult {
  transactions: ParsedFeeEvent[];
  paginationToken: string | null;
  hasMore: boolean;
}

/**
 * Helius client wrapper for ASDF Burn Engine
 * Uses direct API calls for compatibility
 */
export class HeliusClient {
  private apiKey: string;
  private network: "devnet" | "mainnet-beta";
  private rpcUrl: string;

  constructor(config: HeliusConfig) {
    this.apiKey = config.apiKey;
    this.network = config.network || "devnet";
    this.rpcUrl = `https://${this.network}.helius-rpc.com/?api-key=${this.apiKey}`;
    log.info("Helius client initialized", { network: this.network });
  }

  /**
   * Make RPC call to Helius
   */
  private async rpcCall<T>(method: string, params: any[]): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.status}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`RPC error: ${json.error.message}`);
    }

    return json.result;
  }

  /**
   * Parse transactions with Helius Enhanced Transactions API
   * Returns pre-parsed fee data, token transfers, etc.
   */
  async parseTransactions(signatures: string[]): Promise<ParsedFeeEvent[]> {
    if (signatures.length === 0) return [];

    try {
      const response = await fetch(
        `${HELIUS_API_BASE}/v0/transactions?api-key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: signatures }),
        }
      );

      if (!response.ok) {
        throw new Error(`Parse API failed: ${response.status}`);
      }

      const data = await response.json();

      return data.map((tx: any) => ({
        signature: tx.signature,
        fee: tx.fee || 0,
        feePayer: tx.feePayer || "",
        slot: tx.slot || 0,
        timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
        tokenTransfers: (tx.tokenTransfers || []).map((t: any) => ({
          mint: t.mint || "",
          fromAccount: t.fromUserAccount || "",
          toAccount: t.toUserAccount || "",
          amount: t.tokenAmount || 0,
        })),
      }));
    } catch (error) {
      log.error("Failed to parse transactions via Helius", {
        error: (error as Error).message,
        count: signatures.length,
      });
      return [];
    }
  }

  /**
   * Get signatures for address (standard RPC via Helius)
   */
  async getSignaturesForAddress(
    address: string | PublicKey,
    options?: { limit?: number; before?: string }
  ): Promise<Array<{ signature: string; slot: number; blockTime: number | null }>> {
    const addressStr = typeof address === "string" ? address : address.toBase58();

    try {
      const result = await this.rpcCall<any[]>("getSignaturesForAddress", [
        addressStr,
        {
          limit: options?.limit || 100,
          before: options?.before,
        },
      ]);

      return result.map((sig: any) => ({
        signature: sig.signature,
        slot: sig.slot,
        blockTime: sig.blockTime,
      }));
    } catch (error) {
      log.error("Failed to get signatures", {
        error: (error as Error).message,
        address: addressStr,
      });
      return [];
    }
  }

  /**
   * Get historical transactions for an address with pagination
   * Useful for crash recovery and backfill
   */
  async getTransactionsForAddress(
    address: string | PublicKey,
    options?: {
      limit?: number;
      before?: string;
    }
  ): Promise<BackfillResult> {
    const signatures = await this.getSignaturesForAddress(address, options);

    if (signatures.length === 0) {
      return { transactions: [], paginationToken: null, hasMore: false };
    }

    // Parse the signatures we got
    const sigStrings = signatures.map((s) => s.signature);
    const parsed = await this.parseTransactions(sigStrings);

    // Determine if there's more data
    const hasMore = signatures.length === (options?.limit || 100);
    const lastSig = signatures.length > 0 ? signatures[signatures.length - 1].signature : null;

    return {
      transactions: parsed,
      paginationToken: lastSig,
      hasMore,
    };
  }

  /**
   * Get priority fee estimate for transaction
   */
  async getPriorityFeeEstimate(
    accountKeys: string[],
    priorityLevel: "Min" | "Low" | "Medium" | "High" | "VeryHigh" = "Medium"
  ): Promise<number> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "getPriorityFeeEstimate",
          params: [
            {
              accountKeys,
              options: { priorityLevel },
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Priority fee API failed: ${response.status}`);
      }

      const json = await response.json();
      return json.result?.priorityFeeEstimate || 50000;
    } catch (error) {
      log.warn("Failed to get priority fee estimate, using default", {
        error: (error as Error).message,
      });
      return 50000; // Default 50k microlamports
    }
  }

  /**
   * Backfill all missed transactions since a given signature
   * Handles pagination automatically
   */
  async backfillFromSignature(
    address: string | PublicKey,
    sinceSignature?: string,
    options?: { maxTransactions?: number }
  ): Promise<ParsedFeeEvent[]> {
    const allTransactions: ParsedFeeEvent[] = [];
    const maxTx = options?.maxTransactions || 1000;
    let paginationToken: string | undefined = undefined;

    log.info("Starting backfill", {
      address: typeof address === "string" ? address : address.toBase58(),
      sinceSignature: sinceSignature?.slice(0, 12),
      maxTransactions: maxTx,
    });

    while (allTransactions.length < maxTx) {
      const result = await this.getTransactionsForAddress(address, {
        limit: 100,
        before: paginationToken,
      });

      if (result.transactions.length === 0) break;

      // Check if we've reached the target signature
      for (const tx of result.transactions) {
        if (sinceSignature && tx.signature === sinceSignature) {
          log.info("Backfill complete - reached target signature", {
            count: allTransactions.length,
          });
          return allTransactions;
        }
        allTransactions.push(tx);
        if (allTransactions.length >= maxTx) break;
      }

      if (!result.hasMore) break;
      paginationToken = result.paginationToken || undefined;
    }

    log.info("Backfill complete", { count: allTransactions.length });
    return allTransactions;
  }

  /**
   * Get enhanced RPC URL for Connection
   */
  getRpcUrl(): string {
    return this.rpcUrl;
  }
}

// Singleton instance (lazy initialization)
let heliusClient: HeliusClient | null = null;

/**
 * Get or create Helius client
 */
export function getHeliusClient(config?: HeliusConfig): HeliusClient | null {
  if (heliusClient) return heliusClient;

  // Try to get API key from env if not provided
  const apiKey = config?.apiKey || process.env.HELIUS_API_KEY;
  if (!apiKey) {
    log.debug("Helius API key not configured, enhanced features disabled");
    return null;
  }

  heliusClient = new HeliusClient({
    apiKey,
    network: config?.network || (process.env.NETWORK as "devnet" | "mainnet-beta") || "devnet",
  });

  return heliusClient;
}

/**
 * Initialize Helius client from environment
 */
export function initHelius(): HeliusClient | null {
  return getHeliusClient();
}

/**
 * Get Helius RPC URL if API key is available
 */
export function getHeliusRpcUrl(network: "devnet" | "mainnet-beta" = "devnet"): string | null {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return null;
  return `https://${network}.helius-rpc.com/?api-key=${apiKey}`;
}

// ============================================================================
// HELIUS GEYSER WEBSOCKET (Phase 2)
// ============================================================================

export interface GeyserAccountUpdate {
  pubkey: string;
  lamports: number;
  slot: number;
  data: string; // base64 encoded
}

export interface GeyserConfig {
  apiKey: string;
  network?: "devnet" | "mainnet-beta";
  onAccountChange?: (update: GeyserAccountUpdate) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * Helius Geyser WebSocket Client
 *
 * Phase 2 feature for real-time account change notifications.
 * Provides ~100-400ms latency from Solana confirmation.
 *
 * Requires Helius paid plan for Geyser access.
 */
export class HeliusGeyser {
  private apiKey: string;
  private network: "devnet" | "mainnet-beta";
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, number> = new Map(); // pubkey -> subscription id
  private pendingSubscriptions: Map<number, string> = new Map(); // request id -> pubkey
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectionTimeout = 10_000; // 10s connection timeout

  private onAccountChange?: (update: GeyserAccountUpdate) => void;
  private onError?: (error: Error) => void;
  private onConnect?: () => void;
  private onDisconnect?: () => void;

  constructor(config: GeyserConfig) {
    this.apiKey = config.apiKey;
    this.network = config.network || "devnet";
    this.onAccountChange = config.onAccountChange;
    this.onError = config.onError;
    this.onConnect = config.onConnect;
    this.onDisconnect = config.onDisconnect;

    log.info("HeliusGeyser initialized", { network: this.network });
  }

  /**
   * Get WebSocket URL for Helius Geyser
   */
  private getWsUrl(): string {
    // Helius Geyser WebSocket endpoint
    return `wss://${this.network}.helius-rpc.com/?api-key=${this.apiKey}`;
  }

  /**
   * Connect to Helius Geyser WebSocket
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      log.debug("Already connected to Geyser");
      return;
    }

    // Clear any pending reconnect
    this.clearReconnectTimer();

    return new Promise((resolve, reject) => {
      // Connection timeout
      const timeoutId = setTimeout(() => {
        if (!this.isConnected) {
          this.ws?.close();
          reject(new Error(`Connection timeout after ${this.connectionTimeout}ms`));
        }
      }, this.connectionTimeout);

      try {
        const wsUrl = this.getWsUrl();
        log.info("Connecting to Helius Geyser...", { network: this.network });

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          clearTimeout(timeoutId);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          log.info("Connected to Helius Geyser");
          this.onConnect?.();
          resolve();
        };

        this.ws.onclose = () => {
          clearTimeout(timeoutId);
          this.isConnected = false;
          log.warn("Disconnected from Helius Geyser");
          this.onDisconnect?.();
          this.attemptReconnect();
        };

        this.ws.onerror = (event) => {
          clearTimeout(timeoutId);
          const error = new Error("WebSocket error");
          log.error("Geyser WebSocket error", { error: error.message });
          this.onError?.(error);
          if (!this.isConnected) {
            reject(error);
          }
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle subscription confirmations
      // Server returns { id: requestId, result: subscriptionId }
      if (message.result !== undefined && message.id) {
        const pubkey = this.pendingSubscriptions.get(message.id);
        if (pubkey) {
          // Update subscription mapping with server's subscription ID
          this.subscriptions.set(pubkey, message.result);
          this.pendingSubscriptions.delete(message.id);
          log.debug("Subscription confirmed", {
            pubkey: pubkey.slice(0, 8),
            subscriptionId: message.result,
          });
        }
        return;
      }

      // Handle account notifications
      if (message.method === "accountNotification" && message.params) {
        const { subscription, result } = message.params;
        const accountData = result.value;

        if (accountData) {
          const update: GeyserAccountUpdate = {
            pubkey: this.getPublicKeyForSubscription(subscription),
            lamports: accountData.lamports,
            slot: result.context.slot,
            data: accountData.data[0], // base64
          };

          log.debug("Account update received", {
            pubkey: update.pubkey.slice(0, 8),
            lamports: update.lamports,
            slot: update.slot,
          });

          this.onAccountChange?.(update);
        }
      }

    } catch (error) {
      log.warn("Failed to parse Geyser message", { error: (error as Error).message });
    }
  }

  /**
   * Get public key for a subscription ID
   */
  private getPublicKeyForSubscription(subscriptionId: number): string {
    for (const [pubkey, id] of this.subscriptions) {
      if (id === subscriptionId) {
        return pubkey;
      }
    }
    return "unknown";
  }

  /**
   * Subscribe to account changes
   */
  async subscribeAccount(pubkey: string): Promise<number> {
    if (!this.isConnected || !this.ws) {
      throw new Error("Not connected to Geyser");
    }

    // Check if already subscribed
    if (this.subscriptions.has(pubkey)) {
      log.debug("Already subscribed to account", { pubkey: pubkey.slice(0, 8) });
      return this.subscriptions.get(pubkey)!;
    }

    const requestId = Date.now() + Math.random(); // Unique request ID
    const request = {
      jsonrpc: "2.0",
      id: requestId,
      method: "accountSubscribe",
      params: [
        pubkey,
        {
          encoding: "base64",
          commitment: "confirmed",
        },
      ],
    };

    // Track pending subscription
    this.pendingSubscriptions.set(requestId, pubkey);

    this.ws.send(JSON.stringify(request));

    log.info("Subscribing to account", { pubkey: pubkey.slice(0, 8), requestId });
    return requestId;
  }

  /**
   * Unsubscribe from account
   */
  async unsubscribeAccount(pubkey: string): Promise<void> {
    if (!this.isConnected || !this.ws) {
      return;
    }

    const subscriptionId = this.subscriptions.get(pubkey);
    if (!subscriptionId) {
      return;
    }

    const request = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "accountUnsubscribe",
      params: [subscriptionId],
    };

    this.ws.send(JSON.stringify(request));
    this.subscriptions.delete(pubkey);

    log.info("Unsubscribed from account", { pubkey: pubkey.slice(0, 8) });
  }

  /**
   * Clear reconnect timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Attempt to reconnect after disconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error("Max reconnect attempts reached, giving up");
      this.onError?.(new Error("Max reconnect attempts reached"));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    log.info("Attempting reconnect...", {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delay,
    });

    // Store timer reference to allow cleanup
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        // Resubscribe to all accounts (use saved pubkeys, not stale subscription IDs)
        const pubkeys = Array.from(this.subscriptions.keys());
        this.subscriptions.clear(); // Clear old subscription IDs
        this.pendingSubscriptions.clear();

        for (const pubkey of pubkeys) {
          await this.subscribeAccount(pubkey);
        }
        log.info("Reconnected and resubscribed", { accounts: pubkeys.length });
      } catch (error) {
        log.warn("Reconnect failed", { error: (error as Error).message });
      }
    }, delay);
  }

  /**
   * Disconnect from Geyser (clean shutdown)
   */
  disconnect(): void {
    // Clear reconnect timer to prevent reconnection attempts
    this.clearReconnectTimer();

    // Clear all subscriptions
    this.subscriptions.clear();
    this.pendingSubscriptions.clear();

    // Close WebSocket
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect attempt
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.reconnectAttempts = 0;

    log.info("Disconnected from Helius Geyser (clean shutdown)");
  }

  /**
   * Check if connected
   */
  isConnectedToGeyser(): boolean {
    return this.isConnected;
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }
}

// Singleton instance
let geyserInstance: HeliusGeyser | null = null;

/**
 * Initialize Helius Geyser (Phase 2)
 */
export function initHeliusGeyser(config?: Partial<GeyserConfig>): HeliusGeyser | null {
  const apiKey = config?.apiKey || process.env.HELIUS_API_KEY;
  if (!apiKey) {
    log.debug("Helius API key not configured, Geyser disabled");
    return null;
  }

  geyserInstance = new HeliusGeyser({
    apiKey,
    network: config?.network || (process.env.NETWORK as "devnet" | "mainnet-beta") || "devnet",
    ...config,
  });

  return geyserInstance;
}

/**
 * Get Helius Geyser instance
 */
export function getHeliusGeyser(): HeliusGeyser | null {
  return geyserInstance;
}
