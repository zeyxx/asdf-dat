use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_spl::{
    token::{self, Token},
    token_2022::{self as token2022},
    token_interface::{self as token_interface, TokenInterface, TokenAccount, Mint},
    associated_token::AssociatedToken,
};

declare_id!("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");

pub const ASDF_MINT: Pubkey = Pubkey::new_from_array([137, 186, 88, 184, 174, 194, 106, 212, 88, 106, 151, 42, 200, 185, 36, 216, 12, 68, 223, 123, 57, 228, 213, 18, 228, 89, 200, 243, 29, 9, 91, 145]);
pub const WSOL_MINT: Pubkey = Pubkey::new_from_array([6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169]);
pub const POOL_PUMPSWAP: Pubkey = Pubkey::new_from_array([192, 248, 200, 149, 140, 186, 128, 73, 229, 234, 185, 221, 168, 154, 161, 205, 98, 170, 28, 212, 197, 248, 155, 225, 81, 137, 239, 236, 51, 136, 62, 163]);
// pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA - PumpSwap AMM program
pub const PUMP_SWAP_PROGRAM: Pubkey = Pubkey::new_from_array([12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64, 101, 244, 41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233, 168, 99]);
// 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P - Main Pump.fun program
pub const PUMP_PROGRAM: Pubkey = Pubkey::new_from_array([1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170, 81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176]);

// Token2022 program ID
pub const TOKEN_2022_PROGRAM: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172,
    190, 192, 170, 33, 225, 195, 158, 240, 26, 96, 235, 152, 242, 210, 242, 92
]); // TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

pub const MIN_FEES_TO_CLAIM: u64 = 10_000_000;
pub const MAX_FEES_PER_CYCLE: u64 = 1_000_000_000;
pub const INITIAL_SLIPPAGE_BPS: u16 = 500;
pub const MIN_CYCLE_INTERVAL: i64 = 60;

pub const DAT_STATE_SEED: &[u8] = b"dat_v3";
pub const DAT_AUTHORITY_SEED: &[u8] = b"auth_v3";
pub const TOKEN_STATS_SEED: &[u8] = b"token_stats_v1";
pub const ROOT_TREASURY_SEED: &[u8] = b"root_treasury";

/// Helper to manually deserialize PumpFun bonding curve (avoids struct alignment issues)
fn deserialize_bonding_curve(data: &[u8]) -> Result<(u64, u64)> {
    require!(data.len() >= 24, ErrorCode::InvalidPool);

    // Read virtual_token_reserves (bytes 0-7)
    let virtual_token_reserves = u64::from_le_bytes(data[0..8].try_into().unwrap());

    // Read virtual_sol_reserves (bytes 8-15)
    let virtual_sol_reserves = u64::from_le_bytes(data[8..16].try_into().unwrap());

    msg!("Bonding curve: virtual_token={}, virtual_sol={}", virtual_token_reserves, virtual_sol_reserves);

    Ok((virtual_token_reserves, virtual_sol_reserves))
}

pub const PROTOCOL_FEE_RECIPIENTS: [Pubkey; 1] = [
    Pubkey::new_from_array([81, 173, 33, 188, 96, 186, 141, 138, 77, 220, 51, 130, 166, 223, 207, 219, 29, 141, 38, 224, 247, 232, 60, 188, 100, 154, 253, 193, 77, 96, 251, 216]),
];

// Mayhem Mode constants
pub const MAYHEM_PROGRAM: Pubkey = Pubkey::new_from_array([
    137, 218, 238, 239, 168, 72, 231, 178, 160, 44, 152, 142, 20, 125, 67, 196,
    43, 166, 78, 225, 251, 144, 219, 123, 110, 241, 54, 179, 185, 154, 254, 99
]); // MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e

pub const MAYHEM_FEE_RECIPIENT: Pubkey = Pubkey::new_from_array([
    231, 187, 167, 206, 49, 119, 164, 163, 136, 194, 114, 154, 76, 149, 230,
    206, 125, 133, 68, 102, 17, 167, 236, 118, 150, 25, 123, 68, 54, 221, 39, 12
]); // GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS

pub const MAYHEM_AGENT_WALLET: Pubkey = Pubkey::new_from_array([
    166, 133, 239, 180, 77, 235, 68, 100, 199, 33, 25, 139, 185, 9, 232, 164,
    228, 205, 74, 123, 166, 139, 114, 13, 221, 225, 162, 93, 101, 11, 19, 102
]); // BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s

// TESTING MODE CONFIGURATION
// Set to `false` before deploying to production/mainnet
// When true: disables cycle interval, AM/PM protection, and min fees checks
// When false: all safety constraints are enforced
pub const TESTING_MODE: bool = true;

/// Helper function to collect creator fees CPI (extracted to reduce stack usage)
#[inline(never)]
fn collect_creator_fee_cpi<'info>(
    dat_authority: &AccountInfo<'info>,
    creator_vault: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    pump_event_authority: &AccountInfo<'info>,
    pump_swap_program: &AccountInfo<'info>,
    seeds: &[&[u8]],
) -> Result<()> {
    let instruction = Box::new(Instruction {
        program_id: PUMP_PROGRAM,
        accounts: vec![
            AccountMeta::new(dat_authority.key(), false),
            AccountMeta::new(creator_vault.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
            AccountMeta::new_readonly(pump_event_authority.key(), false),
            AccountMeta::new_readonly(PUMP_PROGRAM, false),
        ],
        data: vec![20, 22, 86, 123, 198, 28, 219, 132],
    });

    let account_infos = Box::new([
        dat_authority.to_account_info(),
        creator_vault.to_account_info(),
        system_program.to_account_info(),
        pump_event_authority.to_account_info(),
        pump_swap_program.to_account_info(),
    ]);

    invoke_signed(&*instruction, &*account_infos, &[seeds])?;
    Ok(())
}

/// Helper function to calculate buy parameters (extracted to reduce stack usage)
#[inline(never)]
fn calculate_buy_params(
    collected_lamports: u64,
    bonding_curve_data: &[u8],
    max_fees_per_cycle: u64,
    slippage_bps: u16,
) -> Result<(u64, u64)> {
    let rent_exempt_minimum = 890880;
    let collected = collected_lamports.saturating_sub(rent_exempt_minimum);
    let capped = collected.min(max_fees_per_cycle);

    // Deserialize bonding curve manually (skip 8-byte discriminator)
    let (virtual_token_reserves, virtual_sol_reserves) = deserialize_bonding_curve(&bonding_curve_data[8..])?;

    // Minimum pool liquidity check: require at least 0.01 SOL in virtual reserves
    const MIN_POOL_LIQUIDITY: u64 = 10_000_000; // 0.01 SOL
    require!(
        virtual_sol_reserves >= MIN_POOL_LIQUIDITY,
        ErrorCode::InsufficientPoolLiquidity
    );

    // Require pool has tokens
    require!(
        virtual_token_reserves > 0,
        ErrorCode::InsufficientPoolLiquidity
    );

    let max_safe = virtual_sol_reserves / 100;
    let final_amount = capped.min(max_safe);

    // Only attempt calculation if we have something to buy
    if final_amount == 0 {
        return Ok((0, 0));
    }

    // Use PumpFun's exact formula: tokens_out = (sol_in * virtual_token_reserves) / (virtual_sol_reserves + sol_in)
    let expected = calculate_tokens_out_pumpfun(
        final_amount,
        virtual_sol_reserves,
        virtual_token_reserves,
    )?;
    let min_out = apply_slippage(expected, slippage_bps);

    Ok((final_amount, min_out))
}

/// Helper function to split fees for secondary tokens (extracted to reduce stack usage)
#[inline(never)]
fn split_fees_to_root<'info>(
    dat_authority: &AccountInfo<'info>,
    root_treasury: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    total_lamports: u64,
    fee_split_bps: u16,
    seeds: &[&[u8]],
) -> Result<u64> {
    let sol_for_root = total_lamports.saturating_sub((total_lamports * fee_split_bps as u64) / 10000);

    if sol_for_root > 0 {
        invoke_signed(
            &anchor_lang::solana_program::system_instruction::transfer(
                dat_authority.key,
                root_treasury.key,
                sol_for_root
            ),
            &[
                dat_authority.to_account_info(),
                root_treasury.to_account_info(),
                system_program.to_account_info()
            ],
            &[seeds]
        )?;
    }

    Ok(sol_for_root)
}

/// Helper function to execute buy CPI (extracted to reduce stack usage)
#[inline(never)]
fn execute_buy_cpi<'info>(
    pump_global_config: &AccountInfo<'info>,
    protocol_fee_recipient: &AccountInfo<'info>,
    asdf_mint: &InterfaceAccount<'info, Mint>,
    pool: &AccountInfo<'info>,
    pool_asdf_account: &InterfaceAccount<'info, TokenAccount>,
    dat_asdf_account: &InterfaceAccount<'info, TokenAccount>,
    dat_authority: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    creator_vault: &AccountInfo<'info>,
    pump_event_authority: &AccountInfo<'info>,
    pump_swap_program: &AccountInfo<'info>,
    global_volume_accumulator: &AccountInfo<'info>,
    user_volume_accumulator: &AccountInfo<'info>,
    fee_config: &AccountInfo<'info>,
    fee_program: &AccountInfo<'info>,
    final_amount: u64,
    min_out: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    // Use Box to allocate on heap instead of stack
    let mut data = Vec::new();
    data.extend_from_slice(&[102, 6, 61, 18, 1, 218, 235, 234]);
    data.extend_from_slice(&min_out.to_le_bytes());
    // Fixed: Use final_amount directly instead of multiplying by 200
    data.extend_from_slice(&final_amount.to_le_bytes());
    data.push(0);

    let instruction = Box::new(Instruction {
        program_id: PUMP_PROGRAM,
        accounts: vec![
            AccountMeta::new_readonly(pump_global_config.key(), false),          // 0 - global
            AccountMeta::new(protocol_fee_recipient.key(), false),                // 1 - fee_recipient
            AccountMeta::new(asdf_mint.key(), false),                             // 2 - mint
            AccountMeta::new(pool.key(), false),                                  // 3 - bonding_curve
            AccountMeta::new(pool_asdf_account.key(), false),                     // 4 - associated_bonding_curve
            AccountMeta::new(dat_asdf_account.key(), false),                      // 5 - associated_user
            AccountMeta::new(dat_authority.key(), true),                          // 6 - user (SIGNER)
            AccountMeta::new_readonly(system_program.key(), false),               // 7 - system_program
            AccountMeta::new_readonly(token_program.key(), false),                // 8 - token_program
            AccountMeta::new(creator_vault.key(), false),                         // 9 - creator_vault
            AccountMeta::new_readonly(pump_event_authority.key(), false),         // 10 - event_authority
            AccountMeta::new_readonly(PUMP_PROGRAM, false),                       // 11 - program
            AccountMeta::new_readonly(global_volume_accumulator.key(), false),    // 12 - global_volume_accumulator
            AccountMeta::new(user_volume_accumulator.key(), false),               // 13 - user_volume_accumulator
            AccountMeta::new_readonly(fee_config.key(), false),                   // 14 - fee_config
            AccountMeta::new_readonly(fee_program.key(), false),                  // 15 - fee_program
        ],
        data,
    });

    let account_infos = Box::new([
        pump_global_config.to_account_info(),
        protocol_fee_recipient.to_account_info(),
        asdf_mint.to_account_info(),
        pool.to_account_info(),
        pool_asdf_account.to_account_info(),
        dat_asdf_account.to_account_info(),
        dat_authority.to_account_info(),
        system_program.to_account_info(),
        token_program.to_account_info(),
        creator_vault.to_account_info(),
        pump_event_authority.to_account_info(),
        pump_swap_program.to_account_info(),
        global_volume_accumulator.to_account_info(),
        user_volume_accumulator.to_account_info(),
        fee_config.to_account_info(),
        fee_program.to_account_info(),
    ]);

    invoke_signed(&*instruction, &*account_infos, &[seeds])?;
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

    // Update the fee split ratio (admin only)
    pub fn update_fee_split(ctx: Context<AdminControl>, new_fee_split_bps: u16) -> Result<()> {
        require!(
            new_fee_split_bps <= 10000,
            ErrorCode::InvalidFeeSplit
        );

        let state = &mut ctx.accounts.dat_state;
        state.fee_split_bps = new_fee_split_bps;
        let clock = Clock::get()?;

        emit!(FeeSplitUpdated {
            new_fee_split_bps,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn collect_fees(ctx: Context<CollectFees>, is_root_token: bool) -> Result<()> {
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

        // Enforce AM/PM execution limits (disabled in testing mode)
        if !TESTING_MODE {
            let hour = (clock.unix_timestamp / 3600) % 24;
            let is_am = hour < 12;
            let today = (clock.unix_timestamp / 86400) * 86400;

            let valid = if is_am {
                if state.last_am_execution < today {
                    state.last_am_execution = clock.unix_timestamp;
                    true
                } else { false }
            } else {
                if state.last_pm_execution < today {
                    state.last_pm_execution = clock.unix_timestamp;
                    true
                } else { false }
            };

            require!(valid, ErrorCode::AlreadyExecutedThisPeriod);
        }

        // Enforce minimum fees threshold (disabled in testing mode)
        if !TESTING_MODE {
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
                    invoke(
                        &anchor_lang::solana_program::system_instruction::transfer(
                            root_treasury.key,
                            ctx.accounts.dat_authority.key,
                            treasury_amt
                        ),
                        &[
                            root_treasury.to_account_info(),
                            ctx.accounts.dat_authority.to_account_info(),
                            ctx.accounts.system_program.to_account_info()
                        ]
                    )?;

                    // Track SOL received from other tokens
                    ctx.accounts.token_stats.total_sol_received_from_others =
                        ctx.accounts.token_stats.total_sol_received_from_others.saturating_add(treasury_amt);
                    ctx.accounts.token_stats.total_sol_collected =
                        ctx.accounts.token_stats.total_sol_collected.saturating_add(treasury_amt);

                    emit!(RootTreasuryCollected {
                        root_mint: state.root_token_mint.unwrap(),
                        amount: treasury_amt,
                        timestamp: clock.unix_timestamp
                    });
                    msg!("Root treasury collected: {} lamports", treasury_amt);
                }
            }
        }

        msg!("Fees collected");
        Ok(())
    }

    pub fn execute_buy(ctx: Context<ExecuteBuy>, is_secondary_token: bool) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        let clock = Clock::get()?;
        require!(state.is_active && !state.emergency_pause, ErrorCode::DATNotActive);

        ctx.accounts.pool_asdf_account.reload()?;

        let seeds: &[&[u8]] = &[DAT_AUTHORITY_SEED, &[state.dat_authority_bump]];

        // For secondary tokens, split fees before buying
        if is_secondary_token {
            require!(state.root_token_mint.is_some(), ErrorCode::InvalidRootToken);

            if let Some(root_treasury) = &ctx.accounts.root_treasury {
                let total_collected = ctx.accounts.dat_authority.lamports();
                let sol_for_root = split_fees_to_root(
                    &ctx.accounts.dat_authority,
                    root_treasury,
                    &ctx.accounts.system_program,
                    total_collected,
                    state.fee_split_bps,
                    seeds,
                )?;

                if sol_for_root > 0 {
                    emit!(FeesRedirectedToRoot {
                        from_token: ctx.accounts.asdf_mint.key(),
                        to_root: state.root_token_mint.unwrap(),
                        amount: sol_for_root,
                        timestamp: clock.unix_timestamp
                    });
                    msg!("Secondary token: {} lamports sent to root treasury", sol_for_root);
                }
            }
        }

        // Calculate buy parameters using helper to reduce stack
        let collected_lamports = ctx.accounts.dat_authority.lamports();

        // Get bonding curve account data for PumpFun formula
        // IMPORTANT: Copy the data to avoid AccountBorrowFailed error
        // We need to release the borrow before calling execute_buy_cpi
        let pool_data_copy = {
            let pool_data_ref = ctx.accounts.pool.try_borrow_data()?;
            pool_data_ref.to_vec()
        }; // Borrow is released here

        let (final_amount, min_out) = calculate_buy_params(
            collected_lamports,
            &pool_data_copy,
            state.max_fees_per_cycle,
            state.slippage_bps,
        )?;

        msg!("Final buy amount: {} lamports ({} SOL)", final_amount, final_amount as f64 / 1e9);
        msg!("Min tokens out: {}", min_out);

        // Use helper to reduce stack usage
        execute_buy_cpi(
            &ctx.accounts.pump_global_config,
            &ctx.accounts.protocol_fee_recipient,
            &ctx.accounts.asdf_mint,
            &ctx.accounts.pool,
            &ctx.accounts.pool_asdf_account,
            &ctx.accounts.dat_asdf_account,
            &ctx.accounts.dat_authority,
            &ctx.accounts.system_program,
            &ctx.accounts.token_program,
            &ctx.accounts.creator_vault,
            &ctx.accounts.pump_event_authority,
            &ctx.accounts.pump_swap_program,
            &ctx.accounts.global_volume_accumulator,
            &ctx.accounts.user_volume_accumulator,
            &ctx.accounts.fee_config,
            &ctx.accounts.fee_program,
            final_amount,
            min_out,
            seeds,
        )?;

        ctx.accounts.dat_asdf_account.reload()?;
        let state = &mut ctx.accounts.dat_state;
        state.pending_burn_amount = ctx.accounts.dat_asdf_account.amount;
        state.last_cycle_sol = final_amount;

        msg!("Buyback complete: {} lamports ({} SOL) spent", final_amount, final_amount as f64 / 1e9);
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

        // Update global state
        state.last_cycle_burned = tokens_to_burn;
        state.consecutive_failures = 0;
        state.pending_burn_amount = 0;

        let (whole, frac) = format_tokens(tokens_to_burn);
        msg!("Cycle #{} complete: {}.{:06} tokens burned ({} units)",
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
        if let Some(v) = new_min_fees { state.min_fees_threshold = v; }
        if let Some(v) = new_max_fees { state.max_fees_per_cycle = v; }
        if let Some(v) = new_slippage_bps { state.slippage_bps = v; }
        if let Some(v) = new_min_interval { state.min_cycle_interval = v; }
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        state.admin = ctx.accounts.new_admin.key();
        emit!(AdminTransferred {
            old_admin: ctx.accounts.admin.key(),
            new_admin: ctx.accounts.new_admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
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
        
        // Discriminator: [24, 30, 200, 40, 5, 28, 7, 119]
        data.extend_from_slice(&[24, 30, 200, 40, 5, 28, 7, 119]);
        
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
}

// HELPERS

#[inline(never)]
fn execute_collect_fees_cpi<'info>(
    ctx: Context<CollectFees<'info>>,
    seeds: &[&[u8]],
) -> Result<()> {
    // Call collect_creator_fee to transfer SOL from creator_vault to dat_authority
    let ix = Instruction {
        program_id: PUMP_PROGRAM,
        accounts: vec![
            AccountMeta::new(ctx.accounts.dat_authority.key(), false),
            AccountMeta::new(ctx.accounts.creator_vault.key(), false),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_event_authority.key(), false),
            AccountMeta::new_readonly(PUMP_PROGRAM, false),
        ],
        data: vec![20, 22, 86, 123, 198, 28, 219, 132], // collect_creator_fee discriminator
    };

    invoke_signed(
        &ix,
        &[
            ctx.accounts.dat_authority.to_account_info(),
            ctx.accounts.creator_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.pump_event_authority.to_account_info(),
            ctx.accounts.pump_swap_program.to_account_info(), // PUMP_PROGRAM
        ],
        &[seeds],
    )?;

    // Keep SOL as native lamports in DAT Authority (no wrapping to WSOL)
    // This allows execute_buy to use the native SOL directly via CPI
    let current_balance = ctx.accounts.dat_authority.lamports();
    msg!("DAT Authority balance after collect: {} SOL", current_balance as f64 / 1e9);

    Ok(())
}

fn validate_pool_creator<'info>(pool: &AccountInfo<'info>, dat_authority: &Pubkey) -> Result<()> {
    let data = pool.try_borrow_data()?;
    require!(data.len() >= 81, ErrorCode::InvalidPool);

    let coin_creator_bytes: [u8; 32] = data[49..81]
        .try_into()
        .map_err(|_| ErrorCode::InvalidPool)?;
    let coin_creator = Pubkey::new_from_array(coin_creator_bytes);

    require!(coin_creator == *dat_authority, ErrorCode::NotCoinCreator);
    Ok(())
}

/// Calculate tokens out using PumpFun's exact formula with virtual reserves
/// Formula: tokens_out = (sol_in * virtual_token_reserves) / (virtual_sol_reserves + sol_in)
pub fn calculate_tokens_out_pumpfun(
    sol_in: u64,
    virtual_sol_reserves: u64,
    virtual_token_reserves: u64,
) -> Result<u64> {
    // Input validation
    require!(virtual_sol_reserves > 0, ErrorCode::InsufficientPoolLiquidity);
    require!(virtual_token_reserves > 0, ErrorCode::InsufficientPoolLiquidity);

    let sol = sol_in as u128;
    let vsol = virtual_sol_reserves as u128;
    let vtoken = virtual_token_reserves as u128;

    msg!("PumpFun calc: sol_in={}, virtual_sol={}, virtual_token={}", sol_in, virtual_sol_reserves, virtual_token_reserves);

    // PumpFun formula: tokens_out = (sol_in * virtual_token_reserves) / (virtual_sol_reserves + sol_in)
    let numerator = sol.saturating_mul(vtoken);
    let denominator = vsol.saturating_add(sol);

    require!(denominator > 0, ErrorCode::MathOverflow);

    let tokens_out = numerator / denominator;
    let result = tokens_out.min(u64::MAX as u128) as u64;

    msg!("PumpFun calc result: {} tokens", result);

    Ok(result)
}

pub fn calculate_tokens_out(sol_in: u64, quote_res: u64, base_res: u64, supply: u64) -> Result<u64> {
    // Input validation
    require!(quote_res > 0, ErrorCode::InsufficientPoolLiquidity);
    require!(base_res > 0, ErrorCode::InsufficientPoolLiquidity);
    require!(supply > 0, ErrorCode::InvalidPool);

    let sol = sol_in as u128;
    let quote = quote_res as u128;
    let base = base_res as u128;
    let sup = supply as u128;

    msg!("calculate_tokens_out: sol_in={}, quote_res={}, base_res={}, supply={}", sol_in, quote_res, base_res, supply);

    // Safe mcap calculation with overflow protection
    let mcap = if base == 0 {
        0
    } else {
        quote.saturating_mul(sup).saturating_div(base)
    };

    msg!("calculate_tokens_out: mcap={}", mcap);

    let fee_bps = match mcap {
        0..=85_000_000_000 => 125,
        85_000_000_001..=300_000_000_000 => 120,
        300_000_000_001..=500_000_000_000 => 115,
        500_000_000_001..=700_000_000_000 => 110,
        700_000_000_001..=900_000_000_000 => 105,
        900_000_000_001..=2_000_000_000_000 => 100,
        2_000_000_001..=3_000_000_000_000 => 95,
        3_000_000_001..=4_000_000_000_000 => 90,
        4_000_000_001..=4_500_000_000_000 => 85,
        4_500_000_001..=5_000_000_000_000 => 80,
        5_000_000_001..=6_000_000_000_000 => 80,
        6_000_000_001..=7_000_000_000_000 => 75,
        7_000_000_001..=8_000_000_000_000 => 70,
        8_000_000_001..=9_000_000_000_000 => 65,
        9_000_000_001..=10_000_000_000_000 => 60,
        10_000_000_001..=11_000_000_000_000 => 55,
        11_000_000_001..=12_000_000_000_000 => 53,
        12_000_000_001..=13_000_000_000_000 => 50,
        13_000_000_001..=14_000_000_000_000 => 48,
        14_000_000_001..=15_000_000_000_000 => 45,
        15_000_000_001..=16_000_000_000_000 => 43,
        16_000_000_001..=17_000_000_000_000 => 40,
        17_000_000_001..=18_000_000_000_000 => 38,
        18_000_000_001..=19_000_000_000_000 => 35,
        19_000_000_001..=20_000_000_000_000 => 33,
        _ => 30,
    };

    msg!("calculate_tokens_out: fee_bps={}", fee_bps);

    let with_fee = sol.checked_mul(10000 - fee_bps as u128).ok_or(ErrorCode::MathOverflow)?;
    msg!("calculate_tokens_out: with_fee={}", with_fee);

    let num = with_fee.checked_mul(base).ok_or(ErrorCode::MathOverflow)?;
    msg!("calculate_tokens_out: num={}", num);

    let quote_10k = quote.checked_mul(10000).ok_or(ErrorCode::MathOverflow)?;
    msg!("calculate_tokens_out: quote_10k={}", quote_10k);

    let denom = quote_10k.checked_add(with_fee).ok_or(ErrorCode::MathOverflow)?;
    msg!("calculate_tokens_out: denom={}", denom);

    // Prevent division by zero
    require!(denom > 0, ErrorCode::MathOverflow);

    let out = num.checked_div(denom).ok_or(ErrorCode::MathOverflow)?;
    msg!("calculate_tokens_out: out={}", out);

    Ok(out as u64)
}

pub fn apply_slippage(amount: u64, bps: u16) -> u64 {
    msg!("apply_slippage: amount={}, bps={}", amount, bps);
    let amt = amount as u128;
    msg!("apply_slippage: amt={}", amt);
    let multiplier = (10000 - bps as u128);
    msg!("apply_slippage: multiplier={}", multiplier);
    let product = amt.saturating_mul(multiplier);
    msg!("apply_slippage: product={}", product);
    let result = product / 10000;
    msg!("apply_slippage: result={}", result);
    let final_val = result.min(u64::MAX as u128) as u64;
    msg!("apply_slippage: final_val={}", final_val);
    final_val
}

/// Format token amount with decimals for readable logs
/// Most tokens have 6 decimals, so we divide by 1_000_000
pub fn format_tokens(amount: u64) -> (u64, u64) {
    const DECIMALS: u64 = 1_000_000; // 6 decimals
    let whole = amount / DECIMALS;
    let fractional = amount % DECIMALS;
    (whole, fractional)
}

// ACCOUNTS

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
    pub admin: Signer<'info>,
}

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
    /// CHECK: PDA - creator (receives SOL from creator vault)
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    /// CHECK: Creator vault (PDA that holds SOL fees)
    #[account(mut)]
    pub creator_vault: AccountInfo<'info>,
    /// CHECK: Event auth
    pub pump_event_authority: AccountInfo<'info>,
    /// CHECK: Pump program
    pub pump_swap_program: AccountInfo<'info>,
    /// CHECK: Root treasury PDA (optional - only for root token)
    pub root_treasury: Option<AccountInfo<'info>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteBuy<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
    /// CHECK: PDA (holds native SOL for buying)
    #[account(mut, seeds = [DAT_AUTHORITY_SEED], bump = dat_state.dat_authority_bump)]
    pub dat_authority: AccountInfo<'info>,
    #[account(mut)]
    pub dat_asdf_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Pool
    #[account(mut)]
    pub pool: AccountInfo<'info>,
    #[account(mut)]
    pub asdf_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub pool_asdf_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub pool_wsol_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Config
    pub pump_global_config: AccountInfo<'info>,
    /// CHECK: Recipient
    #[account(mut)]
    pub protocol_fee_recipient: AccountInfo<'info>,
    #[account(mut)]
    pub protocol_fee_recipient_ata: InterfaceAccount<'info, TokenAccount>,
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
    /// CHECK: Root treasury PDA (optional - only for secondary tokens)
    #[account(mut)]
    pub root_treasury: Option<AccountInfo<'info>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    /// CHECK: Rent sysvar
    pub rent: Sysvar<'info, Rent>,
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
    #[account(mut)]
    pub asdf_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RecordFailure<'info> {
    #[account(mut)]
    pub dat_state: Account<'info, DATState>,
}

#[derive(Accounts)]
pub struct AdminControl<'info> {
    #[account(mut, seeds = [DAT_STATE_SEED], bump, constraint = admin.key() == dat_state.admin @ ErrorCode::UnauthorizedAccess)]
    pub dat_state: Account<'info, DATState>,
    pub admin: Signer<'info>,
}

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

// STATE

#[account]
pub struct DATState {
    pub admin: Pubkey,
    pub asdf_mint: Pubkey,
    pub wsol_mint: Pubkey,
    pub pool_address: Pubkey,
    pub pump_swap_program: Pubkey,
    pub total_burned: u64,
    pub total_sol_collected: u64,
    pub total_buybacks: u32,
    pub failed_cycles: u32,
    pub consecutive_failures: u8,
    pub is_active: bool,
    pub emergency_pause: bool,
    pub last_cycle_timestamp: i64,
    pub initialized_at: i64,
    pub last_am_execution: i64,
    pub last_pm_execution: i64,
    pub last_cycle_sol: u64,
    pub last_cycle_burned: u64,
    pub min_fees_threshold: u64,
    pub max_fees_per_cycle: u64,
    pub slippage_bps: u16,
    pub min_cycle_interval: i64,
    pub dat_authority_bump: u8,
    pub current_fee_recipient_index: u8,
    pub last_known_price: u64,
    pub pending_burn_amount: u64,
    pub root_token_mint: Option<Pubkey>,  // Token principal qui reçoit 44.8% des autres
    pub fee_split_bps: u16,                // Basis points: 5520 = 55.2% keep, 44.8% to root
    pub _reserved: [u8; 30],               // Reduced from 64 to accommodate new fields
}

impl DATState {
    pub const LEN: usize = 32 * 5 + 8 * 13 + 4 * 2 + 1 * 5 + 2 + 33 + 2 + 30; // Added Option<Pubkey>(33) + u16(2), reduced reserved to 30
}

// Per-token statistics tracking
#[account]
pub struct TokenStats {
    pub mint: Pubkey,              // The token mint this stats account tracks
    pub total_burned: u64,         // Total tokens burned for this specific token
    pub total_sol_collected: u64,  // Total SOL collected/generated by this token
    pub total_sol_used: u64,       // Total SOL actually used for buybacks
    pub total_sol_sent_to_root: u64,      // SOL sent to root token (if secondary)
    pub total_sol_received_from_others: u64, // SOL received from other tokens (if root)
    pub total_buybacks: u64,       // Number of buyback cycles for this token
    pub last_cycle_timestamp: i64, // Last cycle execution timestamp
    pub last_cycle_sol: u64,       // SOL collected in last cycle
    pub last_cycle_burned: u64,    // Tokens burned in last cycle
    pub is_root_token: bool,       // Whether this is the root token
    pub bump: u8,                  // PDA bump seed
}

impl TokenStats {
    pub const LEN: usize = 32 + 8 * 9 + 1 + 1; // Pubkey(32) + u64(9) + bool(1) + u8(1) = 106
}

// EVENTS

#[event]
pub struct DATInitialized {
    pub admin: Pubkey,
    pub dat_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokenStatsInitialized {
    pub mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct CycleCompleted {
    pub cycle_number: u32,
    pub tokens_burned: u64,
    pub sol_used: u64,
    pub total_burned: u64,
    pub total_sol_collected: u64,
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

#[event]
pub struct TokenCreated {
    pub mint: Pubkey,
    pub bonding_curve: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub timestamp: i64,
}

#[event]
pub struct RootTokenSet {
    pub root_mint: Pubkey,
    pub fee_split_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct FeeSplitUpdated {
    pub new_fee_split_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct FeesRedirectedToRoot {
    pub from_token: Pubkey,
    pub to_root: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct RootTreasuryCollected {
    pub root_mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ERRORS

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
    #[msg("Invalid fee split basis points")]
    InvalidFeeSplit,
    #[msg("Insufficient pool liquidity")]
    InsufficientPoolLiquidity,
}