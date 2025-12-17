/**
 * ASDF Burn Engine Core Types
 *
 * Type definitions for the modular daemon architecture.
 * Architecture: "Don't trust, verify"
 * - Store: mint + isRoot only
 * - Derive: bondingCurve, ammPool, poolType, tokenProgram, creator
 * - Verify: on-chain before every operation
 *
 * Phase 1: Single-tenant DAT
 * Phase 2 ready: Extensible for multi-tenant
 */

import { PublicKey } from "@solana/web3.js";

// ============================================================
// POOL & PROGRAM TYPES
// ============================================================

/**
 * Pool type indicates bonding curve vs PumpSwap AMM
 * BC = pre-migration (pump.fun bonding curve)
 * AMM = post-migration (PumpSwap AMM)
 */
export type PoolType = "bonding_curve" | "pumpswap_amm";

/**
 * Token program type
 * SPL = Classic token program (TokenkegQfe...)
 * Token2022 = Token Extensions program (TokenzQdBN...)
 */
export type TokenProgramType = "SPL" | "Token2022";

// ============================================================
// VERIFICATION ARCHITECTURE TYPES
// "Don't trust, verify" - Store minimum, derive everything
// ============================================================

/**
 * What we STORE (minimum vital)
 * Only immutable facts + user intent
 */
export interface StoredToken {
  mint: string;         // Primary key - immutable
  isRoot: boolean;      // User intent - manual flag

  // Optional metadata cache (can be re-fetched)
  symbol?: string;
  name?: string;
}

/**
 * What we DERIVE (on-chain, trustless)
 * All of these can be computed from mint alone
 */
export interface DerivedTokenData {
  bondingCurve: PublicKey;       // Derived: PDA from mint
  ammPool: PublicKey;            // Derived: PDA from mint + WSOL
  poolType: PoolType;            // Detected: BC exists = bonding_curve
  tokenProgram: TokenProgramType; // Detected: mint account owner
  creator: PublicKey;            // Extracted: from BC/pool account data
  creatorVault: PublicKey;       // Derived: PDA from creator
  isMayhemMode: boolean;         // Detected: last byte of BC/pool
  isCTO: boolean;                // Detected: cto_creator != null in pool
}

/**
 * Verified token - complete trustless state
 * Created by verifyToken() which checks everything on-chain
 */
export interface VerifiedToken extends StoredToken {
  // Derived data (all verified on-chain)
  bondingCurve: PublicKey;
  ammPool: PublicKey;
  poolType: PoolType;
  tokenProgram: TokenProgramType;
  creator: PublicKey;
  creatorVault: PublicKey;
  isMayhemMode: boolean;
  isCTO: boolean;

  // On-chain state
  hasTokenStats: boolean;          // TokenStats PDA exists
  pendingFeesLamports: bigint;     // From TokenStats or 0
  totalBurnedTokens: bigint;       // From TokenStats or 0

  // Verification metadata
  lastVerifiedAt: number;          // Timestamp of verification
  verificationSlot: number;        // Slot when verified
}

// ============================================================
// LEGACY TRACKED TOKEN (for migration)
// Will be replaced by VerifiedToken
// ============================================================

/**
 * Token discovered via getProgramAccounts or transaction parsing
 */
export interface DiscoveredToken {
  mint: PublicKey;
  bondingCurve: PublicKey;
  pool?: PublicKey;       // AMM pool if migrated
  poolType: PoolType;
  discoveredAt: number;   // timestamp ms
}

/**
 * Token with full metadata (after fetch)
 */
export interface TokenMetadata {
  mint: PublicKey;
  symbol: string;
  name: string;
  uri?: string;
  isRoot: boolean;
}

/**
 * Fully tracked token with stats
 * @deprecated Use VerifiedToken instead for new code
 */
export interface TrackedToken {
  // Identity
  mint: PublicKey;
  symbol: string;
  name: string;
  isRoot: boolean;

  // Pool info
  bondingCurve: PublicKey;
  poolType: PoolType;

  // Token program info
  isToken2022?: boolean;  // Token2022 vs SPL Token

  // Fee tracking
  pendingFeesLamports: bigint;
  totalCollectedLamports: bigint;
  totalBurnedTokens: bigint;

  // State
  lastFeeUpdateSlot: number;
  lastBurnSignature?: string;

  // Timestamps
  discoveredAt: number;
  lastUpdatedAt: number;
}

// ============================================================
// FEE TYPES
// ============================================================

/**
 * Fee event detected from vault balance change
 */
export interface FeeEvent {
  mint: PublicKey;
  amountLamports: bigint;
  signature: string;
  slot: number;
  timestamp: number;
}

/**
 * Aggregated fee record for a token
 */
export interface FeeRecord {
  mint: PublicKey;
  symbol: string;
  pendingLamports: bigint;
  pendingSOL: number;
  lastSignature?: string;
}

/**
 * Fee totals across all tokens
 */
export interface FeeTotals {
  pendingLamports: bigint;
  pendingSOL: number;
  tokenCount: number;
}

// ============================================================
// CYCLE TYPES
// ============================================================

/**
 * Allocation for a single token during flush
 */
export interface TokenAllocation {
  mint: PublicKey;
  symbol: string;
  isRoot: boolean;
  allocationLamports: bigint;
  burnShareLamports: bigint;   // 99% for secondaries
  devShareLamports: bigint;    // 1% for secondaries, 0 for root
}

/**
 * Full allocation plan for a cycle
 */
export interface AllocationPlan {
  totalLamports: bigint;
  rootAllocation: TokenAllocation | null;
  secondaryAllocations: TokenAllocation[];
  rootTreasuryContribution: bigint;  // 44.8% from secondaries
}

/**
 * Result of a flush cycle
 */
export interface CycleResult {
  success: boolean;
  cycleId: string;
  startedAt: number;
  completedAt: number;

  // Amounts
  totalFlushedLamports: bigint;
  totalBurnedTokens: bigint;

  // Per-token results
  tokenResults: TokenCycleResult[];

  // Errors
  errors: CycleError[];
}

export interface TokenCycleResult {
  mint: PublicKey;
  symbol: string;
  flushedLamports: bigint;
  burnedTokens: bigint;
  burnSignature?: string;
  error?: string;
}

export interface CycleError {
  mint?: PublicKey;
  phase: "verify" | "collect" | "buy" | "burn" | "finalize";
  message: string;
  signature?: string;
}

// ============================================================
// STATE TYPES
// ============================================================

/**
 * Daemon runtime state
 */
export interface DaemonState {
  // Identity
  creatorPubkey: PublicKey;
  network: "devnet" | "mainnet";

  // Tokens
  rootToken: TrackedToken | null;
  secondaryTokens: TrackedToken[];

  // Vault
  creatorVaultPubkey: PublicKey;
  creatorVaultBalance: bigint;

  // Tracking
  lastProcessedSignature?: string;
  processedSignatures: Set<string>;

  // Stats
  startedAt: number;
  pollCount: number;
  errorCount: number;
  lastPollAt?: number;
  lastCycleAt?: number;
}

/**
 * Persisted state for crash recovery - V1 (legacy)
 * @deprecated Use PersistedStateV2 for new code
 */
export interface PersistedState {
  version: number;
  savedAt: number;

  // Creator info
  creatorPubkey: string;
  network: "devnet" | "mainnet";

  // Tokens (serialized)
  tokens: SerializedToken[];

  // Tracking
  lastProcessedSignature?: string;
  processedSignatures: string[];  // Array for JSON, convert to Set on load

  // Stats
  pollCount: number;
  errorCount: number;
}

/**
 * Legacy serialized token format (V1)
 * Stores bondingCurve which should be derived, not stored
 * @deprecated Use StoredToken for new code
 */
export interface SerializedToken {
  mint: string;
  symbol: string;
  name: string;
  isRoot: boolean;
  bondingCurve: string;         // DEPRECATED: should be derived
  poolType: PoolType;           // DEPRECATED: should be derived
  pendingFeesLamports: string;  // DEPRECATED: should be read on-chain
  totalCollectedLamports: string;
  totalBurnedTokens: string;
  lastFeeUpdateSlot: number;
  lastBurnSignature?: string;
  discoveredAt: number;
  lastUpdatedAt: number;
}

// ============================================================
// STATE V2 - "Don't trust, verify" architecture
// Stores minimum, derives everything else
// ============================================================

/**
 * Persisted state V2 - minimal storage
 * Only stores what cannot be derived from on-chain data
 */
export interface PersistedStateV2 {
  version: 2;
  savedAt: number;

  // Creator info
  creatorPubkey: string;
  network: "devnet" | "mainnet";

  // Tokens - MINIMAL: only mint + isRoot + optional metadata cache
  tokens: StoredToken[];

  // Fee tracking metadata (daemon state)
  feeTracking: FeeTrackingState;
}

/**
 * Fee tracking state for daemon crash recovery
 */
export interface FeeTrackingState {
  processedSignatures: string[];
  lastProcessedSignature?: string;
  pollCount: number;
  errorCount: number;
}

// ============================================================
// HEALTH & STATUS TYPES
// ============================================================

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheck {
  status: HealthStatus;
  uptime: number;
  details: {
    rpc: RpcHealth;
    tokens: TokenHealth;
    fees: FeeHealth;
  };
}

export interface RpcHealth {
  connected: boolean;
  latencyMs: number;
  errorRate: number;
  circuitBreakerOpen: boolean;
}

export interface TokenHealth {
  discovered: number;
  tracked: number;
  metadataLoaded: number;
}

export interface FeeHealth {
  lastPollMs: number;
  pendingTotal: bigint;
  pollErrors: number;
}

// ============================================================
// API TYPES
// ============================================================

export interface ApiFeesResponse {
  totals: {
    pendingLamports: number;  // JSON doesn't support bigint
    pendingSOL: number;
    tokenCount: number;
  };
  daemon: {
    pollCount: number;
    errorRate: number;
    lastPollMs: number;
  };
  tokens: ApiTokenFee[];
}

export interface ApiTokenFee {
  mint: string;
  symbol: string;
  isRoot: boolean;
  pendingLamports: number;
  pendingSOL: number;
}

export interface ApiTreasuryResponse {
  treasury: {
    address: string;
    initialized: boolean;
    balance: {
      lamports: number;
      sol: number;
    };
  };
}

export interface ApiRebatePoolResponse {
  address: string;
  balance: {
    lamports: number;
    sol: number;
  };
  stats: {
    totalDeposited: number;
    totalDistributed: number;
    rebatesCount: number;
    uniqueRecipients: number;
  } | null;
}

export interface ApiBurnsResponse {
  totalBurns: number;
  recentBurns: ApiBurnRecord[];
}

export interface ApiBurnRecord {
  timestamp: number;
  signature: string;
  mint: string;
  symbol: string;
  amountBurned: number;
  solSpent: number;
}

// ============================================================
// CONFIG TYPES
// ============================================================

export interface DaemonConfig {
  // Required
  creatorPubkey: PublicKey;
  network: "devnet" | "mainnet";

  // Optional with defaults
  rootTokenMint?: PublicKey;       // Auto-detected if not provided
  apiPort: number;                 // Default: 3030
  wsPort: number;                  // Default: 3031
  stateFile: string;               // Default: .asdf-state.json
  pollIntervalMs: number;          // Default: 5000

  // RPC
  rpcEndpoint: string;
  rpcFallbackEndpoints: string[];

  // Logging
  verbose: boolean;
}

// ============================================================
// EVENT TYPES (for WebSocket)
// ============================================================

export type WsEventType =
  | "welcome"
  | "fees"
  | "burn"
  | "cycle_start"
  | "cycle_complete"
  | "token_discovered"
  | "error";

export interface WsEvent {
  type: WsEventType;
  timestamp: number;
  data: unknown;
}

export interface WsFeesEvent extends WsEvent {
  type: "fees";
  data: {
    totals: FeeTotals;
    tokens: FeeRecord[];
  };
}

export interface WsBurnEvent extends WsEvent {
  type: "burn";
  data: {
    mint: string;
    symbol: string;
    amountBurned: number;
    signature: string;
  };
}

// ============================================================
// CONSTANTS
// ============================================================

export const LAMPORTS_PER_SOL = 1_000_000_000n;

// Fee split ratios
export const SECONDARY_KEEP_RATIO = 0.552;   // 55.2%
export const ROOT_SHARE_RATIO = 0.448;       // 44.8%

// Thresholds (in lamports)
export const FLUSH_THRESHOLD = 10_000_000n;           // 0.01 SOL
export const MIN_FEES_FOR_SPLIT = 5_500_000n;         // ~0.0055 SOL
export const TX_FEE_RESERVE_PER_TOKEN = 7_000_000n;   // ~0.007 SOL

// Pump.fun programs
export const PUMP_BONDING_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMPSWAP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

// Token mints
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

// State persistence
export const STATE_VERSION = 1;   // Legacy V1 format
export const STATE_VERSION_V2 = 2; // New "verify everything" format
export const MAX_PROCESSED_SIGNATURES = 10_000;
