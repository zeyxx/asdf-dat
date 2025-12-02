use anchor_lang::prelude::*;

/// ASDF-DAT Error Codes
///
/// Comprehensive error handling for all program operations.
/// Each error has a unique code and descriptive message.
#[error_code]
pub enum ErrorCode {
    #[msg("DAT not active")]
    DATNotActive,

    #[msg("Insufficient fees")]
    InsufficientFees,

    #[msg("Unauthorized")]
    UnauthorizedAccess,

    #[msg("Cycle too soon")]
    CycleTooSoon,

    #[msg("Invalid parameter")]
    InvalidParameter,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Slippage exceeded")]
    SlippageExceeded,

    #[msg("Price impact too high")]
    PriceImpactTooHigh,

    #[msg("Vault not initialized")]
    VaultNotInitialized,

    #[msg("No pending burn")]
    NoPendingBurn,

    #[msg("Invalid pool data")]
    InvalidPool,

    #[msg("Invalid root token")]
    InvalidRootToken,

    #[msg("Invalid root treasury")]
    InvalidRootTreasury,

    #[msg("Invalid fee split basis points")]
    InvalidFeeSplit,

    #[msg("Fee split change exceeds maximum delta (500 bps per call)")]
    FeeSplitDeltaTooLarge,

    #[msg("Insufficient pool liquidity")]
    InsufficientPoolLiquidity,

    #[msg("Stale validation - slot already processed")]
    StaleValidation,

    #[msg("Slot range too large")]
    SlotRangeTooLarge,

    #[msg("Validator not stale - sync not needed")]
    ValidatorNotStale,

    #[msg("Fee amount exceeds maximum for slot range")]
    FeeTooHigh,

    #[msg("Transaction count exceeds maximum for slot range")]
    TooManyTransactions,

    #[msg("Invalid bonding curve account")]
    InvalidBondingCurve,

    #[msg("Mint mismatch between accounts")]
    MintMismatch,

    #[msg("Pending fees would exceed maximum (69 SOL)")]
    PendingFeesOverflow,

    // Specific error codes for better debugging (LOW-02 fix)
    #[msg("No pending admin transfer to cancel")]
    NoPendingAdminTransfer,

    #[msg("No pending fee split change to execute")]
    NoPendingFeeSplit,

    #[msg("Invalid account owner")]
    InvalidAccountOwner,

    #[msg("Slippage configuration too high (max 500 bps)")]
    SlippageConfigTooHigh,

    #[msg("Account size mismatch during migration")]
    AccountSizeMismatch,
}
