use anchor_lang::prelude::*;

/// Rebate Pool authority PDA for external app integration
///
/// Self-sustaining model: automatically funded by 0.552% of each $ASDF deposit.
/// The rebate pool ATA holds $ASDF tokens for distributing rebates to users.
///
/// Architecture:
/// - PDA: ["rebate_pool"] - Authority that can sign for ATA transfers
/// - ATA: getATA(rebate_pool_pda, ASDF_MINT) - Holds rebate funds
///
/// Funding flow:
/// - deposit_fee_asdf() splits: 99.448% → DAT ATA, 0.552% → Rebate Pool ATA
/// - process_user_rebate() transfers from pool → user ATA
///
/// PDA Seeds: ["rebate_pool"]
#[account]
pub struct RebatePool {
    /// PDA bump seed
    pub bump: u8,

    /// Total $ASDF deposited to pool (lifetime)
    pub total_deposited: u64,

    /// Total $ASDF distributed as rebates (lifetime)
    pub total_distributed: u64,

    /// Number of rebates processed (lifetime)
    pub rebates_count: u64,

    /// Timestamp of last rebate distribution
    pub last_rebate_timestamp: i64,

    /// Slot of last rebate distribution
    pub last_rebate_slot: u64,

    /// Total users who received rebates (unique count)
    pub unique_recipients: u64,

    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl RebatePool {
    /// Account size calculation:
    /// - bump: 1 byte
    /// - total_deposited: 8 bytes (u64)
    /// - total_distributed: 8 bytes (u64)
    /// - rebates_count: 8 bytes (u64)
    /// - last_rebate_timestamp: 8 bytes (i64)
    /// - last_rebate_slot: 8 bytes (u64)
    /// - unique_recipients: 8 bytes (u64)
    /// - _reserved: 32 bytes
    /// Total: 81 bytes
    pub const LEN: usize = 1 + 8 + 8 + 8 + 8 + 8 + 8 + 32;
}
