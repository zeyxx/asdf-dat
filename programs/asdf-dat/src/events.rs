use anchor_lang::prelude::*;

// ══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION EVENTS
// ══════════════════════════════════════════════════════════════════════════════

/// Emitted when DAT state is initialized
#[event]
pub struct DATInitialized {
    pub admin: Pubkey,
    pub dat_authority: Pubkey,
    pub timestamp: i64,
}

/// Emitted when per-token statistics are initialized
#[event]
pub struct TokenStatsInitialized {
    pub mint: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a validator is initialized for trustless fee tracking
#[event]
pub struct ValidatorInitialized {
    pub mint: Pubkey,
    pub bonding_curve: Pubkey,
    pub slot: u64,
    pub timestamp: i64,
}

// ══════════════════════════════════════════════════════════════════════════════
// CYCLE EVENTS
// ══════════════════════════════════════════════════════════════════════════════

/// Emitted when a buyback cycle completes successfully
#[event]
pub struct CycleCompleted {
    pub cycle_number: u32,
    pub tokens_burned: u64,
    pub sol_used: u64,
    pub total_burned: u64,
    pub total_sol_collected: u64,
    pub timestamp: i64,
}

/// Emitted when a cycle fails
#[event]
pub struct CycleFailed {
    pub failed_count: u32,
    pub consecutive_failures: u8,
    pub error_code: u32,
    pub timestamp: i64,
}

/// Emitted when a buy is executed
#[event]
pub struct BuyExecuted {
    pub tokens_bought: u64,
    pub sol_spent: u64,
    pub timestamp: i64,
}

// ══════════════════════════════════════════════════════════════════════════════
// STATUS EVENTS
// ══════════════════════════════════════════════════════════════════════════════

/// Emitted when DAT status changes (active/paused)
#[event]
pub struct StatusChanged {
    pub is_active: bool,
    pub emergency_pause: bool,
    pub timestamp: i64,
}

/// Emitted for emergency actions (pause/resume)
#[event]
pub struct EmergencyAction {
    pub action: String,
    pub admin: Pubkey,
    pub timestamp: i64,
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN EVENTS
// ══════════════════════════════════════════════════════════════════════════════

/// Emitted when admin transfer is proposed (two-step transfer)
#[event]
pub struct AdminTransferProposed {
    pub current_admin: Pubkey,
    pub proposed_admin: Pubkey,
    pub timestamp: i64,
}

/// Emitted when admin transfer is completed
#[event]
pub struct AdminTransferred {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
    pub timestamp: i64,
}

// ══════════════════════════════════════════════════════════════════════════════
// TOKEN EVENTS
// ══════════════════════════════════════════════════════════════════════════════

/// Emitted when a new token is created via PumpFun
#[event]
pub struct TokenCreated {
    pub mint: Pubkey,
    pub bonding_curve: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub timestamp: i64,
}

/// Emitted when root token is set/changed
#[event]
pub struct RootTokenSet {
    pub root_mint: Pubkey,
    pub fee_split_bps: u16,
    pub timestamp: i64,
}

// ══════════════════════════════════════════════════════════════════════════════
// FEE EVENTS
// ══════════════════════════════════════════════════════════════════════════════

/// Emitted when fee split ratio is updated
#[event]
pub struct FeeSplitUpdated {
    pub old_bps: u16,
    pub new_bps: u16,
    pub timestamp: i64,
}

/// Emitted when fees are redirected from secondary to root token
#[event]
pub struct FeesRedirectedToRoot {
    pub from_token: Pubkey,
    pub to_root: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Emitted when root treasury collects accumulated fees
#[event]
pub struct RootTreasuryCollected {
    pub root_mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Emitted when pending fees are updated by daemon
#[event]
pub struct PendingFeesUpdated {
    pub mint: Pubkey,
    pub amount: u64,
    pub total_pending: u64,
    pub timestamp: i64,
}

/// Emitted when AMM fees are collected (post-migration tokens)
#[event]
pub struct AmmFeesCollected {
    pub mint: Pubkey,
    pub wsol_amount: u64,
    pub timestamp: i64,
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDATOR EVENTS
// ══════════════════════════════════════════════════════════════════════════════

/// Emitted when validator slot is reset
#[event]
pub struct ValidatorSlotReset {
    pub mint: Pubkey,
    pub old_slot: u64,
    pub new_slot: u64,
    pub timestamp: i64,
}

/// Emitted when validated fees are registered
#[event]
pub struct ValidatedFeesRegistered {
    pub mint: Pubkey,
    pub fee_amount: u64,
    pub end_slot: u64,
    pub tx_count: u32,
    pub total_pending: u64,
    pub timestamp: i64,
}
