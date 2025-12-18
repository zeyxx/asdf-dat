use anchor_lang::prelude::*;

/// Optimistic Burn Protocol Error Codes
///
/// Clear, actionable error messages for all operations.
#[error_code]
pub enum ErrorCode {
    // Flush cycle errors
    #[msg("Protocol paused")]
    DATNotActive,

    #[msg("Below flush threshold - accumulating")]
    InsufficientFees,

    #[msg("Unauthorized")]
    UnauthorizedAccess,

    #[msg("Flush interval not elapsed")]
    CycleTooSoon,

    #[msg("Invalid parameter")]
    InvalidParameter,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    // Execution protection
    #[msg("Slippage exceeded - price moved unfavorably")]
    SlippageExceeded,

    #[msg("Price impact exceeds safe threshold")]
    PriceImpactTooHigh,

    #[msg("Vault not initialized - execute a trade first")]
    VaultNotInitialized,

    #[msg("No tokens pending burn")]
    NoPendingBurn,

    #[msg("Invalid pool state")]
    InvalidPool,

    // Token hierarchy errors
    #[msg("Invalid root token configuration")]
    InvalidRootToken,

    #[msg("Invalid root treasury")]
    InvalidRootTreasury,

    // Fee split errors
    #[msg("Fee split must be 0-10000 bps")]
    InvalidFeeSplit,

    #[msg("Fee split delta exceeds 5% maximum")]
    FeeSplitDeltaTooLarge,

    // Pool/liquidity errors
    #[msg("Insufficient pool liquidity")]
    InsufficientPoolLiquidity,

    // Validator errors
    #[msg("Slot already processed")]
    StaleValidation,

    #[msg("Slot range exceeds maximum")]
    SlotRangeTooLarge,

    #[msg("Validator current - sync not needed")]
    ValidatorNotStale,

    #[msg("Fee amount exceeds range maximum")]
    FeeTooHigh,

    #[msg("Transaction count exceeds range maximum")]
    TooManyTransactions,

    // Account validation
    #[msg("Invalid bonding curve")]
    InvalidBondingCurve,

    #[msg("Mint mismatch")]
    MintMismatch,

    #[msg("Pending fees at maximum capacity")]
    PendingFeesOverflow,

    // Admin operations
    #[msg("No pending admin transfer")]
    NoPendingAdminTransfer,

    #[msg("No pending fee split change")]
    NoPendingFeeSplit,

    #[msg("Invalid account owner")]
    InvalidAccountOwner,

    #[msg("Slippage exceeds 5% maximum")]
    SlippageConfigTooHigh,

    #[msg("Account size mismatch")]
    AccountSizeMismatch,

    #[msg("Invalid dev wallet address")]
    InvalidDevWallet,

    // External App Integration errors
    #[msg("Deposit below minimum threshold")]
    DepositBelowMinimum,

    #[msg("User pending contribution below rebate threshold")]
    BelowRebateThreshold,

    #[msg("Invalid rebate pool")]
    InvalidRebatePool,

    #[msg("Rebate pool insufficient funds")]
    RebatePoolInsufficient,

    #[msg("User stats not found")]
    UserStatsNotFound,
}
