use anchor_lang::prelude::*;

/// Global DAT configuration and statistics
///
/// Stores system-wide settings, admin controls, and cumulative metrics.
/// Only one DATState account exists per program instance.
#[account]
pub struct DATState {
    /// Current admin authority
    pub admin: Pubkey,

    /// ASDF token mint address
    pub asdf_mint: Pubkey,

    /// Wrapped SOL mint address
    pub wsol_mint: Pubkey,

    /// PumpSwap pool address for ASDF
    pub pool_address: Pubkey,

    /// PumpSwap program ID
    pub pump_swap_program: Pubkey,

    /// Total tokens burned across all cycles
    pub total_burned: u64,

    /// Total SOL collected across all cycles
    pub total_sol_collected: u64,

    /// Total number of successful buyback cycles
    pub total_buybacks: u32,

    /// Total number of failed cycles
    pub failed_cycles: u32,

    /// Consecutive failure count (resets on success)
    pub consecutive_failures: u8,

    /// Whether DAT is active
    pub is_active: bool,

    /// Emergency pause flag
    pub emergency_pause: bool,

    /// Timestamp of last cycle execution
    pub last_cycle_timestamp: i64,

    /// Timestamp when DAT was initialized
    pub initialized_at: i64,

    /// Last AM execution timestamp (legacy, maintained for compatibility)
    pub last_am_execution: i64,

    /// Last PM execution timestamp (legacy, maintained for compatibility)
    pub last_pm_execution: i64,

    /// SOL collected in last cycle
    pub last_cycle_sol: u64,

    /// Tokens burned in last cycle
    pub last_cycle_burned: u64,

    /// Minimum fees required to trigger cycle
    pub min_fees_threshold: u64,

    /// Maximum fees allowed per cycle
    pub max_fees_per_cycle: u64,

    /// Slippage tolerance in basis points
    pub slippage_bps: u16,

    /// Minimum interval between cycles (seconds)
    pub min_cycle_interval: i64,

    /// PDA bump for DAT authority
    pub dat_authority_bump: u8,

    /// Current fee recipient index (for rotation)
    pub current_fee_recipient_index: u8,

    /// Last known token price
    pub last_known_price: u64,

    /// Pending burn amount (tokens waiting to be burned)
    pub pending_burn_amount: u64,

    /// Root token mint that receives 44.8% from secondaries
    pub root_token_mint: Option<Pubkey>,

    /// Fee split in basis points: 5520 = 55.2% keep, 44.8% to root
    pub fee_split_bps: u16,

    /// SOL sent to root in last cycle (for stats tracking)
    pub last_sol_sent_to_root: u64,

    // Security audit additions (v2)

    /// Two-step admin transfer: proposed new admin
    pub pending_admin: Option<Pubkey>,

    /// Timelock: proposed fee split change
    pub pending_fee_split: Option<u16>,

    /// Timelock: when fee split was proposed
    pub pending_fee_split_timestamp: i64,

    /// Timelock: cooldown period in seconds (default 3600 = 1hr)
    pub admin_operation_cooldown: i64,

    // HIGH-01 FIX: Separate timestamp for direct fee split changes
    /// Last time update_fee_split was called (direct path)
    /// Separate from pending_fee_split_timestamp to prevent bypass attacks
    pub last_direct_fee_split_timestamp: i64,
}

impl DATState {
    /// Account size calculation:
    /// - 5 Pubkeys: 32 * 5 = 160 bytes (admin, asdf_mint, wsol_mint, pool_address, pump_swap_program)
    /// - 17 u64/i64: 8 * 17 = 136 bytes (total_burned, total_sol_collected, last_cycle_timestamp,
    ///   initialized_at, last_am_execution, last_pm_execution, last_cycle_sol, last_cycle_burned,
    ///   min_fees_threshold, max_fees_per_cycle, min_cycle_interval, last_known_price,
    ///   pending_burn_amount, last_sol_sent_to_root, pending_fee_split_timestamp, admin_operation_cooldown,
    ///   last_direct_fee_split_timestamp)
    /// - 2 u32: 4 * 2 = 8 bytes (total_buybacks, failed_cycles)
    /// - 5 u8/bool: 1 * 5 = 5 bytes (consecutive_failures, is_active, emergency_pause,
    ///   dat_authority_bump, current_fee_recipient_index)
    /// - 2 u16: 2 * 2 = 4 bytes (slippage_bps, fee_split_bps)
    /// - 2 Option<Pubkey>: 33 * 2 = 66 bytes (root_token_mint, pending_admin)
    /// - 1 Option<u16>: 3 bytes (pending_fee_split)
    /// Total: 160 + 136 + 8 + 5 + 4 + 66 + 3 = 382 bytes
    pub const LEN: usize = 32 * 5 + 8 * 17 + 4 * 2 + 1 * 5 + 2 * 2 + 33 * 2 + 3;
}
