use anchor_lang::prelude::*;
use anchor_spl::{
    token,
    token_interface::{self as token_interface, TokenInterface, TokenAccount, Mint},
    associated_token::AssociatedToken,
};
use crate::constants::*;
use crate::errors::ErrorCode;
use crate::state::*;

// ACCOUNTS - Instruction account validation structs

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + DATState::LEN, seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    /// CHECK: PDA
    #[account(seeds = [DAT_AUTHORITY_SEED], bump)]
    pub dat_authority: AccountInfo<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeTokenStats<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + TokenStats::LEN,
        seeds = [TOKEN_STATS_SEED, mint.key().as_ref()],
        bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    /// CHECK: Token mint
    pub mint: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRootToken<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    #[account(
        mut,
        seeds = [TOKEN_STATS_SEED, root_token_stats.mint.as_ref()],
        bump = root_token_stats.bump
    )]
    pub root_token_stats: Account<'info, TokenStats>,
    #[account(constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub admin: Signer<'info>,
}

/// CollectFees - Collect creator fees from PumpFun bonding curve vault
///
/// SECURITY NOTES (HIGH-01, HIGH-02):
/// - creator_vault: Validated by PumpFun program during CPI - the CPI will fail if
///   the vault is not a valid creator vault PDA for the dat_authority. Seeds are
///   ["creator-vault", dat_authority] verified by PUMP_PROGRAM.
/// - root_treasury: Validated at runtime in collect_fees() via PDA derivation check.
///   The function verifies the provided account matches the expected PDA derived from
///   ["root_treasury", root_token_mint].
#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    #[account(
        mut,
        seeds = [TOKEN_STATS_SEED, token_mint.key().as_ref()],
        bump = token_stats.bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: DAT authority PDA - receives SOL from creator vault
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    /// CHECK: Creator vault - validated by PumpFun program during CPI.
    /// Seeds: ["creator-vault", creator_pubkey] where creator=dat_authority.
    /// The CPI to collect_creator_fee will fail if this is not a valid vault.
    /// NOTE: Vault is a native SOL account (System Program owner), NOT owned by PUMP_PROGRAM.
    #[account(mut)]
    pub creator_vault: AccountInfo<'info>,
    /// CHECK: Event authority for PumpFun program
    pub pump_event_authority: AccountInfo<'info>,
    /// CHECK: PumpFun program (hardcoded address verified in CPI)
    pub pump_swap_program: AccountInfo<'info>,
    /// CHECK: Root treasury PDA (optional) - validated at runtime in collect_fees()
    /// via PDA derivation: ["root_treasury", root_token_mint]
    #[account(mut)]
    pub root_treasury: Option<AccountInfo<'info>>,
    pub system_program: Program<'info, System>,
}

/// CollectFeesAMM - Collect creator fees from PumpSwap AMM
/// Used for tokens that have migrated from bonding curve to AMM
#[derive(Accounts)]
pub struct CollectFeesAMM<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    #[account(
        mut,
        seeds = [TOKEN_STATS_SEED, token_mint.key().as_ref()],
        bump = token_stats.bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: DAT authority PDA - must be registered as coin_creator in PumpSwap
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    /// WSOL mint (So11111111111111111111111111111111111111112)
    pub wsol_mint: InterfaceAccount<'info, Mint>,
    /// DAT's WSOL token account (destination for collected fees)
    #[account(
        mut,
        constraint = dat_wsol_account.mint == wsol_mint.key() @ ErrorCode::InvalidParameter,
        constraint = dat_wsol_account.owner == dat_authority.key() @ ErrorCode::InvalidParameter
    )]
    pub dat_wsol_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: PumpSwap creator vault authority PDA - seeds: ["creator_vault", dat_authority]
    pub creator_vault_authority: AccountInfo<'info>,
    /// CHECK: Creator vault ATA (source of WSOL fees)
    #[account(mut)]
    pub creator_vault_ata: AccountInfo<'info>,
    /// CHECK: PumpSwap program
    pub pump_swap_program: AccountInfo<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// UnwrapWsol - Convert WSOL back to native SOL
/// Call after collect_fees_amm to enable buyback with native SOL
#[derive(Accounts)]
pub struct UnwrapWsol<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    /// CHECK: DAT authority PDA (receives unwrapped SOL)
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    /// DAT's WSOL token account (will be closed)
    #[account(
        mut,
        constraint = dat_wsol_account.owner == dat_authority.key() @ ErrorCode::InvalidParameter
    )]
    pub dat_wsol_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// WrapWsol - Convert native SOL to WSOL for AMM buyback
/// Call before execute_buy_amm when root token is on PumpSwap AMM
#[derive(Accounts)]
pub struct WrapWsol<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    /// CHECK: DAT authority PDA (source of native SOL)
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    /// DAT's WSOL token account (destination for wrapped SOL)
    /// Must be owned by dat_authority and have WSOL mint
    #[account(
        mut,
        token::mint = wsol_mint,
        token::authority = dat_authority
    )]
    pub dat_wsol_account: InterfaceAccount<'info, TokenAccount>,
    /// WSOL mint (So11111111111111111111111111111111111111112)
    pub wsol_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, token::Token>,
    pub system_program: Program<'info, System>,
}

/// ExecuteBuy - Simplified to reduce stack usage (removed unused accounts)
#[derive(Accounts)]
pub struct ExecuteBuy<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    /// CHECK: PDA (holds native SOL for buying)
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    /// DAT's token account for receiving bought tokens - validated mint and authority
    #[account(
        mut,
        constraint = dat_asdf_account.mint == asdf_mint.key() @ ErrorCode::InvalidParameter,
        constraint = dat_asdf_account.owner == dat_authority.key() @ ErrorCode::InvalidParameter
    )]
    pub dat_asdf_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Pool (bonding curve) - validated by PumpFun program
    #[account(mut, constraint = pool.owner == &PUMP_PROGRAM @ ErrorCode::InvalidBondingCurve)]
    pub pool: AccountInfo<'info>,
    /// CHECK: Token mint (validation done by PumpFun)
    #[account(mut)]
    pub asdf_mint: AccountInfo<'info>,
    #[account(mut)]
    pub pool_asdf_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Config
    pub pump_global_config: AccountInfo<'info>,
    /// CHECK: Recipient
    #[account(mut)]
    pub protocol_fee_recipient: AccountInfo<'info>,
    /// CHECK: Creator vault (PDA from token creator)
    #[account(mut)]
    pub creator_vault: AccountInfo<'info>,
    /// CHECK: Event auth
    pub pump_event_authority: AccountInfo<'info>,
    /// CHECK: Pump program
    pub pump_swap_program: AccountInfo<'info>,
    /// CHECK: Global volume accumulator (PDA)
    pub global_volume_accumulator: AccountInfo<'info>,
    /// CHECK: User volume accumulator (PDA)
    #[account(mut)]
    pub user_volume_accumulator: AccountInfo<'info>,
    /// CHECK: Fee config (PDA)
    pub fee_config: AccountInfo<'info>,
    /// CHECK: Fee program
    pub fee_program: AccountInfo<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteBuySecondary<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    /// CHECK: PDA (holds native SOL for buying)
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    /// DAT's token account - validated mint and authority
    #[account(
        mut,
        constraint = dat_asdf_account.mint == asdf_mint.key() @ ErrorCode::InvalidParameter,
        constraint = dat_asdf_account.owner == dat_authority.key() @ ErrorCode::InvalidParameter
    )]
    pub dat_asdf_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Pool (bonding curve) - validated owner
    #[account(mut, constraint = pool.owner == &PUMP_PROGRAM @ ErrorCode::InvalidBondingCurve)]
    pub pool: AccountInfo<'info>,
    #[account(mut)]
    pub asdf_mint: InterfaceAccount<'info, Mint>,
    /// Pool's token account - validated mint matches
    #[account(
        mut,
        constraint = pool_asdf_account.mint == asdf_mint.key() @ ErrorCode::InvalidParameter
    )]
    pub pool_asdf_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Config
    pub pump_global_config: AccountInfo<'info>,
    /// CHECK: Recipient
    #[account(mut)]
    pub protocol_fee_recipient: AccountInfo<'info>,
    /// CHECK: Creator vault (PDA from token creator)
    #[account(mut)]
    pub creator_vault: AccountInfo<'info>,
    /// CHECK: Event auth
    pub pump_event_authority: AccountInfo<'info>,
    /// CHECK: Pump program - validated program ID via constraint
    #[account(constraint = pump_swap_program.key() == PUMP_PROGRAM @ ErrorCode::InvalidParameter)]
    pub pump_swap_program: AccountInfo<'info>,
    /// CHECK: Global volume accumulator (PDA)
    pub global_volume_accumulator: AccountInfo<'info>,
    /// CHECK: User volume accumulator (PDA)
    #[account(mut)]
    pub user_volume_accumulator: AccountInfo<'info>,
    /// CHECK: Fee config (PDA)
    pub fee_config: AccountInfo<'info>,
    /// CHECK: Fee program
    pub fee_program: AccountInfo<'info>,
    /// CHECK: Root treasury PDA (REQUIRED for secondary tokens)
    #[account(mut)]
    pub root_treasury: Option<AccountInfo<'info>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// ExecuteBuyAMM - For PumpSwap AMM pools (migrated tokens)
/// Requires 23+ accounts as per PumpSwap AMM specification
#[derive(Accounts)]
pub struct ExecuteBuyAMM<'info> {
    // DAT State accounts
    #[account(mut, seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    /// CHECK: PDA authority (holds WSOL, acts as "user" in AMM)
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    /// DAT's token account for receiving bought tokens - validated mint and authority
    #[account(
        mut,
        constraint = dat_token_account.mint == base_mint.key() @ ErrorCode::InvalidParameter,
        constraint = dat_token_account.owner == dat_authority.key() @ ErrorCode::InvalidParameter
    )]
    pub dat_token_account: InterfaceAccount<'info, TokenAccount>,

    // PumpSwap AMM Core accounts (1-9)
    /// CHECK: AMM Pool account - owned by PumpSwap program
    #[account(mut, constraint = pool.owner == &PUMP_SWAP_PROGRAM @ ErrorCode::InvalidBondingCurve)]
    pub pool: AccountInfo<'info>,
    /// CHECK: PumpSwap global config
    pub global_config: AccountInfo<'info>,
    /// Base token mint (the token being bought)
    pub base_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Quote token mint (WSOL)
    pub quote_mint: AccountInfo<'info>,
    /// CHECK: DAT's WSOL account (user_quote_token_account)
    #[account(mut)]
    pub dat_wsol_account: AccountInfo<'info>,
    /// CHECK: Pool's base token account
    #[account(mut)]
    pub pool_base_token_account: AccountInfo<'info>,
    /// CHECK: Pool's quote token account (WSOL)
    #[account(mut)]
    pub pool_quote_token_account: AccountInfo<'info>,

    // Protocol fee accounts (10-11)
    /// CHECK: Protocol fee recipient
    pub protocol_fee_recipient: AccountInfo<'info>,
    /// CHECK: Protocol fee recipient's token account (PDA)
    #[account(mut)]
    pub protocol_fee_recipient_ata: AccountInfo<'info>,

    // Program accounts (12-17)
    /// Base token program (SPL Token or Token2022)
    pub base_token_program: Interface<'info, TokenInterface>,
    /// CHECK: Quote token program (always SPL Token for WSOL) - validated via constraint
    #[account(constraint = quote_token_program.key() == anchor_spl::token::ID @ ErrorCode::InvalidParameter)]
    pub quote_token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Associated token program
    pub associated_token_program: AccountInfo<'info>,
    /// CHECK: PumpSwap event authority (PDA) - derived from program
    pub event_authority: AccountInfo<'info>,
    /// CHECK: PumpSwap AMM program - validated via constraint
    #[account(constraint = pump_swap_program.key() == PUMP_SWAP_PROGRAM @ ErrorCode::InvalidParameter)]
    pub pump_swap_program: AccountInfo<'info>,

    // Creator fee accounts (18-19)
    /// CHECK: Coin creator vault ATA (receives creator fees)
    #[account(mut)]
    pub coin_creator_vault_ata: AccountInfo<'info>,
    /// CHECK: Coin creator vault authority (PDA)
    pub coin_creator_vault_authority: AccountInfo<'info>,

    // Volume tracking accounts (20-23)
    /// CHECK: Global volume accumulator (PDA)
    pub global_volume_accumulator: AccountInfo<'info>,
    /// CHECK: User volume accumulator (PDA)
    #[account(mut)]
    pub user_volume_accumulator: AccountInfo<'info>,
    /// CHECK: Fee config (PDA)
    pub fee_config: AccountInfo<'info>,
    /// CHECK: Fee program
    pub fee_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct FinalizeAllocatedCycle<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,

    #[account(
        mut,
        seeds = [TOKEN_STATS_SEED, token_stats.mint.as_ref()],
        bump = token_stats.bump
    )]
    pub token_stats: Account<'info, TokenStats>,

    /// Admin signer required - only admin can finalize allocated cycles
    #[account(constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct BurnAndUpdate<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    #[account(
        mut,
        seeds = [TOKEN_STATS_SEED, asdf_mint.key().as_ref()],
        bump = token_stats.bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    /// CHECK: PDA
    #[account(seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    #[account(mut)]
    pub dat_asdf_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = asdf_mint.to_account_info().owner == token_program.key @ ErrorCode::InvalidAccountOwner
    )]
    pub asdf_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RecordFailure<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump, constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub dat_state: Account<'info, DATState>,
    /// Admin signer required to prevent DoS attacks
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminControl<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump, constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub dat_state: Account<'info, DATState>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdatePendingFees<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump, constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub dat_state: Account<'info, DATState>,
    #[account(
        mut,
        seeds = [TOKEN_STATS_SEED, mint.key().as_ref()],
        bump,
        constraint = token_stats.mint == mint.key() @ ErrorCode::MintMismatch
    )]
    pub token_stats: Account<'info, TokenStats>,
    /// CHECK: Token mint being tracked
    pub mint: AccountInfo<'info>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeValidator<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + ValidatorState::LEN,
        seeds = [VALIDATOR_STATE_SEED, mint.key().as_ref()],
        bump
    )]
    pub validator_state: Account<'info, ValidatorState>,

    /// CHECK: Bonding curve account - verified by owner constraint
    #[account(constraint = bonding_curve.owner == &PUMP_PROGRAM @ ErrorCode::InvalidBondingCurve)]
    pub bonding_curve: AccountInfo<'info>,

    /// CHECK: Token mint
    pub mint: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterValidatedFees<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,

    /// Admin signer - only admin can register fees (CRITICAL security fix)
    #[account(constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [VALIDATOR_STATE_SEED, validator_state.mint.as_ref()],
        bump = validator_state.bump,
    )]
    pub validator_state: Account<'info, ValidatorState>,

    #[account(
        mut,
        seeds = [TOKEN_STATS_SEED, validator_state.mint.as_ref()],
        bump = token_stats.bump,
        constraint = token_stats.mint == validator_state.mint @ ErrorCode::MintMismatch
    )]
    pub token_stats: Account<'info, TokenStats>,
}

/// Accounts for sync_validator_slot instruction
/// HIGH-02 FIX: Now requires admin authorization to prevent DoS attacks
#[derive(Accounts)]
pub struct SyncValidatorSlot<'info> {
    // HIGH-02 FIX: Added DATState and admin signer for authorization
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,

    #[account(
        mut,
        seeds = [VALIDATOR_STATE_SEED, validator_state.mint.as_ref()],
        bump = validator_state.bump,
    )]
    pub validator_state: Account<'info, ValidatorState>,

    /// Admin authority - HIGH-02 FIX: Required to prevent DoS
    #[account(
        constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess
    )]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResetValidatorSlot<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,

    #[account(
        mut,
        seeds = [VALIDATOR_STATE_SEED, validator_state.mint.as_ref()],
        bump = validator_state.bump,
    )]
    pub validator_state: Account<'info, ValidatorState>,

    #[account(constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct MigrateTokenStats<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump, constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub dat_state: Account<'info, DATState>,
    #[account(mut, constraint = token_stats.owner == &crate::ID @ ErrorCode::InvalidAccountOwner)]
    /// CHECK: Manual PDA verification and deserialization for migration
    pub token_stats: AccountInfo<'info>,
    /// CHECK: Mint address for PDA derivation
    pub mint: AccountInfo<'info>,
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// ProposeAdminTransfer - Current admin proposes a new admin (two-step transfer)
#[derive(Accounts)]
pub struct ProposeAdminTransfer<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump, constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub dat_state: Account<'info, DATState>,
    pub admin: Signer<'info>,
    /// CHECK: Proposed new admin (will need to accept)
    pub new_admin: AccountInfo<'info>,
}

/// CancelAdminTransfer - Current admin cancels a pending transfer
#[derive(Accounts)]
pub struct CancelAdminTransfer<'info> {
    #[account(
        mut,
        seeds = [DAT_STATE_SEED],
        bump,
        constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess,
        constraint = dat_state.pending_admin.is_some() @ ErrorCode::InvalidParameter
    )]
    pub dat_state: Account<'info, DATState>,
    pub admin: Signer<'info>,
}

/// AcceptAdminTransfer - Proposed admin accepts the transfer (two-step transfer)
#[derive(Accounts)]
pub struct AcceptAdminTransfer<'info> {
    #[account(
        mut,
        seeds = [DAT_STATE_SEED],
        bump,
        constraint = dat_state.pending_admin == Some(new_admin.key()) @ ErrorCode::UnauthorizedAccess
    )]
    pub dat_state: Account<'info, DATState>,
    /// The proposed admin who is accepting the transfer
    pub new_admin: Signer<'info>,
}

/// DEPRECATED: Use ProposeAdminTransfer + AcceptAdminTransfer instead
/// Kept for backwards compatibility but now just calls propose_admin_transfer
#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump, constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub dat_state: Account<'info, DATState>,
    pub admin: Signer<'info>,
    /// CHECK: New admin
    pub new_admin: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CreatePumpfunToken<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    /// CHECK: PDA
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    #[account(mut, constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub mint: Signer<'info>,
    /// CHECK: PDA
    #[account(mut)]
    pub mint_authority: AccountInfo<'info>,
    /// CHECK: PDA
    #[account(mut)]
    pub bonding_curve: AccountInfo<'info>,
    /// CHECK: ATA
    #[account(mut)]
    pub associated_bonding_curve: AccountInfo<'info>,
    /// CHECK: Metadata
    #[account(mut)]
    pub metadata: AccountInfo<'info>,
    /// CHECK: Global
    #[account(mut)]
    pub global: AccountInfo<'info>,
    /// CHECK: Metaplex
    pub mpl_token_metadata: AccountInfo<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// CHECK: Rent
    pub rent: AccountInfo<'info>,
    /// CHECK: Event authority
    pub event_authority: AccountInfo<'info>,
    /// CHECK: Pump program
    pub pump_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CreatePumpfunTokenMayhem<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,

    /// CHECK: PDA - DAT Authority acts as token creator
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,

    #[account(mut, constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub admin: Signer<'info>,

    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: PDA from pump program (mint-authority seed)
    pub mint_authority: AccountInfo<'info>,

    /// CHECK: Bonding curve PDA (82 bytes for Mayhem Mode - 81 + 1 for is_mayhem_mode flag)
    #[account(mut)]
    pub bonding_curve: AccountInfo<'info>,

    /// CHECK: Associated bonding curve token account (Token2022 ATA)
    #[account(mut)]
    pub associated_bonding_curve: AccountInfo<'info>,

    /// CHECK: Global config PDA from pump program
    pub global: AccountInfo<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Token2022 program (not legacy Token program!)
    pub token_2022_program: AccountInfo<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    /// CHECK: Mayhem program - handles AI agent trading
    #[account(mut)]
    pub mayhem_program: AccountInfo<'info>,

    /// CHECK: Global params PDA from mayhem program
    pub global_params: AccountInfo<'info>,

    /// CHECK: SOL vault PDA from mayhem program
    #[account(mut)]
    pub sol_vault: AccountInfo<'info>,

    /// CHECK: Mayhem state PDA (derived from mint)
    #[account(mut)]
    pub mayhem_state: AccountInfo<'info>,

    /// CHECK: Mayhem token vault (Token2022 ATA)
    #[account(mut)]
    pub mayhem_token_vault: AccountInfo<'info>,

    /// CHECK: Event authority PDA
    pub event_authority: AccountInfo<'info>,

    /// CHECK: Main pump program (6EF8r...)
    pub pump_program: AccountInfo<'info>,
}

/// TransferDevFee - Transfer 1% dev sustainability fee at end of batch
/// Called after burn to ensure cycle completed successfully before taking fee
#[derive(Accounts)]
pub struct TransferDevFee<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,

    /// CHECK: DAT authority PDA - source of SOL for dev fee
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,

    /// CHECK: Dev wallet - validated against hardcoded constant
    /// 1% today = 99% burns forever
    #[account(
        mut,
        address = DEV_WALLET @ ErrorCode::InvalidDevWallet
    )]
    pub dev_wallet: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

// ══════════════════════════════════════════════════════════════════════════════
// EXTERNAL APP INTEGRATION CONTEXTS
// ══════════════════════════════════════════════════════════════════════════════

/// InitializeRebatePool - Initialize the self-sustaining rebate pool
/// Called once during protocol setup
#[derive(Accounts)]
pub struct InitializeRebatePool<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + RebatePool::LEN,
        seeds = [REBATE_POOL_SEED],
        bump
    )]
    pub rebate_pool: Account<'info, RebatePool>,

    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,

    /// Admin must authorize initialization
    #[account(
        mut,
        constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess
    )]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// DepositFeeAsdf - External app deposits $ASDF fees with automatic split
/// Split: 99.448% → DAT ATA (burn), 0.552% → Rebate Pool ATA (rebates)
#[derive(Accounts)]
pub struct DepositFeeAsdf<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,

    /// CHECK: DAT authority PDA
    #[account(seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,

    /// Rebate pool state (for tracking deposits)
    #[account(
        mut,
        seeds = [REBATE_POOL_SEED],
        bump = rebate_pool.bump
    )]
    pub rebate_pool: Account<'info, RebatePool>,

    /// User stats - initialized if needed
    /// Protocol pays rent via dat_authority
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UserStats::LEN,
        seeds = [USER_STATS_SEED, user.key().as_ref()],
        bump
    )]
    pub user_stats: Account<'info, UserStats>,

    /// The user whose contribution is being tracked
    /// CHECK: Any valid pubkey (user being credited)
    pub user: AccountInfo<'info>,

    /// Payer's $ASDF token account (source of deposit)
    #[account(
        mut,
        constraint = payer_token_account.mint == dat_state.asdf_mint @ ErrorCode::MintMismatch
    )]
    pub payer_token_account: InterfaceAccount<'info, TokenAccount>,

    /// DAT's $ASDF token account (receives 99.448% for burn)
    #[account(
        mut,
        constraint = dat_asdf_account.mint == dat_state.asdf_mint @ ErrorCode::MintMismatch,
        constraint = dat_asdf_account.owner == dat_authority.key() @ ErrorCode::InvalidParameter
    )]
    pub dat_asdf_account: InterfaceAccount<'info, TokenAccount>,

    /// Rebate pool's $ASDF ATA (receives 0.552% for rebates)
    #[account(
        mut,
        constraint = rebate_pool_ata.mint == dat_state.asdf_mint @ ErrorCode::MintMismatch
    )]
    pub rebate_pool_ata: InterfaceAccount<'info, TokenAccount>,

    /// Transaction payer (can be builder or protocol)
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// ProcessUserRebate - Transfer rebate from pool to selected user
/// Called as LAST instruction in ROOT cycle batch
/// NOTE: Does NOT burn - burn is done in single ROOT cycle burn instruction
#[derive(Accounts)]
pub struct ProcessUserRebate<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,

    /// Rebate pool authority PDA
    #[account(
        mut,
        seeds = [REBATE_POOL_SEED],
        bump = rebate_pool.bump
    )]
    pub rebate_pool: Account<'info, RebatePool>,

    /// Rebate pool's $ASDF ATA (source of rebate funds)
    #[account(
        mut,
        constraint = rebate_pool_ata.mint == dat_state.asdf_mint @ ErrorCode::MintMismatch
    )]
    pub rebate_pool_ata: InterfaceAccount<'info, TokenAccount>,

    /// Selected user's stats
    #[account(
        mut,
        seeds = [USER_STATS_SEED, user.key().as_ref()],
        bump = user_stats.bump,
        constraint = user_stats.user == user.key() @ ErrorCode::InvalidParameter
    )]
    pub user_stats: Account<'info, UserStats>,

    /// CHECK: User receiving rebate
    pub user: AccountInfo<'info>,

    /// User's $ASDF ATA (destination for rebate)
    #[account(
        mut,
        constraint = user_ata.mint == dat_state.asdf_mint @ ErrorCode::MintMismatch,
        constraint = user_ata.owner == user.key() @ ErrorCode::InvalidParameter
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

    /// Admin authorization for rebate processing
    #[account(constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub admin: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
