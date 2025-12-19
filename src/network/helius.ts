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
