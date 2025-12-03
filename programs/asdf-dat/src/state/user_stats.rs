use anchor_lang::prelude::*;

/// User contribution statistics for external app integration
///
/// Tracks individual user contributions from external apps paying in $ASDF.
/// Users accumulate pending_contribution until selected in rebate lottery.
///
/// PDA Seeds: ["user_stats_v1", user_pubkey]
#[account]
pub struct UserStats {
    /// PDA bump seed
    pub bump: u8,

    /// The user's wallet address
    pub user: Pubkey,

    /// $ASDF pending contribution (awaiting rebate processing)
    /// Reset to 0 when user is selected for rebate
    pub pending_contribution: u64,

    /// Lifetime total $ASDF contributed
    pub total_contributed: u64,

    /// Lifetime total $ASDF rebate received
    pub total_rebate: u64,

    /// Proof-of-history: timestamp of last modification
    /// Updated on every deposit or rebate processing
    pub last_update_timestamp: i64,

    /// Proof-of-history: slot of last modification
    /// Additional verification for chronological order
    pub last_update_slot: u64,
}

impl UserStats {
    /// Account size calculation:
    /// - bump: 1 byte
    /// - user: 32 bytes (Pubkey)
    /// - pending_contribution: 8 bytes (u64)
    /// - total_contributed: 8 bytes (u64)
    /// - total_rebate: 8 bytes (u64)
    /// - last_update_timestamp: 8 bytes (i64)
    /// - last_update_slot: 8 bytes (u64)
    /// Total: 73 bytes
    pub const LEN: usize = 1 + 32 + 8 + 8 + 8 + 8 + 8;
}
