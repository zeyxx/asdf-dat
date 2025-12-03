use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::{
    token,
    token_interface::{self as token_interface, TokenInterface, TokenAccount, Mint},
    associated_token::AssociatedToken,
};

// Include unit tests module (only compiled when running tests)
#[cfg(test)]
mod tests;

// Modular architecture (Phase 2 ready)
pub mod constants;
pub mod contexts;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod state;

// Re-export for external access
pub use constants::*;
pub use contexts::*;
pub use errors::ErrorCode;  // Explicit import to avoid ambiguity with anchor_lang
pub use events::*;
pub use helpers::*;
pub use state::*;

declare_id!("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

// HELPERS - Math and CPI functions now in helpers/ module (see pub use helpers::*;)
// NOTE: PumpSwap AMM buys are handled by the TypeScript orchestrator using @pump-fun/pump-swap-sdk
// The program provides record_external_buy() to record the results after orchestrator completes the buy

/// Build account infos Vec on heap (separate function to isolate stack frame)
#[inline(never)]
fn build_account_infos_root<'info>(accounts: &ExecuteBuy<'info>) -> Vec<AccountInfo<'info>> {
    let mut accs = Vec::with_capacity(16);
    accs.push(accounts.pump_global_config.to_account_info());
    accs.push(accounts.protocol_fee_recipient.to_account_info());
    accs.push(accounts.asdf_mint.to_account_info());
    accs.push(accounts.pool.to_account_info());
    accs.push(accounts.pool_asdf_account.to_account_info());
    accs.push(accounts.dat_asdf_account.to_account_info());
    accs.push(accounts.dat_authority.to_account_info());
    accs.push(accounts.system_program.to_account_info());
    accs.push(accounts.token_program.to_account_info());
    accs.push(accounts.creator_vault.to_account_info());
    accs.push(accounts.pump_event_authority.to_account_info());
    accs.push(accounts.pump_swap_program.to_account_info());
    accs.push(accounts.global_volume_accumulator.to_account_info());
    accs.push(accounts.user_volume_accumulator.to_account_info());
    accs.push(accounts.fee_config.to_account_info());
    accs.push(accounts.fee_program.to_account_info());
    accs
}

/// Inner execute buy logic - uses Vec on heap to avoid stack overflow
#[inline(never)]
fn execute_buy_inner(ctx: Context<ExecuteBuy>, buy_amount: u64) -> Result<()> {
    let bump = ctx.accounts.dat_state.dat_authority_bump;
    let max_fees = ctx.accounts.dat_state.max_fees_per_cycle;
    let slippage = ctx.accounts.dat_state.slippage_bps;

    // NOTE: reload() required before reading pool state - Anchor doesn't auto-reload for manual invoke_signed CPI
    ctx.accounts.pool_asdf_account.reload()?;
    let pool_data = ctx.accounts.pool.try_borrow_data()?.to_vec();
    let (max_sol_cost, desired_tokens) = calculate_buy_amount_and_slippage(buy_amount, &pool_data, max_fees, slippage)?;

    // Build account infos on heap in separate stack frame
    let accs = build_account_infos_root(&ctx.accounts);

    let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[bump]];
    execute_pumpfun_cpi(
        ctx.accounts.pump_global_config.key(),
        ctx.accounts.protocol_fee_recipient.key(),
        ctx.accounts.asdf_mint.key(),
        ctx.accounts.pool.key(),
        ctx.accounts.pool_asdf_account.key(),
        ctx.accounts.dat_asdf_account.key(),
        ctx.accounts.dat_authority.key(),
        max_sol_cost,
        desired_tokens,
        &accs,
        seeds,
    )?;

    // NOTE: reload() required after CPI to get updated token balance - Anchor doesn't auto-reload for invoke_signed
    ctx.accounts.dat_asdf_account.reload()?;
    ctx.accounts.dat_state.pending_burn_amount = ctx.accounts.dat_asdf_account.amount;
    ctx.accounts.dat_state.last_cycle_sol = max_sol_cost;
    Ok(())
}

/// Build account infos Vec on heap for secondary tokens (separate function to isolate stack frame)
#[inline(never)]
fn build_account_infos_secondary<'info>(accounts: &ExecuteBuySecondary<'info>) -> Vec<AccountInfo<'info>> {
    let mut accs = Vec::with_capacity(16);
    accs.push(accounts.pump_global_config.to_account_info());
    accs.push(accounts.protocol_fee_recipient.to_account_info());
    accs.push(accounts.asdf_mint.to_account_info());
    accs.push(accounts.pool.to_account_info());
    accs.push(accounts.pool_asdf_account.to_account_info());
    accs.push(accounts.dat_asdf_account.to_account_info());
    accs.push(accounts.dat_authority.to_account_info());
    accs.push(accounts.system_program.to_account_info());
    accs.push(accounts.token_program.to_account_info());
    accs.push(accounts.creator_vault.to_account_info());
    accs.push(accounts.pump_event_authority.to_account_info());
    accs.push(accounts.pump_swap_program.to_account_info());
    accs.push(accounts.global_volume_accumulator.to_account_info());
    accs.push(accounts.user_volume_accumulator.to_account_info());
    accs.push(accounts.fee_config.to_account_info());
    accs.push(accounts.fee_program.to_account_info());
    accs
}

/// Execute secondary buy CPI (separate to reduce stack in main function)
#[inline(never)]
fn execute_buy_secondary_cpi(ctx: &mut Context<ExecuteBuySecondary>, buy_amount: u64, bump: u8) -> Result<()> {
    let max_fees = ctx.accounts.dat_state.max_fees_per_cycle;
    let slippage = ctx.accounts.dat_state.slippage_bps;

    // NOTE: reload() required before reading pool state - Anchor doesn't auto-reload for manual invoke_signed CPI
    ctx.accounts.pool_asdf_account.reload()?;
    let pool_data = ctx.accounts.pool.try_borrow_data()?.to_vec();
    let (max_sol_cost, desired_tokens) = calculate_buy_amount_and_slippage(buy_amount, &pool_data, max_fees, slippage)?;

    let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[bump]];

    // Build account infos on heap in separate stack frame
    let accs = build_account_infos_secondary(&ctx.accounts);

    execute_pumpfun_cpi(
        ctx.accounts.pump_global_config.key(),
        ctx.accounts.protocol_fee_recipient.key(),
        ctx.accounts.asdf_mint.key(),
        ctx.accounts.pool.key(),
        ctx.accounts.pool_asdf_account.key(),
        ctx.accounts.dat_asdf_account.key(),
        ctx.accounts.dat_authority.key(),
        max_sol_cost,
        desired_tokens,
        &accs,
        seeds,
    )?;

    // NOTE: reload() required after CPI to get updated token balance - Anchor doesn't auto-reload for invoke_signed
    ctx.accounts.dat_asdf_account.reload()?;
    ctx.accounts.dat_state.pending_burn_amount = ctx.accounts.dat_asdf_account.amount;
    ctx.accounts.dat_state.last_cycle_sol = max_sol_cost;
    Ok(())
}

/// CPI executor for PumpSwap AMM buy (for migrated tokens)
/// Account order matches PumpSwap AMM buy instruction from official IDL
#[inline(never)]
fn execute_pumpswap_amm_cpi_inner<'info>(
    accounts: &ExecuteBuyAMM<'info>,
    base_amount_out: u64,      // tokens to receive (desired_tokens)
    max_quote_amount_in: u64,  // max WSOL to spend (max_sol_cost)
    bump: u8,                  // dat_authority bump
) -> Result<()> {
    // Build instruction data:
    // - 8 bytes discriminator
    // - 8 bytes base_amount_out
    // - 8 bytes max_quote_amount_in
    // - 2 bytes track_volume (OptionBool: 1 byte presence + 1 byte value)
    let mut data = Vec::with_capacity(26);
    data.extend_from_slice(&PUMPSWAP_BUY_DISCRIMINATOR);
    data.extend_from_slice(&base_amount_out.to_le_bytes());
    data.extend_from_slice(&max_quote_amount_in.to_le_bytes());
    // track_volume = Some(true) for fee tracking
    data.push(1); // Some variant
    data.push(1); // true value

    // Build accounts in exact order required by PumpSwap AMM buy instruction
    let ix_accounts = vec![
        // 1. pool (mut)
        AccountMeta::new(accounts.pool.key(), false),
        // 2. user (mut, signer) - dat_authority acts as user
        AccountMeta::new(accounts.dat_authority.key(), true),
        // 3. global_config
        AccountMeta::new_readonly(accounts.global_config.key(), false),
        // 4. base_mint (token being bought)
        AccountMeta::new_readonly(accounts.base_mint.key(), false),
        // 5. quote_mint (WSOL)
        AccountMeta::new_readonly(accounts.quote_mint.key(), false),
        // 6. user_base_token_account (mut) - where bought tokens go
        AccountMeta::new(accounts.dat_token_account.key(), false),
        // 7. user_quote_token_account (mut) - WSOL source
        AccountMeta::new(accounts.dat_wsol_account.key(), false),
        // 8. pool_base_token_account (mut)
        AccountMeta::new(accounts.pool_base_token_account.key(), false),
        // 9. pool_quote_token_account (mut)
        AccountMeta::new(accounts.pool_quote_token_account.key(), false),
        // 10. protocol_fee_recipient
        AccountMeta::new_readonly(accounts.protocol_fee_recipient.key(), false),
        // 11. protocol_fee_recipient_token_account (mut)
        AccountMeta::new(accounts.protocol_fee_recipient_ata.key(), false),
        // 12. base_token_program
        AccountMeta::new_readonly(accounts.base_token_program.key(), false),
        // 13. quote_token_program
        AccountMeta::new_readonly(accounts.quote_token_program.key(), false),
        // 14. system_program
        AccountMeta::new_readonly(accounts.system_program.key(), false),
        // 15. associated_token_program
        AccountMeta::new_readonly(accounts.associated_token_program.key(), false),
        // 16. event_authority (PDA)
        AccountMeta::new_readonly(accounts.event_authority.key(), false),
        // 17. program (PumpSwap AMM)
        AccountMeta::new_readonly(accounts.pump_swap_program.key(), false),
        // 18. coin_creator_vault_ata (mut)
        AccountMeta::new(accounts.coin_creator_vault_ata.key(), false),
        // 19. coin_creator_vault_authority
        AccountMeta::new_readonly(accounts.coin_creator_vault_authority.key(), false),
        // 20. global_volume_accumulator
        AccountMeta::new_readonly(accounts.global_volume_accumulator.key(), false),
        // 21. user_volume_accumulator (mut)
        AccountMeta::new(accounts.user_volume_accumulator.key(), false),
        // 22. fee_config
        AccountMeta::new_readonly(accounts.fee_config.key(), false),
        // 23. fee_program
        AccountMeta::new_readonly(accounts.fee_program.key(), false),
    ];

    let ix = Instruction {
        program_id: PUMP_SWAP_PROGRAM,
        accounts: ix_accounts,
        data,
    };

    // Build account infos for invoke_signed
    let account_infos = &[
        accounts.pool.to_account_info(),
        accounts.dat_authority.to_account_info(),
        accounts.global_config.to_account_info(),
        accounts.base_mint.to_account_info(),
        accounts.quote_mint.to_account_info(),
        accounts.dat_token_account.to_account_info(),
        accounts.dat_wsol_account.to_account_info(),
        accounts.pool_base_token_account.to_account_info(),
        accounts.pool_quote_token_account.to_account_info(),
        accounts.protocol_fee_recipient.to_account_info(),
        accounts.protocol_fee_recipient_ata.to_account_info(),
        accounts.base_token_program.to_account_info(),
        accounts.quote_token_program.to_account_info(),
        accounts.system_program.to_account_info(),
        accounts.associated_token_program.to_account_info(),
        accounts.event_authority.to_account_info(),
        accounts.pump_swap_program.to_account_info(),
        accounts.coin_creator_vault_ata.to_account_info(),
        accounts.coin_creator_vault_authority.to_account_info(),
        accounts.global_volume_accumulator.to_account_info(),
        accounts.user_volume_accumulator.to_account_info(),
        accounts.fee_config.to_account_info(),
        accounts.fee_program.to_account_info(),
    ];

    let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[bump]];

    invoke_signed(&ix, account_infos, &[seeds])?;
    Ok(())
}

#[program]
pub mod asdf_dat {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;
        
        state.admin = ctx.accounts.admin.key();
        state.asdf_mint = ASDF_MINT;
        state.wsol_mint = WSOL_MINT;
        state.pool_address = POOL_PUMPSWAP;
        state.pump_swap_program = PUMP_SWAP_PROGRAM;
        state.total_burned = 0;
        state.total_sol_collected = 0;
        state.total_buybacks = 0;
        state.failed_cycles = 0;
        state.consecutive_failures = 0;
        state.is_active = true;
        state.emergency_pause = false;
        state.last_cycle_timestamp = 0;
        state.initialized_at = clock.unix_timestamp;
        state.last_am_execution = 0;
        state.last_pm_execution = 0;
        state.min_fees_threshold = MIN_FEES_TO_CLAIM;
        state.max_fees_per_cycle = MAX_FEES_PER_CYCLE;
        state.slippage_bps = INITIAL_SLIPPAGE_BPS;
        state.min_cycle_interval = MIN_CYCLE_INTERVAL;
        state.dat_authority_bump = ctx.bumps.dat_authority;
        state.current_fee_recipient_index = 0;
        state.last_known_price = 0;
        state.pending_burn_amount = 0;
        state.root_token_mint = None;        // No root token by default
        state.fee_split_bps = 5520;          // 55.2% keep, 44.8% to root
        state.last_sol_sent_to_root = 0;
        // Security audit additions (v2)
        state.pending_admin = None;           // No pending admin transfer
        state.pending_fee_split = None;       // No pending fee split change
        state.pending_fee_split_timestamp = 0;
        state.admin_operation_cooldown = 3600; // Default 1 hour cooldown
        // HIGH-01 FIX: Separate timestamp for direct fee split changes
        state.last_direct_fee_split_timestamp = 0;

        emit!(DATInitialized {
            admin: state.admin,
            dat_authority: ctx.accounts.dat_authority.key(),
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    // Initialize per-token statistics tracking
    pub fn initialize_token_stats(ctx: Context<InitializeTokenStats>) -> Result<()> {
        let stats = &mut ctx.accounts.token_stats;
        let clock = Clock::get()?;

        stats.mint = ctx.accounts.mint.key();
        stats.total_burned = 0;
        stats.total_sol_collected = 0;
        stats.total_sol_used = 0;
        stats.total_sol_sent_to_root = 0;
        stats.total_sol_received_from_others = 0;
        stats.total_buybacks = 0;
        stats.last_cycle_timestamp = 0;
        stats.last_cycle_sol = 0;
        stats.last_cycle_burned = 0;
        stats.is_root_token = false;  // Will be set when assigned as root
        stats.bump = ctx.bumps.token_stats;
        // Initialize new fields for per-token fee tracking
        stats.pending_fees_lamports = 0;
        stats.last_fee_update_timestamp = clock.unix_timestamp;
        stats.cycles_participated = 0;

        emit!(TokenStatsInitialized {
            mint: stats.mint,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    // Set the root token that receives 44.8% from other tokens
    pub fn set_root_token(ctx: Context<SetRootToken>, root_mint: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;

        // Verify admin authorization
        require!(
            ctx.accounts.admin.key() == state.admin,
            ErrorCode::UnauthorizedAccess
        );

        // Verify TokenStats exists for this mint
        require!(
            ctx.accounts.root_token_stats.mint == root_mint,
            ErrorCode::InvalidRootToken
        );

        // Mark previous root as non-root (if any)
        // Note: This would require passing old root token stats too
        // For now, admin must manually handle old root if changing

        // Update state
        state.root_token_mint = Some(root_mint);

        // Mark this token as root
        let root_stats = &mut ctx.accounts.root_token_stats;
        root_stats.is_root_token = true;

        emit!(RootTokenSet {
            root_mint,
            fee_split_bps: state.fee_split_bps,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Update ASDF mint address (admin only, TESTING mode only)
    /// Used for devnet testing where the initial mint may be incorrect.
    /// This instruction is DISABLED on mainnet (TESTING_MODE = false).
    #[cfg(feature = "testing")]
    pub fn update_asdf_mint(ctx: Context<AdminControl>, new_asdf_mint: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;

        // Update the mint
        let old_mint = state.asdf_mint;
        state.asdf_mint = new_asdf_mint;

        msg!(
            "ASDF mint updated: {} -> {} (TESTING MODE ONLY)",
            old_mint,
            new_asdf_mint
        );

        emit!(AsdfMintUpdated {
            old_mint,
            new_mint: new_asdf_mint,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    // Update the fee split ratio (admin only)
    // Bounded between 1000 (10%) and 9000 (90%) to prevent extreme configurations
    // HIGH-02 FIX: Maximum 5% (500 bps) change per call to prevent instant rug
    // HIGH-03 FIX: 1 hour cooldown between changes to prevent rapid manipulation
    // NOTE: For larger changes, use propose_fee_split + execute_fee_split (timelocked)
    pub fn update_fee_split(ctx: Context<AdminControl>, new_fee_split_bps: u16) -> Result<()> {
        require!(
            new_fee_split_bps >= 1000 && new_fee_split_bps <= 9000,
            ErrorCode::InvalidFeeSplit
        );

        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;

        // HIGH-01 FIX: Enforce cooldown between DIRECT fee split changes
        // Uses separate timestamp from propose_fee_split to prevent bypass attacks
        let elapsed = clock.unix_timestamp.saturating_sub(state.last_direct_fee_split_timestamp);
        require!(
            elapsed >= state.admin_operation_cooldown,
            ErrorCode::CycleTooSoon
        );

        let old_fee_split_bps = state.fee_split_bps;

        // Limit instant changes to max 5% (500 bps) per call
        // HIGH-01 FIX: Use pure unsigned arithmetic to avoid any signed overflow concerns
        let delta: u16 = if new_fee_split_bps >= old_fee_split_bps {
            new_fee_split_bps - old_fee_split_bps
        } else {
            old_fee_split_bps - new_fee_split_bps
        };
        require!(delta <= 500, ErrorCode::FeeSplitDeltaTooLarge);

        state.fee_split_bps = new_fee_split_bps;
        // HIGH-01 FIX: Update SEPARATE timestamp for direct path
        state.last_direct_fee_split_timestamp = clock.unix_timestamp;

        emit!(FeeSplitUpdated {
            old_bps: old_fee_split_bps,
            new_bps: new_fee_split_bps,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    // Update pending fees for a specific token (admin/monitor only)
    // Used by off-chain fee monitor to track per-token fee attribution
    pub fn update_pending_fees(
        ctx: Context<UpdatePendingFees>,
        amount_lamports: u64,
    ) -> Result<()> {
        let token_stats = &mut ctx.accounts.token_stats;
        let clock = Clock::get()?;

        // Rate limiting: minimum 10 seconds between updates per token
        const MIN_FEE_UPDATE_INTERVAL: i64 = 10;
        require!(
            clock.unix_timestamp >= token_stats.last_fee_update_timestamp + MIN_FEE_UPDATE_INTERVAL,
            ErrorCode::CycleTooSoon
        );

        // Check pending fees cap (69 SOL max)
        let new_total = token_stats.pending_fees_lamports.saturating_add(amount_lamports);
        require!(new_total <= MAX_PENDING_FEES, ErrorCode::PendingFeesOverflow);

        // Accumulate pending fees
        token_stats.pending_fees_lamports = new_total;

        token_stats.last_fee_update_timestamp = clock.unix_timestamp;

        emit!(PendingFeesUpdated {
            mint: ctx.accounts.mint.key(),
            amount: amount_lamports,
            total_pending: token_stats.pending_fees_lamports,
            timestamp: clock.unix_timestamp,
        });

        #[cfg(feature = "verbose")]
        msg!("Pending fees updated for mint {}: +{} lamports (total: {})",
            ctx.accounts.mint.key(),
            amount_lamports,
            token_stats.pending_fees_lamports
        );

        Ok(())
    }

    /// Initialize validator state for trustless per-token fee tracking
    /// Must be called once per token before register_validated_fees can be used
    pub fn initialize_validator(ctx: Context<InitializeValidator>) -> Result<()> {
        let state = &mut ctx.accounts.validator_state;
        let clock = Clock::get()?;

        state.mint = ctx.accounts.mint.key();
        state.bonding_curve = ctx.accounts.bonding_curve.key();
        state.last_validated_slot = clock.slot;
        state.total_validated_lamports = 0;
        state.total_validated_count = 0;
        state.fee_rate_bps = 50; // 0.5% default PumpFun creator fee
        state.bump = ctx.bumps.validator_state;
        state._reserved = [0u8; 32];

        emit!(ValidatorInitialized {
            mint: state.mint,
            bonding_curve: state.bonding_curve,
            slot: clock.slot,
            timestamp: clock.unix_timestamp,
        });

        #[cfg(feature = "verbose")]
        msg!("Validator initialized for mint {} with bonding curve {}",
            state.mint, state.bonding_curve);

        Ok(())
    }

    /// ADMIN ONLY - Reset validator slot to current slot
    /// Used when validator has been inactive for too long (slot delta > 1000)
    /// This allows the validator daemon to resume operation without redeploying
    pub fn reset_validator_slot(ctx: Context<ResetValidatorSlot>) -> Result<()> {
        let state = &mut ctx.accounts.validator_state;
        let clock = Clock::get()?;

        let old_slot = state.last_validated_slot;
        state.last_validated_slot = clock.slot;

        emit!(ValidatorSlotReset {
            mint: state.mint,
            old_slot,
            new_slot: clock.slot,
            timestamp: clock.unix_timestamp,
        });

        #[cfg(feature = "verbose")]
        msg!("Validator slot reset from {} to {} for mint {}",
            old_slot, clock.slot, state.mint);

        Ok(())
    }

    /// ADMIN ONLY - Register validated fees extracted from PumpFun transaction logs
    /// Only admin can call this to commit validated fee data
    ///
    /// Security: Protected by admin check, slot progression, and fee caps
    pub fn register_validated_fees(
        ctx: Context<RegisterValidatedFees>,
        fee_amount: u64,
        end_slot: u64,
        tx_count: u32,
    ) -> Result<()> {
        let validator = &mut ctx.accounts.validator_state;
        let token_stats = &mut ctx.accounts.token_stats;
        let clock = Clock::get()?;

        // Validation 1: Slot progression (prevent double-counting)
        require!(
            end_slot > validator.last_validated_slot,
            ErrorCode::StaleValidation
        );

        // Validation 2: Slot range sanity (max 1000 slots ~7 minutes)
        let slot_delta = end_slot.saturating_sub(validator.last_validated_slot);
        require!(slot_delta <= 1000, ErrorCode::SlotRangeTooLarge);

        // Validation 3: Fee amount sanity check
        // Max reasonable: 0.01 SOL per slot (very active token)
        let max_fee_for_range = slot_delta.saturating_mul(10_000_000); // 0.01 SOL * slots
        require!(fee_amount <= max_fee_for_range, ErrorCode::FeeTooHigh);

        // Validation 4: TX count sanity (max 100 TX per slot)
        require!(tx_count <= (slot_delta as u32).saturating_mul(100), ErrorCode::TooManyTransactions);

        // Validation 5: Pending fees cap (69 SOL max)
        let new_pending = token_stats.pending_fees_lamports.saturating_add(fee_amount);
        require!(new_pending <= MAX_PENDING_FEES, ErrorCode::PendingFeesOverflow);

        // Update validator state
        validator.last_validated_slot = end_slot;
        validator.total_validated_lamports = validator
            .total_validated_lamports
            .saturating_add(fee_amount);
        validator.total_validated_count = validator
            .total_validated_count
            .saturating_add(1);

        // Update token stats (THIS IS THE KEY - trustless fee attribution!)
        token_stats.pending_fees_lamports = new_pending;
        token_stats.last_fee_update_timestamp = clock.unix_timestamp;

        emit!(ValidatedFeesRegistered {
            mint: validator.mint,
            fee_amount,
            end_slot,
            tx_count,
            total_pending: token_stats.pending_fees_lamports,
            timestamp: clock.unix_timestamp,
        });

        #[cfg(feature = "verbose")]
        msg!("Registered {} lamports for {} (slot {}, {} TXs)",
            fee_amount, validator.mint, end_slot, tx_count);

        Ok(())
    }

    /// Sync validator slot to current slot (permissionless)
    ///
    /// This instruction allows anyone to reset the last_validated_slot to the current slot
    /// when the validator state has become stale (> MAX_SLOT_RANGE behind current slot).
    /// This is useful after periods of inactivity to allow the daemon to resume operation.
    ///
    /// Note: This does NOT affect fee attribution - it simply allows new validations to proceed.
    /// Any fees from the skipped slots are lost (this is acceptable for inactivity periods).
    pub fn sync_validator_slot(ctx: Context<SyncValidatorSlot>) -> Result<()> {
        let validator = &mut ctx.accounts.validator_state;
        let clock = Clock::get()?;
        let current_slot = clock.slot;

        // Only allow sync if the validator is stale (more than MAX_SLOT_RANGE behind)
        let slot_delta = current_slot.saturating_sub(validator.last_validated_slot);
        require!(slot_delta > 1000, ErrorCode::ValidatorNotStale);

        let old_slot = validator.last_validated_slot;
        validator.last_validated_slot = current_slot;

        emit!(ValidatorSlotSynced {
            mint: validator.mint,
            old_slot,
            new_slot: current_slot,
            slot_delta,
            timestamp: clock.unix_timestamp,
        });

        #[cfg(feature = "verbose")]
        msg!("Synced validator slot for {} from {} to {} (delta: {})",
            validator.mint, old_slot, current_slot, slot_delta);

        Ok(())
    }

    // Migrate existing TokenStats accounts to include new fields
    // Call this once per existing token to initialize the new fields
    pub fn migrate_token_stats(ctx: Context<MigrateTokenStats>) -> Result<()> {
        use anchor_lang::solana_program::program::invoke;
        use anchor_lang::solana_program::system_instruction;

        let token_stats_account = &ctx.accounts.token_stats;
        let mint = &ctx.accounts.mint;

        // Verify PDA
        let (expected_pda, bump) = Pubkey::find_program_address(
            &[TOKEN_STATS_SEED, mint.key().as_ref()],
            &crate::ID
        );
        require!(token_stats_account.key() == expected_pda, ErrorCode::InvalidParameter);
        msg!("PDA verified: bump = {}", bump);

        let clock = Clock::get()?;

        // Check current account size
        let current_data = token_stats_account.try_borrow_data()?;
        let current_size = current_data.len();

        // Old size: 8 (discriminator) + 106 (old struct without 3 new fields) = 114 bytes
        // New size: 8 (discriminator) + 130 (new struct with 3 new fields) = 138 bytes
        const OLD_SIZE: usize = 114;
        const NEW_SIZE: usize = 138;

        if current_size >= NEW_SIZE {
            msg!("TokenStats already migrated (size: {})", current_size);
            return Ok(());
        }

        if current_size != OLD_SIZE {
            msg!("Unexpected TokenStats size: {}. Expected {} or {}", current_size, OLD_SIZE, NEW_SIZE);
            return err!(ErrorCode::AccountSizeMismatch);
        }

        msg!("Migrating TokenStats from size {} to {}", OLD_SIZE, NEW_SIZE);

        // Read old data (copy before realloc)
        let mut old_data = vec![0u8; OLD_SIZE];
        old_data.copy_from_slice(&current_data[..OLD_SIZE]);
        drop(current_data); // Release borrow

        // Reallocate account
        let rent = Rent::get()?;
        let new_lamports = rent.minimum_balance(NEW_SIZE);
        let current_lamports = token_stats_account.lamports();

        if new_lamports > current_lamports {
            let lamports_diff = new_lamports - current_lamports;
            invoke(
                &system_instruction::transfer(
                    ctx.accounts.admin.key,
                    token_stats_account.key,
                    lamports_diff,
                ),
                &[
                    ctx.accounts.admin.to_account_info(),
                    token_stats_account.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        // Realloc the account to new size
        {
            let mut lamports = token_stats_account.lamports.borrow_mut();
            **lamports = new_lamports;
        }
        token_stats_account.realloc(NEW_SIZE, false).map_err(|_| ErrorCode::AccountSizeMismatch)?;

        // Write data back with new fields
        let mut new_data = token_stats_account.try_borrow_mut_data()?;
        new_data[..OLD_SIZE].copy_from_slice(&old_data);

        // Add new fields at the end (after byte 114)
        // pending_fees_lamports: u64 = 0
        new_data[114..122].copy_from_slice(&0u64.to_le_bytes());
        // last_fee_update_timestamp: i64 = current timestamp
        new_data[122..130].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
        // cycles_participated: u64 = total_buybacks (read from old data at offset 72)
        let total_buybacks = u64::from_le_bytes(
            old_data[80..88].try_into().map_err(|_| ErrorCode::InvalidParameter)?
        );
        new_data[130..138].copy_from_slice(&total_buybacks.to_le_bytes());

        msg!("TokenStats migrated successfully: pending_fees=0, timestamp={}, cycles_participated={}",
            clock.unix_timestamp,
            total_buybacks
        );

        Ok(())
    }

    pub fn collect_fees(ctx: Context<CollectFees>, is_root_token: bool, for_ecosystem: bool) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;

        require!(state.is_active && !state.emergency_pause, ErrorCode::DATNotActive);

        // Enforce minimum cycle interval (disabled in testing mode)
        if !TESTING_MODE {
            require!(
                clock.unix_timestamp - state.last_cycle_timestamp >= state.min_cycle_interval,
                ErrorCode::CycleTooSoon
            );
        }

        state.last_cycle_timestamp = clock.unix_timestamp;

        // NOTE: AM/PM execution limits removed - random timing now controlled by TypeScript daemon
        // The orchestrator handles 1/day per token scheduling with randomized timing

        // Enforce minimum fees threshold (disabled in testing mode)
        // NOTE: Skip threshold check when for_ecosystem=true (N+1 pattern)
        // In N+1, the first token drains the vault and subsequent tokens use datAuthority balance
        // The threshold check only applies to standalone/first-token collections
        if !TESTING_MODE && !for_ecosystem {
            let vault_balance = ctx.accounts.creator_vault.lamports();
            require!(vault_balance >= state.min_fees_threshold, ErrorCode::InsufficientFees);
        }

        let seeds = &[DAT_AUTHORITY_SEED, &[state.dat_authority_bump]];

        // Track vault balance before collection
        let vault_balance_before = ctx.accounts.creator_vault.lamports();

        // STEP 1: Collect from creator vault (all tokens)
        collect_creator_fee_cpi(
            &ctx.accounts.dat_authority,
            &ctx.accounts.creator_vault,
            &ctx.accounts.system_program,
            &ctx.accounts.pump_event_authority,
            &ctx.accounts.pump_swap_program,
            seeds,
        )?;

        // Track SOL collected from vault
        let vault_balance_after = ctx.accounts.creator_vault.lamports();
        let sol_from_vault = vault_balance_before.saturating_sub(vault_balance_after);
        ctx.accounts.token_stats.total_sol_collected = ctx.accounts.token_stats.total_sol_collected.saturating_add(sol_from_vault);

        // STEP 2: If root token, also collect from root treasury
        if is_root_token {
            if let Some(root_treasury) = &ctx.accounts.root_treasury {
                let treasury_amt = root_treasury.lamports();
                if treasury_amt > 0 {
                    // Root treasury is a PDA: seeds = ["root_treasury", root_token_mint, bump]
                    let root_mint = state.root_token_mint
                        .ok_or(ErrorCode::InvalidRootToken)?;
                    let (expected_treasury, bump) = Pubkey::find_program_address(
                        &[ROOT_TREASURY_SEED, root_mint.as_ref()],
                        ctx.program_id
                    );
                    require!(expected_treasury == *root_treasury.key, ErrorCode::InvalidRootTreasury);

                    // Create seeds with bump for signing
                    let bump_slice = &[bump];
                    let treasury_seeds: &[&[u8]] = &[ROOT_TREASURY_SEED, root_mint.as_ref(), bump_slice];

                    invoke_signed(
                        &anchor_lang::solana_program::system_instruction::transfer(
                            root_treasury.key,
                            ctx.accounts.dat_authority.key,
                            treasury_amt
                        ),
                        &[
                            root_treasury.to_account_info(),
                            ctx.accounts.dat_authority.to_account_info(),
                            ctx.accounts.system_program.to_account_info()
                        ],
                        &[treasury_seeds]
                    )?;

                    // Track SOL received from other tokens
                    ctx.accounts.token_stats.total_sol_received_from_others =
                        ctx.accounts.token_stats.total_sol_received_from_others.saturating_add(treasury_amt);
                    ctx.accounts.token_stats.total_sol_collected =
                        ctx.accounts.token_stats.total_sol_collected.saturating_add(treasury_amt);

                    emit!(RootTreasuryCollected {
                        root_mint,
                        amount: treasury_amt,
                        timestamp: clock.unix_timestamp
                    });
                    msg!("Root treasury collected: {} lamports", treasury_amt);
                }
            }
        }

        // Reset pending fees unless in ecosystem mode (where orchestrator manages distribution)
        if !for_ecosystem {
            ctx.accounts.token_stats.pending_fees_lamports = 0;
            msg!("Pending fees reset (standalone mode)");
        } else {
            msg!("Ecosystem mode: pending fees NOT reset (orchestrator will distribute)");
        }

        msg!("Fees collected (for_ecosystem: {})", for_ecosystem);
        Ok(())
    }

    /// Collect fees from PumpSwap AMM creator vault
    /// Used for tokens that have migrated from bonding curve to AMM
    /// Requires: DAT authority PDA must be set as coin_creator in PumpSwap
    /// IMPORTANT: This collects WSOL (SPL Token), not native SOL
    pub fn collect_fees_amm(ctx: Context<CollectFeesAMM>) -> Result<()> {
        let state = &ctx.accounts.dat_state;
        require!(state.is_active && !state.emergency_pause, ErrorCode::DATNotActive);

        let bump = state.dat_authority_bump;
        let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[bump]];

        // Track WSOL balance before collection
        let wsol_before = ctx.accounts.dat_wsol_account.amount;

        // Call PumpSwap's collect_coin_creator_fee via CPI
        // DAT authority PDA signs as the coin_creator
        collect_amm_creator_fee_cpi(
            &ctx.accounts.wsol_mint.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.dat_authority.to_account_info(),
            &ctx.accounts.creator_vault_authority.to_account_info(),
            &ctx.accounts.creator_vault_ata.to_account_info(),
            &ctx.accounts.dat_wsol_account.to_account_info(),
            &ctx.accounts.pump_swap_program.to_account_info(),
            seeds,
        )?;

        // NOTE: reload() required after CPI to get updated WSOL balance - Anchor doesn't auto-reload for invoke_signed
        ctx.accounts.dat_wsol_account.reload()?;
        let wsol_after = ctx.accounts.dat_wsol_account.amount;
        let wsol_collected = wsol_after.saturating_sub(wsol_before);

        // Update token stats
        ctx.accounts.token_stats.total_sol_collected =
            ctx.accounts.token_stats.total_sol_collected.saturating_add(wsol_collected);

        msg!("AMM creator fees collected: {} WSOL", wsol_collected);
        emit!(AmmFeesCollected {
            mint: ctx.accounts.token_stats.mint,
            wsol_amount: wsol_collected,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Unwrap WSOL to native SOL in DAT authority account
    /// Call this after collect_fees_amm to convert WSOL to SOL for buyback
    pub fn unwrap_wsol(ctx: Context<UnwrapWsol>) -> Result<()> {
        let state = &ctx.accounts.dat_state;
        require!(state.is_active && !state.emergency_pause, ErrorCode::DATNotActive);

        let bump = state.dat_authority_bump;
        let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[bump]];

        // Get WSOL balance to unwrap
        let wsol_amount = ctx.accounts.dat_wsol_account.amount;
        require!(wsol_amount > 0, ErrorCode::InsufficientFees);

        // Close the WSOL token account (transfers lamports to dat_authority)
        let cpi_accounts = anchor_spl::token::CloseAccount {
            account: ctx.accounts.dat_wsol_account.to_account_info(),
            destination: ctx.accounts.dat_authority.to_account_info(),
            authority: ctx.accounts.dat_authority.to_account_info(),
        };
        let signer_seeds: &[&[&[u8]]] = &[seeds];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::close_account(cpi_ctx)?;

        msg!("WSOL unwrapped: {} lamports now in DAT authority", wsol_amount);
        Ok(())
    }

    /// Wrap native SOL to WSOL for AMM buyback
    /// Call this before execute_buy_amm when root token is on PumpSwap AMM
    /// The dat_wsol_account must already exist (created by caller)
    pub fn wrap_wsol(ctx: Context<WrapWsol>, amount: u64) -> Result<()> {
        let state = &ctx.accounts.dat_state;
        require!(state.is_active && !state.emergency_pause, ErrorCode::DATNotActive);
        require!(amount > 0, ErrorCode::InsufficientFees);

        let bump = state.dat_authority_bump;
        let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[bump]];

        // Verify sufficient balance in dat_authority
        let available = ctx.accounts.dat_authority.lamports()
            .saturating_sub(RENT_EXEMPT_MINIMUM + SAFETY_BUFFER);
        require!(available >= amount, ErrorCode::InsufficientFees);

        // Transfer native SOL from dat_authority to dat_wsol_account
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.dat_authority.key(),
            &ctx.accounts.dat_wsol_account.key(),
            amount,
        );
        invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.dat_authority.to_account_info(),
                ctx.accounts.dat_wsol_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[seeds],
        )?;

        // Sync native - updates the WSOL token balance to match lamports
        let sync_accounts = token::SyncNative {
            account: ctx.accounts.dat_wsol_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            sync_accounts,
        );
        token::sync_native(cpi_ctx)?;

        msg!("WSOL wrapped: {} lamports converted to WSOL", amount);
        Ok(())
    }

    /// Execute buy on bonding curve - ROOT TOKEN ONLY (simpler, no split logic)
    /// For secondary tokens, use execute_buy_secondary instead
    pub fn execute_buy(
        ctx: Context<ExecuteBuy>,
        allocated_lamports: Option<u64>,
    ) -> Result<()> {
        require!(ctx.accounts.dat_state.is_active && !ctx.accounts.dat_state.emergency_pause, ErrorCode::DATNotActive);

        // Calculate buy amount (root token - no ATA reserve needed)
        let buy_amount = match allocated_lamports {
            Some(a) => a.saturating_sub(SAFETY_BUFFER),
            None => ctx.accounts.dat_authority.lamports().saturating_sub(RENT_EXEMPT_MINIMUM + SAFETY_BUFFER),
        };
        require!(buy_amount >= MINIMUM_BUY_AMOUNT, ErrorCode::InsufficientFees);

        // Delegate to CPI helper
        execute_buy_inner(ctx, buy_amount)
    }

    /// Execute buy for SECONDARY tokens (includes fee split to root treasury)
    pub fn execute_buy_secondary(
        mut ctx: Context<ExecuteBuySecondary>,
        allocated_lamports: Option<u64>,
    ) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        require!(state.is_active && !state.emergency_pause, ErrorCode::DATNotActive);
        require!(state.root_token_mint.is_some(), ErrorCode::InvalidRootToken);

        let bump = state.dat_authority_bump;
        let fee_split_bps = state.fee_split_bps;
        // Defensive check: fee_split_bps must be valid (1000-9000 range enforced by update_fee_split)
        require!(fee_split_bps > 0 && fee_split_bps <= 10000, ErrorCode::InvalidFeeSplit);
        let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[bump]];

        // Calculate available and split to root
        let available = allocated_lamports.unwrap_or(
            ctx.accounts.dat_authority.lamports().saturating_sub(RENT_EXEMPT_MINIMUM + SAFETY_BUFFER)
        );
        require!(available >= MIN_FEES_FOR_SPLIT, ErrorCode::InsufficientFees);

        // CRITICAL-03 FIX: Root treasury is REQUIRED for secondary tokens
        // Without this check, callers could pass root_treasury=None and skip the 44.8% fee split
        require!(ctx.accounts.root_treasury.is_some(), ErrorCode::InvalidRootTreasury);

        // Execute split - SECURITY: Validate root_treasury PDA before transfer
        if let Some(treasury) = &ctx.accounts.root_treasury {
            // CRITICAL-01 FIX: Validate root_treasury is the correct PDA
            let root_mint = state.root_token_mint.ok_or(ErrorCode::InvalidRootToken)?;
            let (expected_treasury, _bump) = Pubkey::find_program_address(
                &[ROOT_TREASURY_SEED, root_mint.as_ref()],
                ctx.program_id
            );
            require!(expected_treasury == *treasury.key, ErrorCode::InvalidRootTreasury);

            let sol_for_root = split_fees_to_root(
                &ctx.accounts.dat_authority,
                treasury,
                &ctx.accounts.system_program,
                available,
                fee_split_bps,
                seeds,
            )?;
            if sol_for_root > 0 {
                state.last_sol_sent_to_root = sol_for_root;
            }
        }

        // Calculate remaining buy amount after split
        let buy_amount = match allocated_lamports {
            Some(a) => ((a * fee_split_bps as u64) / 10000).saturating_sub(ATA_RENT_RESERVE),
            None => ctx.accounts.dat_authority.lamports().saturating_sub(RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + ATA_RENT_RESERVE),
        };
        require!(buy_amount >= MINIMUM_BUY_AMOUNT, ErrorCode::InsufficientFees);

        // Execute buy CPI (delegated to reduce stack)
        execute_buy_secondary_cpi(&mut ctx, buy_amount, bump)
    }

    /// Execute buy on PumpSwap AMM pool (for migrated tokens)
    /// This instruction handles tokens that have graduated from bonding curve to AMM
    /// Requires WSOL in dat_wsol_account for the buy operation
    ///
    /// MEDIUM-01 FIX: Added slippage validation to ensure received tokens meet minimum threshold
    pub fn execute_buy_amm(
        ctx: Context<ExecuteBuyAMM>,
        desired_tokens: u64,     // Amount of tokens to buy
        max_sol_cost: u64,       // Maximum SOL to spend (in lamports, will use WSOL)
    ) -> Result<()> {
        // Check state conditions first (read-only)
        require!(ctx.accounts.dat_state.is_active && !ctx.accounts.dat_state.emergency_pause, ErrorCode::DATNotActive);

        // MEDIUM-01 FIX: Validate max_sol_cost against configured limits
        let max_fees = ctx.accounts.dat_state.max_fees_per_cycle;
        let slippage_bps = ctx.accounts.dat_state.slippage_bps;
        require!(max_sol_cost <= max_fees, ErrorCode::InvalidParameter);

        // Get bump before CPI
        let bump = ctx.accounts.dat_state.dat_authority_bump;

        msg!("Executing PumpSwap AMM buy: {} tokens for max {} lamports",
            desired_tokens, max_sol_cost);

        // Record token balance before buy
        let tokens_before = ctx.accounts.dat_token_account.amount;

        // Execute the PumpSwap AMM CPI (borrows ctx immutably)
        execute_pumpswap_amm_cpi_inner(&ctx.accounts, desired_tokens, max_sol_cost, bump)?;

        // NOTE: reload() required after CPI to get updated token balance - Anchor doesn't auto-reload for invoke_signed
        ctx.accounts.dat_token_account.reload()?;
        let tokens_after = ctx.accounts.dat_token_account.amount;
        let tokens_received = tokens_after.saturating_sub(tokens_before);

        msg!("AMM buy complete: received {} tokens", tokens_received);

        // MEDIUM-01 FIX: Validate slippage - ensure we received minimum expected tokens
        // Calculate minimum acceptable: desired_tokens * (1 - slippage_bps/10000)
        let min_tokens = (desired_tokens as u128)
            .saturating_mul(10000 - slippage_bps as u128)
            .saturating_div(10000) as u64;
        require!(tokens_received >= min_tokens, ErrorCode::SlippageExceeded);

        // Update state for burn tracking (mutable borrow after CPI)
        let state = &mut ctx.accounts.dat_state;
        state.pending_burn_amount = tokens_received;
        state.last_cycle_sol = max_sol_cost;

        emit!(BuyExecuted {
            tokens_bought: tokens_received,
            sol_spent: max_sol_cost,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // Finalize allocated cycle - Reset pending_fees and increment cycles_participated
    // Called by ecosystem orchestrator after execute_buy with allocated_lamports
    // This is a separate lightweight instruction to avoid stack overflow
    // actually_participated: bool - If true, reset pending_fees. If false (deferred), preserve them.
    pub fn finalize_allocated_cycle(ctx: Context<FinalizeAllocatedCycle>, actually_participated: bool) -> Result<()> {
        let stats = &mut ctx.accounts.token_stats;

        if actually_participated {
            // Token participated in this cycle - reset pending_fees
            stats.pending_fees_lamports = 0;
            stats.cycles_participated = stats.cycles_participated.saturating_add(1);
            msg!("Finalized allocated cycle: pending_fees reset, cycles: {}", stats.cycles_participated);
        } else {
            // Token was deferred - preserve pending_fees for next cycle
            msg!("Deferred finalization: pending_fees preserved ({} lamports) for next cycle",
                stats.pending_fees_lamports);
        }

        Ok(())
    }


    pub fn burn_and_update(ctx: Context<BurnAndUpdate>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;

        require!(state.pending_burn_amount > 0, ErrorCode::NoPendingBurn);

        let tokens_to_burn = state.pending_burn_amount;
        let seeds = &[DAT_AUTHORITY_SEED, &[state.dat_authority_bump]];

        token_interface::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token_interface::Burn {
                    mint: ctx.accounts.asdf_mint.to_account_info(),
                    from: ctx.accounts.dat_asdf_account.to_account_info(),
                    authority: ctx.accounts.dat_authority.to_account_info(),
                },
                &[seeds]
            ),
            tokens_to_burn
        )?;

        // Update per-token statistics
        let token_stats = &mut ctx.accounts.token_stats;
        token_stats.total_burned = token_stats.total_burned.saturating_add(tokens_to_burn);
        token_stats.total_sol_used = token_stats.total_sol_used.saturating_add(state.last_cycle_sol);
        token_stats.total_buybacks = token_stats.total_buybacks.saturating_add(1);
        token_stats.last_cycle_timestamp = clock.unix_timestamp;
        token_stats.last_cycle_sol = state.last_cycle_sol;
        token_stats.last_cycle_burned = tokens_to_burn;

        // Update total_sol_sent_to_root if this was a secondary token cycle
        if state.last_sol_sent_to_root > 0 {
            token_stats.total_sol_sent_to_root =
                token_stats.total_sol_sent_to_root.saturating_add(state.last_sol_sent_to_root);
            msg!("Token stats updated: {} lamports sent to root (total: {})",
                state.last_sol_sent_to_root,
                token_stats.total_sol_sent_to_root);
        }

        // Update global state and reset tracking variables
        state.last_cycle_burned = tokens_to_burn;
        state.consecutive_failures = 0;
        state.pending_burn_amount = 0;
        state.last_sol_sent_to_root = 0;  // Reset for next cycle

        let (whole, frac) = format_tokens(tokens_to_burn);
        msg!("Epoch #{} complete: {}.{:06} tokens burned ({} units)",
            token_stats.total_buybacks, whole, frac, tokens_to_burn);

        emit!(CycleCompleted {
            cycle_number: token_stats.total_buybacks as u32,
            tokens_burned: tokens_to_burn,
            sol_used: state.last_cycle_sol,
            total_burned: token_stats.total_burned,
            total_sol_collected: token_stats.total_sol_collected,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn record_failure(ctx: Context<RecordFailure>, error_code: u32) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        state.failed_cycles = state.failed_cycles.saturating_add(1);
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        if state.consecutive_failures >= 5 {
            state.emergency_pause = true;
        }
        emit!(CycleFailed {
            failed_count: state.failed_cycles,
            consecutive_failures: state.consecutive_failures,
            error_code,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn emergency_pause(ctx: Context<AdminControl>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        state.emergency_pause = true;
        state.is_active = false;
        emit!(EmergencyAction {
            action: "PAUSE".to_string(),
            admin: ctx.accounts.admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn resume(ctx: Context<AdminControl>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        state.emergency_pause = false;
        state.is_active = true;
        state.consecutive_failures = 0;
        emit!(StatusChanged {
            is_active: true,
            emergency_pause: false,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn update_parameters(
        ctx: Context<AdminControl>,
        new_min_fees: Option<u64>,
        new_max_fees: Option<u64>,
        new_slippage_bps: Option<u16>,
        new_min_interval: Option<i64>,
    ) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;

        // Validate slippage: min 0.1% (10 bps), max 5% (500 bps)
        // Disallow 0 to prevent division issues in buy calculations
        if let Some(v) = new_slippage_bps {
            require!(v >= 10 && v <= 500, ErrorCode::SlippageConfigTooHigh);
            state.slippage_bps = v;
        }

        // Validate min_interval: must be positive
        if let Some(v) = new_min_interval {
            require!(v > 0, ErrorCode::InvalidParameter);
            state.min_cycle_interval = v;
        }

        // Apply fee thresholds with bounds validation
        // min_fees: must be at least 0.001 SOL (1_000_000 lamports) and at most 1 SOL
        if let Some(v) = new_min_fees {
            require!(v >= 1_000_000 && v <= 1_000_000_000, ErrorCode::InvalidParameter);
            state.min_fees_threshold = v;
        }
        // max_fees: must be at least 0.01 SOL (10_000_000 lamports)
        if let Some(v) = new_max_fees {
            require!(v >= 10_000_000, ErrorCode::InvalidParameter);
            state.max_fees_per_cycle = v;
        }

        // Validate min <= max after both are set
        require!(
            state.min_fees_threshold <= state.max_fees_per_cycle,
            ErrorCode::InvalidParameter
        );

        Ok(())
    }

    /// DEPRECATED: Use propose_admin_transfer + accept_admin_transfer instead
    /// Kept for backwards compatibility - now just proposes the transfer
    pub fn transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        state.pending_admin = Some(ctx.accounts.new_admin.key());
        emit!(AdminTransferProposed {
            current_admin: ctx.accounts.admin.key(),
            proposed_admin: ctx.accounts.new_admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Propose a new admin (two-step transfer for security)
    pub fn propose_admin_transfer(ctx: Context<ProposeAdminTransfer>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        state.pending_admin = Some(ctx.accounts.new_admin.key());
        emit!(AdminTransferProposed {
            current_admin: ctx.accounts.admin.key(),
            proposed_admin: ctx.accounts.new_admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Accept admin transfer (must be called by the proposed admin)
    pub fn accept_admin_transfer(ctx: Context<AcceptAdminTransfer>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let old_admin = state.admin;
        let new_admin = ctx.accounts.new_admin.key();

        state.admin = new_admin;
        state.pending_admin = None;

        emit!(AdminTransferred {
            old_admin,
            new_admin,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Cancel a pending admin transfer (called by current admin)
    pub fn cancel_admin_transfer(ctx: Context<CancelAdminTransfer>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;
        // Constraint already validates pending_admin.is_some() in context
        let cancelled_admin = state.pending_admin.ok_or(ErrorCode::NoPendingAdminTransfer)?;
        state.pending_admin = None;

        emit!(AdminTransferCancelled {
            admin: ctx.accounts.admin.key(),
            cancelled_new_admin: cancelled_admin,
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    /// Propose a fee split change (subject to timelock)
    pub fn propose_fee_split(ctx: Context<ProposeAdminTransfer>, new_fee_split_bps: u16) -> Result<()> {
        require!(
            new_fee_split_bps > 0 && new_fee_split_bps < 10000,
            ErrorCode::InvalidParameter
        );

        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;

        state.pending_fee_split = Some(new_fee_split_bps);
        state.pending_fee_split_timestamp = clock.unix_timestamp;

        msg!("Fee split change proposed: {} bps, can execute after {} seconds",
             new_fee_split_bps, state.admin_operation_cooldown);
        Ok(())
    }

    /// Execute a pending fee split change (after cooldown period)
    pub fn execute_fee_split(ctx: Context<ProposeAdminTransfer>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;

        require!(state.pending_fee_split.is_some(), ErrorCode::NoPendingFeeSplit);

        let elapsed = clock.unix_timestamp.saturating_sub(state.pending_fee_split_timestamp);
        require!(
            elapsed >= state.admin_operation_cooldown,
            ErrorCode::CycleTooSoon // Reusing existing error for timelock
        );

        let new_fee_split = state.pending_fee_split
            .ok_or(ErrorCode::NoPendingFeeSplit)?;
        let old_fee_split = state.fee_split_bps;

        state.fee_split_bps = new_fee_split;
        state.pending_fee_split = None;
        state.pending_fee_split_timestamp = 0;

        emit!(FeeSplitUpdated {
            old_bps: old_fee_split,
            new_bps: new_fee_split,
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn create_pumpfun_token(
        ctx: Context<CreatePumpfunToken>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        let state = &ctx.accounts.dat_state;
        
        msg!("Creating PumpFun token via manual CPI");
        msg!("Name: {}, Symbol: {}, Creator: {}", name, symbol, ctx.accounts.dat_authority.key());
        
        let mut data = Vec::new();
        
        // PumpFun create token discriminator
        data.extend_from_slice(&PUMPFUN_CREATE_DISCRIMINATOR);
        
        // Name
        data.extend_from_slice(&(name.len() as u32).to_le_bytes());
        data.extend_from_slice(name.as_bytes());
        
        // Symbol
        data.extend_from_slice(&(symbol.len() as u32).to_le_bytes());
        data.extend_from_slice(symbol.as_bytes());
        
        // URI
        data.extend_from_slice(&(uri.len() as u32).to_le_bytes());
        data.extend_from_slice(uri.as_bytes());
        
        // Creator (4th arg)
        data.extend_from_slice(&ctx.accounts.dat_authority.key().to_bytes());
        
        let accounts = vec![
            AccountMeta::new(ctx.accounts.mint.key(), true),
            AccountMeta::new_readonly(ctx.accounts.mint_authority.key(), false),
            AccountMeta::new(ctx.accounts.bonding_curve.key(), false),
            AccountMeta::new(ctx.accounts.associated_bonding_curve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.global.key(), false),
            AccountMeta::new_readonly(ctx.accounts.mpl_token_metadata.key(), false),
            AccountMeta::new(ctx.accounts.metadata.key(), false),
            AccountMeta::new(ctx.accounts.dat_authority.key(), true),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.associated_token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
            AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_program.key(), false),
        ];
        
        let ix = Instruction {
            program_id: PUMP_PROGRAM,
            accounts,
            data,
        };
        
        let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[state.dat_authority_bump]];
        
        invoke_signed(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.mint_authority.to_account_info(),
                ctx.accounts.bonding_curve.to_account_info(),
                ctx.accounts.associated_bonding_curve.to_account_info(),
                ctx.accounts.global.to_account_info(),
                ctx.accounts.mpl_token_metadata.to_account_info(),
                ctx.accounts.metadata.to_account_info(),
                ctx.accounts.dat_authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.associated_token_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
                ctx.accounts.event_authority.to_account_info(),
                ctx.accounts.pump_program.to_account_info(),
            ],
            &[seeds],
        )?;
        
        msg!("Token created successfully!");
        
        emit!(TokenCreated {
            mint: ctx.accounts.mint.key(),
            bonding_curve: ctx.accounts.bonding_curve.key(),
            creator: ctx.accounts.dat_authority.key(),
            name,
            symbol,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Create a PumpFun token in Mayhem Mode with AI trading agent
    /// Uses Token2022 and create_v2 instruction
    /// Supply: 2 billion tokens (1B + 1B for agent)
    pub fn create_pumpfun_token_mayhem(
        ctx: Context<CreatePumpfunTokenMayhem>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        let state = &ctx.accounts.dat_state;

        msg!("Creating PumpFun token in MAYHEM MODE via CPI");
        msg!("Name: {}, Symbol: {}, Creator: {}", name, symbol, ctx.accounts.dat_authority.key());
        msg!("Mayhem Mode: AI agent will trade for 24h");

        let mut data = Vec::new();

        // Discriminator for create_v2: [214, 144, 76, 236, 95, 139, 49, 180]
        data.extend_from_slice(&[214, 144, 76, 236, 95, 139, 49, 180]);

        // Name (String)
        data.extend_from_slice(&(name.len() as u32).to_le_bytes());
        data.extend_from_slice(name.as_bytes());

        // Symbol (String)
        data.extend_from_slice(&(symbol.len() as u32).to_le_bytes());
        data.extend_from_slice(symbol.as_bytes());

        // URI (String)
        data.extend_from_slice(&(uri.len() as u32).to_le_bytes());
        data.extend_from_slice(uri.as_bytes());

        // Creator (Pubkey)
        data.extend_from_slice(&ctx.accounts.dat_authority.key().to_bytes());

        // is_mayhem_mode (bool - 1 byte)
        data.extend_from_slice(&[1u8]); // true for Mayhem Mode

        let accounts = vec![
            AccountMeta::new(ctx.accounts.mint.key(), true),
            AccountMeta::new_readonly(ctx.accounts.mint_authority.key(), false),
            AccountMeta::new(ctx.accounts.bonding_curve.key(), false),
            AccountMeta::new(ctx.accounts.associated_bonding_curve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.global.key(), false),
            AccountMeta::new(ctx.accounts.dat_authority.key(), true), // user/creator
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_2022_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.associated_token_program.key(), false),
            AccountMeta::new(ctx.accounts.mayhem_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.global_params.key(), false),
            AccountMeta::new(ctx.accounts.sol_vault.key(), false),
            AccountMeta::new(ctx.accounts.mayhem_state.key(), false),
            AccountMeta::new(ctx.accounts.mayhem_token_vault.key(), false),
            AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_program.key(), false),
        ];

        let ix = Instruction {
            program_id: PUMP_PROGRAM,
            accounts,
            data,
        };

        let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[state.dat_authority_bump]];

        invoke_signed(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.mint_authority.to_account_info(),
                ctx.accounts.bonding_curve.to_account_info(),
                ctx.accounts.associated_bonding_curve.to_account_info(),
                ctx.accounts.global.to_account_info(),
                ctx.accounts.dat_authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.token_2022_program.to_account_info(),
                ctx.accounts.associated_token_program.to_account_info(),
                ctx.accounts.mayhem_program.to_account_info(),
                ctx.accounts.global_params.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
                ctx.accounts.mayhem_state.to_account_info(),
                ctx.accounts.mayhem_token_vault.to_account_info(),
                ctx.accounts.event_authority.to_account_info(),
                ctx.accounts.pump_program.to_account_info(),
            ],
            &[seeds],
        )?;

        msg!("Mayhem Mode token created successfully!");
        msg!("Supply: 2 billion tokens (1B base + 1B for AI agent)");

        emit!(TokenCreated {
            mint: ctx.accounts.mint.key(),
            bonding_curve: ctx.accounts.bonding_curve.key(),
            creator: ctx.accounts.dat_authority.key(),
            name,
            symbol,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Transfer 1% dev sustainability fee
    /// Called at the end of each batch transaction, after burn succeeds
    /// 1% today = 99% burns forever
    pub fn transfer_dev_fee(ctx: Context<TransferDevFee>, secondary_share: u64) -> Result<()> {
        // Calculate 1% of secondary share
        let dev_fee = secondary_share
            .checked_mul(DEV_FEE_BPS as u64)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;

        if dev_fee > 0 {
            let bump = ctx.accounts.dat_state.dat_authority_bump;
            let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[bump]];

            invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    ctx.accounts.dat_authority.key,
                    ctx.accounts.dev_wallet.key,
                    dev_fee,
                ),
                &[
                    ctx.accounts.dat_authority.to_account_info(),
                    ctx.accounts.dev_wallet.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[seeds],
            )?;

            msg!("Dev sustainability fee: {} lamports", dev_fee);
        }

        Ok(())
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // EXTERNAL APP INTEGRATION
    // ══════════════════════════════════════════════════════════════════════════════

    /// Initialize the self-sustaining rebate pool
    /// Called once during protocol setup
    pub fn initialize_rebate_pool(ctx: Context<InitializeRebatePool>) -> Result<()> {
        let rebate_pool = &mut ctx.accounts.rebate_pool;
        let clock = Clock::get()?;

        rebate_pool.bump = ctx.bumps.rebate_pool;
        rebate_pool.total_deposited = 0;
        rebate_pool.total_distributed = 0;
        rebate_pool.rebates_count = 0;
        rebate_pool.last_rebate_timestamp = 0;
        rebate_pool.last_rebate_slot = 0;
        rebate_pool.unique_recipients = 0;
        rebate_pool._reserved = [0u8; 32];

        emit!(RebatePoolInitialized {
            rebate_pool: ctx.accounts.rebate_pool.key(),
            rebate_pool_ata: Pubkey::default(), // ATA created separately
            timestamp: clock.unix_timestamp,
        });

        msg!("Rebate pool initialized");
        Ok(())
    }

    /// External app deposits $ASDF fees with automatic split
    /// Split: 99.448% → DAT ATA (burn), 0.552% → Rebate Pool ATA (rebates)
    ///
    /// Architecture:
    /// - Payer transfers full amount
    /// - 99.448% goes to DAT ATA (included in ROOT cycle single burn)
    /// - 0.552% goes to Rebate Pool ATA (self-sustaining fund)
    /// - UserStats.pending_contribution tracks full amount for rebate calculation
    pub fn deposit_fee_asdf(
        ctx: Context<DepositFeeAsdf>,
        amount: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        // Validate minimum deposit
        require!(amount >= MIN_DEPOSIT_SOL_EQUIV, ErrorCode::DepositBelowMinimum);

        // Calculate split (99.448% burn, 0.552% rebate)
        // Using BPS: 9945 / 10000 = 99.45%
        let burn_amount = amount
            .checked_mul(BURN_SHARE_BPS as u64)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        let rebate_pool_amount = amount.saturating_sub(burn_amount);

        // Transfer 99.448% → DAT ATA (for burn)
        token_interface::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token_interface::Transfer {
                    from: ctx.accounts.payer_token_account.to_account_info(),
                    to: ctx.accounts.dat_asdf_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            burn_amount,
        )?;

        // Transfer 0.552% → Rebate Pool ATA (for rebates)
        if rebate_pool_amount > 0 {
            token_interface::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token_interface::Transfer {
                        from: ctx.accounts.payer_token_account.to_account_info(),
                        to: ctx.accounts.rebate_pool_ata.to_account_info(),
                        authority: ctx.accounts.payer.to_account_info(),
                    },
                ),
                rebate_pool_amount,
            )?;
        }

        // Update rebate pool stats
        let rebate_pool = &mut ctx.accounts.rebate_pool;
        rebate_pool.total_deposited = rebate_pool.total_deposited.saturating_add(rebate_pool_amount);

        // Get keys before mutable borrow
        let user_key = ctx.accounts.user.key();
        let user_stats_key = ctx.accounts.user_stats.key();

        // Initialize or update user stats
        let user_stats = &mut ctx.accounts.user_stats;

        // Check if newly initialized (user == default)
        if user_stats.user == Pubkey::default() {
            user_stats.bump = ctx.bumps.user_stats;
            user_stats.user = user_key;
            user_stats.pending_contribution = 0;
            user_stats.total_contributed = 0;
            user_stats.total_rebate = 0;

            emit!(UserStatsInitialized {
                user: user_key,
                user_stats: user_stats_key,
                timestamp: clock.unix_timestamp,
            });
        }

        // Track full amount for rebate calculation
        user_stats.pending_contribution = user_stats.pending_contribution.saturating_add(amount);
        user_stats.last_update_timestamp = clock.unix_timestamp;
        user_stats.last_update_slot = clock.slot;

        emit!(FeeAsdfDeposited {
            user: user_key,
            amount,
            burn_amount,
            rebate_pool_amount,
            pending_contribution: user_stats.pending_contribution,
            timestamp: clock.unix_timestamp,
        });

        msg!("Fee deposited: {} total ({} burn, {} rebate pool)",
            amount, burn_amount, rebate_pool_amount);

        Ok(())
    }

    /// Process user rebate - transfer from pool to selected user
    /// Called as LAST instruction in ROOT cycle batch
    ///
    /// NOTE: This instruction does NOT burn. The burn happens in the single
    /// ROOT cycle burn instruction which includes all DAT ATA balance
    /// (buyback + user deposits 99.448%).
    ///
    /// This instruction only:
    /// 1. Validates user eligibility (pending >= threshold)
    /// 2. Calculates rebate amount (0.552% of pending)
    /// 3. Transfers rebate from pool → user ATA
    /// 4. Resets pending and updates stats
    pub fn process_user_rebate(ctx: Context<ProcessUserRebate>) -> Result<()> {
        let clock = Clock::get()?;
        let user_stats = &mut ctx.accounts.user_stats;

        // Validate: pending >= threshold
        require!(
            user_stats.pending_contribution >= REBATE_THRESHOLD_SOL_EQUIV,
            ErrorCode::BelowRebateThreshold
        );

        let pending = user_stats.pending_contribution;

        // Calculate rebate amount (0.552% of pending)
        let rebate_amount = pending
            .checked_mul(REBATE_SHARE_BPS as u64)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;

        // Validate pool has sufficient funds
        require!(
            ctx.accounts.rebate_pool_ata.amount >= rebate_amount,
            ErrorCode::RebatePoolInsufficient
        );

        // Transfer rebate from pool → user ATA
        let rebate_pool_bump = ctx.accounts.rebate_pool.bump;
        let seeds: &[&[u8]] = &[REBATE_POOL_SEED, &[rebate_pool_bump]];

        token_interface::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token_interface::Transfer {
                    from: ctx.accounts.rebate_pool_ata.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.rebate_pool.to_account_info(),
                },
                &[seeds],
            ),
            rebate_amount,
        )?;

        // Update user stats
        user_stats.pending_contribution = 0;
        user_stats.total_contributed = user_stats.total_contributed.saturating_add(pending);
        user_stats.total_rebate = user_stats.total_rebate.saturating_add(rebate_amount);
        user_stats.last_update_timestamp = clock.unix_timestamp;
        user_stats.last_update_slot = clock.slot;

        // Update rebate pool stats
        let rebate_pool = &mut ctx.accounts.rebate_pool;
        rebate_pool.total_distributed = rebate_pool.total_distributed.saturating_add(rebate_amount);
        rebate_pool.rebates_count = rebate_pool.rebates_count.saturating_add(1);
        rebate_pool.last_rebate_timestamp = clock.unix_timestamp;
        rebate_pool.last_rebate_slot = clock.slot;

        emit!(UserRebateProcessed {
            user: ctx.accounts.user.key(),
            pending_burned: pending,
            rebate_amount,
            total_contributed: user_stats.total_contributed,
            total_rebate: user_stats.total_rebate,
            timestamp: clock.unix_timestamp,
        });

        msg!("Rebate processed: {} pending → {} rebate to user",
            pending, rebate_amount);

        Ok(())
    }
}


// CONTEXTS - Account structs now in contexts module (see pub use contexts::*;)

// STATE - Now imported from state module (see pub use state::*;)

// EVENTS - Now imported from events module (see pub use events::*;)

// ERRORS - Now imported from errors module (see pub use errors::*;)
