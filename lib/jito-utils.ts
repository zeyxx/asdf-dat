/**
 * Jito Bundle Integration
 *
 * Provides MEV protection through Jito bundles for atomic transaction execution.
 * Supports both direct API calls and SDK integration.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionSignature,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { withRetryAndTimeout, sleep } from './rpc-utils';

// ============================================================================
// Configuration
// ============================================================================

export interface JitoConfig {
  blockEngineUrl: string;
  tipAccount: PublicKey;
  defaultTipLamports: number;
  authKeypair?: Keypair;       // Optional authentication keypair
  timeoutMs: number;
}

export const JITO_MAINNET_CONFIG: JitoConfig = {
  blockEngineUrl: 'https://mainnet.block-engine.jito.wtf',
  tipAccount: new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
  defaultTipLamports: 1_000_000, // 0.001 SOL
  timeoutMs: 60000,
};

export const JITO_DEVNET_CONFIG: JitoConfig = {
  blockEngineUrl: 'https://dallas.testnet.block-engine.jito.wtf',
  tipAccount: new PublicKey('DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh'), // Devnet tip account
  defaultTipLamports: 1_000_000,
  timeoutMs: 60000,
};

// Jito tip accounts (multiple available for load balancing)
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'HBbmfuYVhxpKjGvvY2AqZMFVNwQWKWL4n2JdVf2PRJiN',
].map((addr) => new PublicKey(addr));

// ============================================================================
// Types
// ============================================================================

export interface Bundle {
  transactions: (Transaction | VersionedTransaction)[];
  tipTransaction: Transaction;
}

export interface BundleSubmitResult {
  bundleId: string;
  status: 'submitted' | 'landed' | 'failed' | 'timeout';
  signature?: TransactionSignature;
  error?: string;
  slot?: number;
}

export interface BundleStatus {
  bundleId: string;
  status: 'pending' | 'landed' | 'failed' | 'unknown';
  landedSlot?: number;
  transactions?: {
    signature: string;
    status: 'confirmed' | 'failed' | 'pending';
  }[];
}

// ============================================================================
// Jito Client
// ============================================================================

export class JitoClient {
  private config: JitoConfig;
  private connection: Connection;

  constructor(
    connection: Connection,
    config: Partial<JitoConfig> = {},
    network: 'mainnet' | 'devnet' = 'mainnet'
  ) {
    const defaultConfig = network === 'mainnet' ? JITO_MAINNET_CONFIG : JITO_DEVNET_CONFIG;
    this.config = { ...defaultConfig, ...config };
    this.connection = connection;
  }

  /**
   * Create a tip transaction for the bundle
   */
  createTipTransaction(
    payer: PublicKey,
    tipLamports: number = this.config.defaultTipLamports,
    recentBlockhash?: string
  ): Transaction {
    // Select a random tip account for load balancing
    const tipAccountIndex = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    const tipAccount = JITO_TIP_ACCOUNTS[tipAccountIndex];

    const tipTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: tipAccount,
        lamports: tipLamports,
      })
    );

    if (recentBlockhash) {
      tipTx.recentBlockhash = recentBlockhash;
      tipTx.feePayer = payer;
    }

    return tipTx;
  }

  /**
   * Create a bundle from transactions
   */
  async createBundle(
    transactions: Transaction[],
    payer: Keypair,
    tipLamports: number = this.config.defaultTipLamports
  ): Promise<Bundle> {
    // Get recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

    // Prepare all transactions with blockhash
    const preparedTxs = transactions.map((tx) => {
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      return tx;
    });

    // Create tip transaction (added as last tx in bundle)
    const tipTx = this.createTipTransaction(payer.publicKey, tipLamports, blockhash);
    tipTx.feePayer = payer.publicKey;

    return {
      transactions: preparedTxs,
      tipTransaction: tipTx,
    };
  }

  /**
   * Sign all transactions in a bundle
   */
  signBundle(bundle: Bundle, signers: Keypair[]): void {
    for (const tx of bundle.transactions) {
      if (tx instanceof Transaction) {
        tx.sign(...signers);
      }
    }
    bundle.tipTransaction.sign(...signers);
  }

  /**
   * Submit a bundle to Jito block engine
   */
  async submitBundle(bundle: Bundle, signers: Keypair[]): Promise<BundleSubmitResult> {
    // Sign bundle
    this.signBundle(bundle, signers);

    // Serialize transactions
    const serializedTxs = [
      ...bundle.transactions.map((tx) =>
        tx instanceof Transaction
          ? tx.serialize().toString('base64')
          : Buffer.from(tx.serialize()).toString('base64')
      ),
      bundle.tipTransaction.serialize().toString('base64'),
    ];

    try {
      // Submit to Jito block engine
      const response = await withRetryAndTimeout(
        () =>
          fetch(`${this.config.blockEngineUrl}/api/v1/bundles`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'sendBundle',
              params: [serializedTxs],
            }),
          }),
        { maxRetries: 3 },
        30000
      );

      const result = await response.json() as {
        result?: string;
        error?: { message: string };
      };

      if (result.error) {
        return {
          bundleId: '',
          status: 'failed',
          error: result.error.message,
        };
      }

      const bundleId = result.result || '';

      return {
        bundleId,
        status: 'submitted',
      };
    } catch (error) {
      return {
        bundleId: '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check bundle status
   */
  async getBundleStatus(bundleId: string): Promise<BundleStatus> {
    try {
      const response = await fetch(`${this.config.blockEngineUrl}/api/v1/bundles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [[bundleId]],
        }),
      });

      const result = await response.json() as {
        result?: { value: Array<{ bundle_id: string; status: string; slot?: number }> };
      };

      if (result.result?.value?.[0]) {
        const bundleResult = result.result.value[0];
        return {
          bundleId,
          status: bundleResult.status === 'Landed' ? 'landed' :
                  bundleResult.status === 'Failed' ? 'failed' : 'pending',
          landedSlot: bundleResult.slot,
        };
      }

      return {
        bundleId,
        status: 'unknown',
      };
    } catch (error) {
      return {
        bundleId,
        status: 'unknown',
      };
    }
  }

  /**
   * Submit bundle and wait for confirmation
   */
  async submitAndConfirm(
    bundle: Bundle,
    signers: Keypair[],
    timeoutMs: number = this.config.timeoutMs
  ): Promise<BundleSubmitResult> {
    const submitResult = await this.submitBundle(bundle, signers);

    if (submitResult.status !== 'submitted') {
      return submitResult;
    }

    // Poll for bundle status
    const startTime = Date.now();
    const pollIntervalMs = 2000;

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getBundleStatus(submitResult.bundleId);

      if (status.status === 'landed') {
        return {
          ...submitResult,
          status: 'landed',
          slot: status.landedSlot,
        };
      }

      if (status.status === 'failed') {
        return {
          ...submitResult,
          status: 'failed',
          error: 'Bundle failed to land',
        };
      }

      await sleep(pollIntervalMs);
    }

    return {
      ...submitResult,
      status: 'timeout',
      error: `Bundle confirmation timeout after ${timeoutMs}ms`,
    };
  }

  /**
   * Calculate recommended tip based on recent tip percentiles
   */
  async getRecommendedTip(percentile: number = 50): Promise<number> {
    try {
      // Use a default multiplier based on percentile
      // In production, this would query the Jito tip stream
      const baseTip = this.config.defaultTipLamports;
      const multiplier = 1 + (percentile / 100);
      return Math.floor(baseTip * multiplier);
    } catch {
      return this.config.defaultTipLamports;
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if Jito is available for the current network
 */
export function isJitoAvailable(network: 'mainnet' | 'devnet'): boolean {
  // Jito is available on both mainnet and testnet
  return true;
}

/**
 * Create a bundle-ready transaction group
 * All transactions will share the same blockhash for atomicity
 */
export async function prepareBundleTransactions(
  connection: Connection,
  transactions: Transaction[],
  payer: PublicKey
): Promise<{
  transactions: Transaction[];
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');

  const preparedTxs = transactions.map((tx) => {
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;
    return tx;
  });

  return {
    transactions: preparedTxs,
    blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Fallback: Submit transactions without Jito (regular RPC)
 * Used when Jito submission fails
 */
export async function submitWithoutJito(
  connection: Connection,
  transactions: Transaction[],
  signers: Keypair[]
): Promise<TransactionSignature[]> {
  const signatures: TransactionSignature[] = [];

  for (const tx of transactions) {
    const signature = await connection.sendTransaction(tx, signers, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    signatures.push(signature);
  }

  return signatures;
}

/**
 * Calculate total tip needed for a bundle
 */
export function calculateBundleTip(
  numTransactions: number,
  baseTipLamports: number = JITO_MAINNET_CONFIG.defaultTipLamports,
  priorityMultiplier: number = 1.0
): number {
  // Scale tip slightly with bundle size for better inclusion
  const sizeFactor = 1 + (numTransactions - 1) * 0.1;
  return Math.floor(baseTipLamports * sizeFactor * priorityMultiplier);
}

/**
 * Format tip amount for display
 */
export function formatTip(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
}
