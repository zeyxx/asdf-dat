use anchor_lang::prelude::*;
use anchor_spl::{
    token::{self, Token, TokenAccount, Mint},
    associated_token::AssociatedToken,
};
use solana_program::instruction::Instruction;
use solana_program::program::invoke_signed;

declare_id!("EJdSbSXMXQLp7WLqgVYjJ6a6BqMw6t8MzfavWQBZM6a2"); // Replace after deployment

// ===========================
// PRODUCTION CONSTANTS
// ===========================

// Verified PumpSwap addresses
pub const ASDF_MINT: Pubkey = solana_program::pubkey!("9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump");
pub const WSOL_MINT: Pubkey = solana_program::pubkey!("So11111111111111111111111111111111111111112");
pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!("DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb");
pub const PUMP_SWAP_PROGRAM: Pubkey = solana_program::pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
pub const TOKEN_2022_PROGRAM: Pubkey = solana_program::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const FEE_PROGRAM: Pubkey = solana_program::pubkey!("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

// Operating parameters
pub const MIN_FEES_TO_CLAIM: u64 = 190_000_000; // 0.19 SOL in lamports
pub const MAX_FEES_PER_CYCLE: u64 = 10_000_000_000; // 10 SOL maximum for safety
pub const INITIAL_SLIPPAGE_BPS: u16 = 100; // 1% initial slippage
pub const MAX_SLIPPAGE_BPS: u16 = 300; // 3% maximum slippage
pub const MIN_CYCLE_INTERVAL: i64 = 3600; // 1 hour minimum between cycles
pub const MAX_PRICE_IMPACT_BPS: u16 = 300; // 3% max price impact

// PDA seeds
pub const DAT_STATE_SEED: &[u8] = b"dat-state";
pub const DAT_AUTHORITY_SEED: &[u8] = b"dat-authority";

// Protocol fee recipients (rotation for load balancing)
pub const PROTOCOL_FEE_RECIPIENTS: [Pubkey; 8] = [
    solana_program::pubkey!("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV"),
    solana_program::pubkey!("7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ"),
    solana_program::pubkey!("7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX"),
    solana_program::pubkey!("9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz"),
    solana_program::pubkey!("AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY"),
    solana_program::pubkey!("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"),
    solana_program::pubkey!("FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz"),
    solana_program::pubkey!("G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP"),
];

#[program]
pub mod asdf_dat {
    use super::*;

    /// Initialize the DAT system - One-time setup
    /// Sets up the program to receive and manage creator fees
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;
        
        // Basic configuration
        state.admin = ctx.accounts.admin.key();
        state.asdf_mint = ASDF_MINT;
        state.wsol_mint = WSOL_MINT;
        state.pool_address = POOL_PUMPSWAP;
        state.pump_swap_program = PUMP_SWAP_PROGRAM;
        
        // Initialize metrics
        state.total_burned = 0;
        state.total_sol_collected = 0;
        state.total_buybacks = 0;
        state.failed_cycles = 0;
        state.consecutive_failures = 0;
        
        // Set active state
        state.is_active = true;
        state.emergency_pause = false;
        
        // Initialize timestamps
        state.last_cycle_timestamp = 0;
        state.initialized_at = clock.unix_timestamp;
        state.last_am_execution = 0;
        state.last_pm_execution = 0;
        
        // Set operating parameters
        state.min_fees_threshold = MIN_FEES_TO_CLAIM;
        state.max_fees_per_cycle = MAX_FEES_PER_CYCLE;
        state.slippage_bps = INITIAL_SLIPPAGE_BPS;
        state.min_cycle_interval = MIN_CYCLE_INTERVAL;
        
        // Save bumps for CPIs
        state.dat_authority_bump = *ctx.bumps.get("dat_authority").unwrap();
        state.current_fee_recipient_index = 0;
        
        // Initialize price tracking
        state.last_known_price = 0;
        
        msg!("DAT initialized successfully");
        msg!("Admin: {}", state.admin);
        msg!("DAT Authority: {}", ctx.accounts.dat_authority.key());
        
        emit!(DATInitialized {
            admin: state.admin,
            dat_authority: ctx.accounts.dat_authority.key(),
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Execute a complete cycle: collect fees → buyback → burn
    /// Can be called by anyone when conditions are met (permissionless)
    pub fn execute_cycle(ctx: Context<ExecuteCycle>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;

        // Safety checks
        require!(
            state.is_active && !state.emergency_pause,
            ErrorCode::DATNotActive
        );

        require!(
            clock.unix_timestamp - state.last_cycle_timestamp >= state.min_cycle_interval,
            ErrorCode::CycleTooSoon
        );

        // Anti-reentrancy: Update timestamp FIRST
        state.last_cycle_timestamp = clock.unix_timestamp;

        // Determine AM/PM period and validate execution
        let (is_am, period_valid) = {
            let current_hour = (clock.unix_timestamp / 3600) % 24;
            let is_am = current_hour < 12;
            let today_start = (clock.unix_timestamp / 86400) * 86400;

            let period_valid = if is_am {
                if state.last_am_execution < today_start {
                    state.last_am_execution = clock.unix_timestamp;
                    true
                } else {
                    false
                }
            } else {
                if state.last_pm_execution < today_start {
                    state.last_pm_execution = clock.unix_timestamp;
                    true
                } else {
                    false
                }
            };

            (is_am, period_valid)
        };

        require!(period_valid, ErrorCode::AlreadyExecutedThisPeriod);

        msg!("Starting cycle #{} - {} period",
            state.total_buybacks + 1,
            if is_am { "AM" } else { "PM" }
        );

        // STEP 1: Collect fees
        collect_fees_step(
            &ctx.accounts.pool,
            &ctx.accounts.dat_authority,
            &ctx.accounts.creator_vault_ata.to_account_info(),
            &ctx.accounts.wsol_mint.to_account_info(),
            &ctx.accounts.token_program,
            &ctx.accounts.coin_creator_vault_authority,
            &ctx.accounts.dat_wsol_account.to_account_info(),
            &ctx.accounts.pump_event_authority,
            &ctx.accounts.pump_swap_program,
            state,
        )?;

        ctx.accounts.dat_wsol_account.reload()?;
        let collected_amount = ctx.accounts.dat_wsol_account.amount;
        msg!("Collected {} lamports from creator vault", collected_amount);

        // STEP 2: Calculate swap parameters
        ctx.accounts.pool_asdf_account.reload()?;
        ctx.accounts.pool_wsol_account.reload()?;

        let pool_quote_reserves = ctx.accounts.pool_wsol_account.amount;
        let amount_to_use = collected_amount.min(state.max_fees_per_cycle);
        let max_safe_amount = pool_quote_reserves / 100;
        let final_amount = amount_to_use.min(max_safe_amount);

        msg!("Using {} SOL (capped from {} available)", final_amount, collected_amount);

        // STEP 3: Execute swap
        ctx.accounts.pool_asdf_account.reload()?;
        ctx.accounts.pool_wsol_account.reload()?;

        let pool_base_reserves = ctx.accounts.pool_asdf_account.amount;
        let pool_quote_reserves = ctx.accounts.pool_wsol_account.amount;
        let base_mint_supply = ctx.accounts.asdf_mint.supply;

        // Calculate expected tokens
        let expected_tokens = calculate_tokens_out(
            final_amount,
            pool_quote_reserves,
            pool_base_reserves,
            base_mint_supply,
        )?;

        // Check price impact
        let price_before = (pool_quote_reserves as u128) * 1_000_000 / (pool_base_reserves as u128);
        let new_quote_reserves = pool_quote_reserves + final_amount;
        let new_base_reserves = pool_base_reserves - expected_tokens;
        let price_after = (new_quote_reserves as u128) * 1_000_000 / (new_base_reserves as u128);

        let price_impact_bps = ((price_after - price_before) * 10000 / price_before) as u16;
        require!(price_impact_bps <= MAX_PRICE_IMPACT_BPS, ErrorCode::PriceImpactTooHigh);

        let min_tokens_out = apply_slippage(expected_tokens, state.slippage_bps);

        msg!("Executing buyback: {} SOL for min {} ASDF",
            final_amount as f64 / 1e9, min_tokens_out
        );

        // Execute swap
        let dat_seeds = &[DAT_AUTHORITY_SEED, &[state.dat_authority_bump]];
        let fee_recipient = PROTOCOL_FEE_RECIPIENTS[state.current_fee_recipient_index as usize];
        state.current_fee_recipient_index = (state.current_fee_recipient_index + 1) % 8;

        let track_volume = !ctx.accounts.user_volume_accumulator.data_is_empty();

        let buy_accounts = vec![
            AccountMeta::new_readonly(ctx.accounts.pool.key(), false),
            AccountMeta::new(ctx.accounts.dat_authority.key(), true),
            AccountMeta::new_readonly(ctx.accounts.pump_global_config.key(), false),
            AccountMeta::new_readonly(ctx.accounts.asdf_mint.key(), false),
            AccountMeta::new_readonly(ctx.accounts.wsol_mint.key(), false),
            AccountMeta::new(ctx.accounts.dat_asdf_account.key(), false),
            AccountMeta::new(ctx.accounts.dat_wsol_account.key(), false),
            AccountMeta::new(ctx.accounts.pool_asdf_account.key(), false),
            AccountMeta::new(ctx.accounts.pool_wsol_account.key(), false),
            AccountMeta::new_readonly(fee_recipient, false),
            AccountMeta::new(ctx.accounts.protocol_fee_recipient_ata.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.associated_token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_event_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_swap_program.key(), false),
            AccountMeta::new(ctx.accounts.creator_vault_ata.key(), false),
            AccountMeta::new_readonly(ctx.accounts.coin_creator_vault_authority.key(), false),
            AccountMeta::new(ctx.accounts.global_volume_accumulator.key(), false),
            AccountMeta::new(ctx.accounts.user_volume_accumulator.key(), false),
            AccountMeta::new_readonly(ctx.accounts.fee_config.key(), false),
            AccountMeta::new_readonly(FEE_PROGRAM, false),
        ];

        let mut buy_data = vec![102, 6, 61, 18, 1, 218, 235, 234];
        buy_data.extend_from_slice(&min_tokens_out.to_le_bytes());
        buy_data.extend_from_slice(&final_amount.to_le_bytes());
        buy_data.push(1);
        buy_data.push(if track_volume { 1 } else { 0 });

        let buy_ix = Instruction {
            program_id: PUMP_SWAP_PROGRAM,
            accounts: buy_accounts,
            data: buy_data,
        };

        msg!("Executing PumpSwap buy (volume tracking: {})...", track_volume);
        invoke_signed(
            &buy_ix,
            &[
                ctx.accounts.pool.to_account_info(),
                ctx.accounts.dat_authority.to_account_info(),
                ctx.accounts.pump_global_config.to_account_info(),
                ctx.accounts.asdf_mint.to_account_info(),
                ctx.accounts.wsol_mint.to_account_info(),
                ctx.accounts.dat_asdf_account.to_account_info(),
                ctx.accounts.dat_wsol_account.to_account_info(),
                ctx.accounts.pool_asdf_account.to_account_info(),
                ctx.accounts.pool_wsol_account.to_account_info(),
                ctx.accounts.protocol_fee_recipient.to_account_info(),
                ctx.accounts.protocol_fee_recipient_ata.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.associated_token_program.to_account_info(),
                ctx.accounts.pump_event_authority.to_account_info(),
                ctx.accounts.pump_swap_program.to_account_info(),
                ctx.accounts.creator_vault_ata.to_account_info(),
                ctx.accounts.coin_creator_vault_authority.to_account_info(),
                ctx.accounts.global_volume_accumulator.to_account_info(),
                ctx.accounts.user_volume_accumulator.to_account_info(),
                ctx.accounts.fee_config.to_account_info(),
                ctx.accounts.fee_program.to_account_info(),
            ],
            &[dat_seeds],
        )?;

        // STEP 4: Validate and burn
        ctx.accounts.dat_asdf_account.reload()?;
        let tokens_to_burn = ctx.accounts.dat_asdf_account.amount;

        require!(tokens_to_burn >= min_tokens_out, ErrorCode::SlippageExceeded);

        let effective_rate = tokens_to_burn.checked_mul(1_000_000_000)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(final_amount)
            .ok_or(ErrorCode::MathOverflow)?;

        require!(effective_rate >= 100_000, ErrorCode::RateTooLow);

        msg!("Burning {} ASDF tokens", tokens_to_burn);

        let dat_seeds = &[DAT_AUTHORITY_SEED, &[state.dat_authority_bump]];

        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.asdf_mint.to_account_info(),
                    from: ctx.accounts.dat_asdf_account.to_account_info(),
                    authority: ctx.accounts.dat_authority.to_account_info(),
                },
                &[dat_seeds]
            ),
            tokens_to_burn
        )?;

        // Update metrics
        state.total_burned = state.total_burned.checked_add(tokens_to_burn).unwrap_or(u64::MAX);
        state.total_sol_collected = state.total_sol_collected.checked_add(final_amount).unwrap_or(u64::MAX);
        state.total_buybacks = state.total_buybacks.checked_add(1).unwrap_or(u32::MAX);
        state.last_cycle_sol = final_amount;
        state.last_cycle_burned = tokens_to_burn;
        state.consecutive_failures = 0;
        state.last_known_price = (new_quote_reserves as u64) * 1_000_000 / (new_base_reserves as u64);

        msg!("✅ Cycle completed successfully!");
        msg!("Burned: {} ASDF | Used: {} SOL", tokens_to_burn, final_amount);
        msg!("Total burned to date: {} ASDF", state.total_burned);
        msg!("Effective rate: {} ASDF per SOL", effective_rate);

        emit!(CycleCompleted {
            cycle_number: state.total_buybacks,
            tokens_burned: tokens_to_burn,
            sol_used: final_amount,
            total_burned: state.total_burned,
            total_sol_collected: state.total_sol_collected,
            is_am,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Record a failure for monitoring purposes
    /// Automatically triggers emergency pause after 5 consecutive failures
    pub fn record_failure(ctx: Context<RecordFailure>, error_code: u32) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;
        
        state.failed_cycles = state.failed_cycles.saturating_add(1);
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        
        // Auto-pause if too many consecutive failures
        if state.consecutive_failures >= 5 {
            state.emergency_pause = true;
            msg!("Auto-pause triggered after 5 consecutive failures");
        }
        
        emit!(CycleFailed {
            failed_count: state.failed_cycles,
            consecutive_failures: state.consecutive_failures,
            error_code,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Emergency pause - Admin only
    /// Immediately stops all DAT operations
    pub fn emergency_pause(ctx: Context<AdminControl>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        
        state.emergency_pause = true;
        state.is_active = false;
        
        msg!("⚠️ EMERGENCY PAUSE activated by admin");
        
        emit!(EmergencyAction {
            action: "PAUSE".to_string(),
            admin: ctx.accounts.admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Resume operations - Admin only
    /// Restarts DAT operations after pause
    pub fn resume(ctx: Context<AdminControl>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        
        state.emergency_pause = false;
        state.is_active = true;
        state.consecutive_failures = 0;
        
        msg!("✅ Operations RESUMED by admin");
        
        emit!(StatusChanged {
            is_active: true,
            emergency_pause: false,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Update parameters - Admin only
    /// Allows fine-tuning of operating parameters
    pub fn update_parameters(
        ctx: Context<AdminControl>,
        new_min_fees: Option<u64>,
        new_max_fees: Option<u64>,
        new_slippage_bps: Option<u16>,
        new_min_interval: Option<i64>,
    ) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        
        if let Some(min_fees) = new_min_fees {
            require!(
                min_fees >= 50_000_000 && min_fees <= 1_000_000_000,
                ErrorCode::InvalidParameter
            );
            state.min_fees_threshold = min_fees;
            msg!("Updated min_fees_threshold to {}", min_fees);
        }
        
        if let Some(max_fees) = new_max_fees {
            require!(
                max_fees >= 1_000_000_000 && max_fees <= 50_000_000_000,
                ErrorCode::InvalidParameter
            );
            state.max_fees_per_cycle = max_fees;
            msg!("Updated max_fees_per_cycle to {}", max_fees);
        }
        
        if let Some(slippage) = new_slippage_bps {
            require!(
                slippage >= 50 && slippage <= 500,
                ErrorCode::InvalidParameter
            );
            state.slippage_bps = slippage;
            msg!("Updated slippage_bps to {}", slippage);
        }
        
        if let Some(interval) = new_min_interval {
            require!(
                interval >= 900 && interval <= 86400, // 15min to 24h
                ErrorCode::InvalidParameter
            );
            state.min_cycle_interval = interval;
            msg!("Updated min_cycle_interval to {}", interval);
        }
        
        Ok(())
    }

    /// Transfer admin rights - Admin only
    /// Transfers control of the DAT to a new admin
    pub fn transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;

        state.admin = ctx.accounts.new_admin.key();

        msg!("Admin transferred to {}", ctx.accounts.new_admin.key());

        emit!(AdminTransferred {
            old_admin: ctx.accounts.admin.key(),
            new_admin: ctx.accounts.new_admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ===========================
// ACCOUNT STRUCTURES
// ===========================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + DATState::LEN,
        seeds = [DAT_STATE_SEED],
        bump
    )]
    pub dat_state: Account<'info, DATState>,
    
    /// CHECK: PDA that owns token accounts
    #[account(
        seeds = [DAT_AUTHORITY_SEED],
        bump
    )]
    pub dat_authority: AccountInfo<'info>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteCycle<'info> {
    #[account(
        mut,
        seeds = [DAT_STATE_SEED],
        bump,
        constraint = dat_state.is_active @ ErrorCode::DATNotActive
    )]
    pub dat_state: Account<'info, DATState>,
    
    /// CHECK: DAT authority PDA
    #[account(
        seeds = [DAT_AUTHORITY_SEED],
        bump = dat_state.dat_authority_bump
    )]
    pub dat_authority: AccountInfo<'info>,
    
    // Token Accounts
    #[account(
        mut,
        associated_token::mint = wsol_mint,
        associated_token::authority = dat_authority
    )]
    pub dat_wsol_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = asdf_mint,
        associated_token::authority = dat_authority
    )]
    pub dat_asdf_account: Account<'info, TokenAccount>,
    
    // Creator Vault (where fees accumulate)
    #[account(
        mut,
        associated_token::mint = wsol_mint,
        associated_token::authority = coin_creator_vault_authority
    )]
    pub creator_vault_ata: Account<'info, TokenAccount>,
    
    /// CHECK: Creator vault authority (PumpSwap PDA)
    /// Derived from DAT Authority after it becomes coin_creator
    #[account(
        mut,
        seeds = [b"creator_vault", dat_authority.key().as_ref()],
        seeds::program = PUMP_SWAP_PROGRAM,
        bump
    )]
    pub coin_creator_vault_authority: AccountInfo<'info>,
    
    // Mints
    #[account(address = ASDF_MINT)]
    pub asdf_mint: Account<'info, Mint>,
    
    #[account(address = WSOL_MINT)]
    pub wsol_mint: Account<'info, Mint>,
    
    // PumpSwap Pool
    /// CHECK: Pool account - will be deserialized manually
    #[account(
        mut,
        address = POOL_PUMPSWAP
    )]
    pub pool: AccountInfo<'info>,
    
    #[account(
        mut,
        associated_token::mint = asdf_mint,
        associated_token::authority = pool
    )]
    pub pool_asdf_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = wsol_mint,
        associated_token::authority = pool
    )]
    pub pool_wsol_account: Account<'info, TokenAccount>,
    
    // PumpSwap PDAs
    /// CHECK: Global config
    #[account(
        seeds = [b"global_config"],
        seeds::program = PUMP_SWAP_PROGRAM,
        bump
    )]
    pub pump_global_config: AccountInfo<'info>,
    
    /// CHECK: Event authority
    #[account(
        seeds = [b"__event_authority"],
        seeds::program = PUMP_SWAP_PROGRAM,
        bump
    )]
    pub pump_event_authority: AccountInfo<'info>,
    
    /// CHECK: Protocol fee recipient (rotated)
    pub protocol_fee_recipient: AccountInfo<'info>,
    
    #[account(
        mut,
        associated_token::mint = wsol_mint,
        associated_token::authority = protocol_fee_recipient
    )]
    pub protocol_fee_recipient_ata: Account<'info, TokenAccount>,
    
    // Volume tracking (for incentives)
    /// CHECK: Global volume accumulator
    #[account(
        mut,
        seeds = [b"global_volume_accumulator"],
        seeds::program = PUMP_SWAP_PROGRAM,
        bump
    )]
    pub global_volume_accumulator: AccountInfo<'info>,
    
    /// CHECK: User volume accumulator (may not be initialized)
    #[account(
        mut,
        seeds = [b"user_volume_accumulator", dat_authority.key().as_ref()],
        seeds::program = PUMP_SWAP_PROGRAM,
        bump
    )]
    pub user_volume_accumulator: AccountInfo<'info>,
    
    /// CHECK: Fee config
    #[account(
        seeds = [
            b"fee_config",
            &[12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64, 101, 244, 41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233, 168, 99]
        ],
        seeds::program = FEE_PROGRAM,
        bump
    )]
    pub fee_config: AccountInfo<'info>,
    
    /// CHECK: Fee program
    #[account(address = FEE_PROGRAM)]
    pub fee_program: AccountInfo<'info>,
    
    /// CHECK: PumpSwap program
    #[account(address = PUMP_SWAP_PROGRAM)]
    pub pump_swap_program: AccountInfo<'info>,
    
    // System programs
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordFailure<'info> {
    #[account(mut)]
    pub dat_state: Account<'info, DATState>,
}

#[derive(Accounts)]
pub struct AdminControl<'info> {
    #[account(
        mut,
        seeds = [DAT_STATE_SEED],
        bump,
        constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess
    )]
    pub dat_state: Account<'info, DATState>,
    
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(
        mut,
        seeds = [DAT_STATE_SEED],
        bump,
        constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess
    )]
    pub dat_state: Account<'info, DATState>,
    
    pub admin: Signer<'info>,
    
    /// CHECK: New admin address
    pub new_admin: AccountInfo<'info>,
}

// ===========================
// STATE STRUCTURE
// ===========================

#[account]
pub struct DATState {
    // Authority
    pub admin: Pubkey,                      // 32
    
    // Configuration
    pub asdf_mint: Pubkey,                  // 32
    pub wsol_mint: Pubkey,                  // 32
    pub pool_address: Pubkey,               // 32
    pub pump_swap_program: Pubkey,          // 32
    
    // Metrics
    pub total_burned: u64,                  // 8
    pub total_sol_collected: u64,           // 8
    pub total_buybacks: u32,                // 4
    pub failed_cycles: u32,                 // 4
    pub consecutive_failures: u8,           // 1
    
    // State
    pub is_active: bool,                    // 1
    pub emergency_pause: bool,              // 1
    
    // Timestamps
    pub last_cycle_timestamp: i64,          // 8
    pub initialized_at: i64,                // 8
    pub last_am_execution: i64,             // 8
    pub last_pm_execution: i64,             // 8
    
    // Last execution data
    pub last_cycle_sol: u64,                // 8
    pub last_cycle_burned: u64,             // 8
    
    // Parameters
    pub min_fees_threshold: u64,            // 8
    pub max_fees_per_cycle: u64,            // 8
    pub slippage_bps: u16,                  // 2
    pub min_cycle_interval: i64,            // 8
    
    // PDAs
    pub dat_authority_bump: u8,             // 1
    pub current_fee_recipient_index: u8,    // 1
    
    // Price tracking
    pub last_known_price: u64,              // 8
    
    // Reserved for future upgrades
    pub _reserved: [u8; 64],                // 64
}

impl DATState {
    pub const LEN: usize = 32 * 5  // Pubkeys
        + 8 * 11                    // u64 & i64
        + 4 * 2                     // u32
        + 1 * 5                     // u8 & bool
        + 2                         // u16
        + 64;                       // reserved
}

// ===========================
// POOL STRUCTURES
// ===========================

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct Pool {
    pub pool_bump: u8,
    pub index: u16,
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub lp_mint: Pubkey,
    pub pool_base_token_account: Pubkey,
    pub pool_quote_token_account: Pubkey,
    pub lp_supply: u64,
    pub coin_creator: Pubkey,
}

// ===========================
// UTILITY FUNCTIONS
// ===========================

/// Calculate tokens out using constant product AMM formula (x*y=k)
/// Uses official Pump market cap calculation: quoteReserve * baseMintSupply / baseReserve
pub fn calculate_tokens_out(
    sol_amount_in: u64,
    quote_reserves: u64,
    base_reserves: u64,
    base_mint_supply: u64,
) -> Result<u64> {
    // Use u128 to prevent overflow
    let sol_in_u128 = sol_amount_in as u128;
    let quote_res_u128 = quote_reserves as u128;
    let base_res_u128 = base_reserves as u128;
    let base_supply_u128 = base_mint_supply as u128;

    // Calculate market cap using official Pump formula
    let market_cap = quote_res_u128.saturating_mul(base_supply_u128)
        .saturating_div(base_res_u128);
    
    // Dynamic fees based on market cap tiers (exact from PumpSwap fee table)
    let fee_bps = match market_cap {
        0..=85_000_000_000 => 125,           // < $85k: 1.25%
        85_000_000_001..=300_000_000_000 => 120,  // $85k-$300k: 1.20%
        300_000_000_001..=500_000_000_000 => 115, // $300k-$500k: 1.15%
        500_000_000_001..=700_000_000_000 => 110, // $500k-$700k: 1.10%
        700_000_000_001..=900_000_000_000 => 105, // $700k-$900k: 1.05%
        900_000_000_001..=2_000_000_000_000 => 100, // $900k-$2M: 1.00%
        2_000_000_001..=3_000_000_000_000 => 95,   // $2M-$3M: 0.95%
        3_000_000_001..=4_000_000_000_000 => 90,   // $3M-$4M: 0.90%
        4_000_000_001..=4_500_000_000_000 => 85,   // $4M-$4.5M: 0.85%
        4_500_000_001..=5_000_000_000_000 => 80,   // $4.5M-$5M: 0.80%
        5_000_000_001..=6_000_000_000_000 => 80,   // $5M-$6M: 0.80%
        6_000_000_001..=7_000_000_000_000 => 75,   // $6M-$7M: 0.75%
        7_000_000_001..=8_000_000_000_000 => 70,   // $7M-$8M: 0.70%
        8_000_000_001..=9_000_000_000_000 => 65,   // $8M-$9M: 0.65%
        9_000_000_001..=10_000_000_000_000 => 60,  // $9M-$10M: 0.60%
        10_000_000_001..=11_000_000_000_000 => 55, // $10M-$11M: 0.55%
        11_000_000_001..=12_000_000_000_000 => 53, // $11M-$12M: 0.53%
        12_000_000_001..=13_000_000_000_000 => 50, // $12M-$13M: 0.50%
        13_000_000_001..=14_000_000_000_000 => 48, // $13M-$14M: 0.48%
        14_000_000_001..=15_000_000_000_000 => 45, // $14M-$15M: 0.45%
        15_000_000_001..=16_000_000_000_000 => 43, // $15M-$16M: 0.43%
        16_000_000_001..=17_000_000_000_000 => 40, // $16M-$17M: 0.40%
        17_000_000_001..=18_000_000_000_000 => 38, // $17M-$18M: 0.38%
        18_000_000_001..=19_000_000_000_000 => 35, // $18M-$19M: 0.35%
        19_000_000_001..=20_000_000_000_000 => 33, // $19M-$20M: 0.33%
        _ => 30, // > $20M: 0.30%
    };
    
    // Apply fees
    let amount_in_with_fee = sol_in_u128
        .checked_mul(10000 - fee_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?;
    
    let numerator = amount_in_with_fee
        .checked_mul(base_res_u128)
        .ok_or(ErrorCode::MathOverflow)?;
    
    let denominator = quote_res_u128
        .checked_mul(10000)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_add(amount_in_with_fee)
        .ok_or(ErrorCode::MathOverflow)?;
    
    let tokens_out = numerator
        .checked_div(denominator)
        .ok_or(ErrorCode::MathOverflow)?;
    
    Ok(tokens_out as u64)
}

/// Apply slippage tolerance to minimum output
pub fn apply_slippage(amount: u64, slippage_bps: u16) -> u64 {
    amount.saturating_mul(10000 - slippage_bps as u64) / 10000
}

/// Helper function to collect fees - separated to reduce stack usage
pub fn collect_fees_step<'info>(
    pool: &AccountInfo<'info>,
    dat_authority: &AccountInfo<'info>,
    creator_vault_ata: &AccountInfo<'info>,
    wsol_mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    coin_creator_vault_authority: &AccountInfo<'info>,
    dat_wsol_account: &AccountInfo<'info>,
    pump_event_authority: &AccountInfo<'info>,
    pump_swap_program: &AccountInfo<'info>,
    state: &mut DATState,
) -> Result<()> {
    // Verify vault exists (has lamports for rent)
    require!(
        creator_vault_ata.lamports() > 0,
        ErrorCode::VaultNotInitialized
    );

    // Deserialize and verify pool data
    let pool_bytes = pool.try_borrow_data()?;
    let pool_data = Pool::try_from_slice(&pool_bytes[8..])?;
    drop(pool_bytes);

    // Verify we are the coin_creator
    require!(
        pool_data.coin_creator == dat_authority.key(),
        ErrorCode::NotCoinCreator
    );

    // Get vault token balance
    let creator_vault_data = creator_vault_ata.try_borrow_data()?;
    let creator_vault_token_account = TokenAccount::try_deserialize(&mut &creator_vault_data[..])?;
    let initial_vault_balance = creator_vault_token_account.amount;
    drop(creator_vault_data);

    msg!("Initial vault balance: {} lamports", initial_vault_balance);

    // Verify sufficient balance
    require!(
        initial_vault_balance >= state.min_fees_threshold,
        ErrorCode::InsufficientFees
    );

    // Build and execute collect_coin_creator_fee instruction
    let dat_seeds = &[DAT_AUTHORITY_SEED, &[state.dat_authority_bump]];

    let collect_accounts = [
        AccountMeta::new_readonly(wsol_mint.key(), false),
        AccountMeta::new_readonly(token_program.key(), false),
        AccountMeta::new_readonly(dat_authority.key(), true),
        AccountMeta::new_readonly(coin_creator_vault_authority.key(), false),
        AccountMeta::new(creator_vault_ata.key(), false),
        AccountMeta::new(dat_wsol_account.key(), false),
        AccountMeta::new_readonly(pump_event_authority.key(), false),
        AccountMeta::new_readonly(pump_swap_program.key(), false),
    ];

    let collect_ix = Instruction {
        program_id: PUMP_SWAP_PROGRAM,
        accounts: collect_accounts.to_vec(),
        data: vec![160, 57, 89, 42, 181, 139, 43, 66], // collect_coin_creator_fee discriminator
    };

    msg!("Collecting creator fees...");
    invoke_signed(
        &collect_ix,
        &[
            wsol_mint.clone(),
            token_program.clone(),
            dat_authority.clone(),
            coin_creator_vault_authority.clone(),
            creator_vault_ata.clone(),
            dat_wsol_account.clone(),
            pump_event_authority.clone(),
            pump_swap_program.clone(),
        ],
        &[dat_seeds],
    )?;

    Ok(())
}

// ===========================
// EVENTS
// ===========================

#[event]
pub struct DATInitialized {
    pub admin: Pubkey,
    pub dat_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct CycleCompleted {
    pub cycle_number: u32,
    pub tokens_burned: u64,
    pub sol_used: u64,
    pub total_burned: u64,
    pub total_sol_collected: u64,
    pub is_am: bool,
    pub timestamp: i64,
}

#[event]
pub struct CycleFailed {
    pub failed_count: u32,
    pub consecutive_failures: u8,
    pub error_code: u32,
    pub timestamp: i64,
}

#[event]
pub struct StatusChanged {
    pub is_active: bool,
    pub emergency_pause: bool,
    pub timestamp: i64,
}

#[event]
pub struct EmergencyAction {
    pub action: String,
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AdminTransferred {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
    pub timestamp: i64,
}

// ===========================
// ERROR CODES
// ===========================

#[error_code]
pub enum ErrorCode {
    #[msg("DAT is not active")]
    DATNotActive,
    
    #[msg("Insufficient fees in vault")]
    InsufficientFees,
    
    #[msg("Unauthorized access")]
    UnauthorizedAccess,
    
    #[msg("Cycle too soon, minimum interval not met")]
    CycleTooSoon,
    
    #[msg("Invalid parameter value")]
    InvalidParameter,
    
    #[msg("Math overflow detected")]
    MathOverflow,
    
    #[msg("Already executed this period (AM/PM)")]
    AlreadyExecutedThisPeriod,
    
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    
    #[msg("Not the coin creator - waiting for PumpFun to update")]
    NotCoinCreator,
    
    #[msg("Price impact too high - exceeds 3%")]
    PriceImpactTooHigh,
    
    #[msg("Exchange rate too low - possible price manipulation")]
    RateTooLow,
    
    #[msg("Creator vault not initialized or empty")]
    VaultNotInitialized,
}
