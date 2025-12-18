/**
 * ASDF Burn Engine Constants
 *
 * Single source of truth for all protocol constants.
 * Import from here instead of declaring locally.
 */

import { PublicKey } from '@solana/web3.js';

// ============================================================================
// Program IDs
// ============================================================================

/** ASDF Burn Engine Program ID */
export const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');

/** Pump.fun Bonding Curve Program */
export const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

/** PumpSwap AMM Program */
export const PUMPSWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

/** Pump.fun Fee Program */
export const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');

/** Token Metadata Program (Metaplex) */
export const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/** Token 2022 Program */
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/** Wrapped SOL Mint */
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ============================================================================
// PDA Seeds
// ============================================================================

/** DAT State PDA seed */
export const DAT_STATE_SEED = Buffer.from('dat_v3');

/** DAT Authority PDA seed */
export const DAT_AUTHORITY_SEED = Buffer.from('auth_v3');

/** Token Stats PDA seed */
export const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

/** Root Treasury PDA seed */
export const ROOT_TREASURY_SEED = Buffer.from('root_treasury');

/** Validator State PDA seed */
export const VALIDATOR_STATE_SEED = Buffer.from('validator_v1');

/** User Stats PDA seed */
export const USER_STATS_SEED = Buffer.from('user_stats_v1');

/** Rebate Pool PDA seed */
export const REBATE_POOL_SEED = Buffer.from('rebate_pool');

// ============================================================================
// Fee Ratios
// ============================================================================

/**
 * Secondary token keep ratio (55.2%)
 * Secondary tokens keep this portion for their own buyback & burn
 */
export const SECONDARY_KEEP_RATIO = 0.552;

/**
 * Root share ratio (44.8%)
 * Root token receives this portion from all secondaries
 */
export const ROOT_SHARE_RATIO = 0.448;

/**
 * Burn share (99.448% of deposit)
 * For external app deposits via deposit_fee_asdf
 */
export const BURN_SHARE = 99448;

/**
 * Rebate share (0.552% of deposit)
 * For user rebates from external app deposits
 */
export const REBATE_SHARE = 552;

/**
 * Share denominator for precise calculations
 */
export const SHARE_DENOMINATOR = 100000n;

// ============================================================================
// Thresholds
// ============================================================================

/** SOL per lamport conversion (bigint) */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Minimum fees to participate in cycle (~0.0055 SOL) */
export const MIN_FEES_FOR_SPLIT = 5_500_000n;

/**
 * Minimum threshold for flush cycle (0.1 SOL)
 * MUST match Rust constant: programs/asdf-dat/src/constants.rs:191
 */
export const FLUSH_THRESHOLD = 100_000_000n;

/** Transaction fee reserve per token (~0.007 SOL) */
export const TX_FEE_RESERVE_PER_TOKEN = 7_000_000n;

/** Default minimum cycle threshold (0.006 SOL, devnet-friendly) */
export const MIN_CYCLE_THRESHOLD = 6_000_000n;

/** Minimum for external app rebate eligibility (0.07 SOL equivalent) */
export const REBATE_THRESHOLD_LAMPORTS = 70_000_000n;

/** Rent-exempt minimum for accounts */
export const RENT_EXEMPT_MINIMUM = 890_880n;

/** ATA rent reserve */
export const ATA_RENT_RESERVE = 2_100_000n;

// ============================================================================
// Slippage & Safety
// ============================================================================

/** Default slippage BPS (5%) */
export const DEFAULT_SLIPPAGE_BPS = 500;

/** Maximum allowed slippage BPS (15%) */
export const MAX_SLIPPAGE_BPS = 1500;

/** Minimum cycle interval in seconds */
export const MIN_CYCLE_INTERVAL = 60;

// ============================================================================
// State & Persistence
// ============================================================================

/** Current state version for migrations */
export const STATE_VERSION = 1;

/** Maximum signatures to keep in processed set */
export const MAX_PROCESSED_SIGNATURES = 10_000;

// ============================================================================
// API & Daemon
// ============================================================================

/** Default daemon API port */
export const DEFAULT_API_PORT = 3030;

/** Default WebSocket port */
export const DEFAULT_WS_PORT = 3031;

/** Default state file path */
export const DEFAULT_STATE_FILE = '.asdf-state.json';

/** Default poll interval in ms */
export const DEFAULT_POLL_INTERVAL_MS = 5000;
