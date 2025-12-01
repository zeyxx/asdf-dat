use anchor_lang::prelude::*;

/// Validator state for trustless per-token fee attribution
///
/// Tracks fees validated from PumpFun transaction logs.
/// Used for cryptographic proof that fees were actually generated
/// by specific token trades.
#[account]
pub struct ValidatorState {
    /// Token mint being tracked
    pub mint: Pubkey,

    /// Associated PumpFun bonding curve
    pub bonding_curve: Pubkey,

    /// Last slot that was validated
    pub last_validated_slot: u64,

    /// Cumulative fees validated historically
    pub total_validated_lamports: u64,

    /// Number of validation batches
    pub total_validated_count: u64,

    /// Expected fee rate in basis points (50 = 0.5%)
    pub fee_rate_bps: u16,

    /// PDA bump seed
    pub bump: u8,

    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl ValidatorState {
    /// Account size: 32 + 32 + 8 + 8 + 8 + 2 + 1 + 32 = 123 bytes
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 2 + 1 + 32;
}
