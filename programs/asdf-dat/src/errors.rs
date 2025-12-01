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

    #[msg("Already executed")]
    AlreadyExecutedThisPeriod,

    #[msg("Slippage exceeded")]
    SlippageExceeded,

    #[msg("Not coin creator")]
    NotCoinCreator,

    #[msg("Price impact too high")]
    PriceImpactTooHigh,

    #[msg("Rate too low")]
    RateTooLow,

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
}
