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

declare_id!("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

pub const ASDF_MINT: Pubkey = Pubkey::new_from_array([140, 47, 4, 227, 97, 106, 121, 165, 182, 1, 57, 199, 219, 179, 84, 96, 133, 60, 197, 80, 154, 74, 254, 48, 216, 94, 192, 158, 146, 118, 39, 244]); // $ASDF token mint (mainnet) - set via set_asdf_mint instruction
pub const WSOL_MINT: Pubkey = Pubkey::new_from_array([6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169]);
pub const POOL_PUMPSWAP: Pubkey = Pubkey::new_from_array([191, 204, 38, 188, 201, 126, 120, 53, 102, 177, 245, 238, 71, 192, 66, 165, 130, 17, 150, 235, 78, 240, 56, 247, 205, 54, 243, 244, 230, 203, 227, 170]); // DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb (mainnet)
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
pub const MAX_PENDING_FEES: u64 = 69_000_000_000; // 69 SOL max pending fees per token

pub const DAT_STATE_SEED: &[u8] = b"dat_v3";
pub const DAT_AUTHORITY_SEED: &[u8] = b"auth_v3";
pub const TOKEN_STATS_SEED: &[u8] = b"token_stats_v1";
pub const ROOT_TREASURY_SEED: &[u8] = b"root_treasury";
pub const VALIDATOR_STATE_SEED: &[u8] = b"validator_v1";

// PumpFun instruction discriminators (8-byte hashes)
pub const PUMPFUN_BUY_DISCRIMINATOR: [u8; 8] = [102, 6, 61, 18, 1, 218, 235, 234];
pub const PUMPFUN_CREATE_DISCRIMINATOR: [u8; 8] = [24, 30, 200, 40, 5, 28, 7, 119];
pub const PUMPFUN_COLLECT_FEE_DISCRIMINATOR: [u8; 8] = [20, 22, 86, 123, 198, 28, 219, 132];

// ══════════════════════════════════════════════════════════════════════════════
// PUMPSWAP AMM CONSTANTS - For tokens that have migrated from bonding curve
// ══════════════════════════════════════════════════════════════════════════════
// PumpSwap AMM buy instruction discriminator (same as bonding curve buy)
pub const PUMPSWAP_BUY_DISCRIMINATOR: [u8; 8] = [102, 6, 61, 18, 1, 218, 235, 234];

// PumpSwap collect_coin_creator_fee instruction discriminator
pub const PUMPSWAP_COLLECT_CREATOR_FEE_DISCRIMINATOR: [u8; 8] = [160, 57, 89, 42, 181, 139, 43, 66];

// PumpSwap Creator Vault seed
pub const PUMPSWAP_CREATOR_VAULT_SEED: &[u8] = b"creator_vault";

// PumpSwap AMM Program ID - pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
pub const PUMPSWAP_PROGRAM: Pubkey = Pubkey::new_from_array([
    12, 1, 146, 49, 102, 101, 134, 40, 128, 231, 192, 18, 180, 117, 11, 141,
    69, 120, 62, 88, 103, 145, 226, 163, 79, 211, 126, 135, 231, 111, 228, 196
]);

// PumpSwap Global Config PDA - 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf
pub const PUMPSWAP_GLOBAL_CONFIG: Pubkey = Pubkey::new_from_array([
    58, 134, 94, 105, 238, 15, 84, 128, 202, 188, 246, 99, 87, 228, 220, 47,
    24, 213, 141, 69, 193, 234, 116, 137, 251, 55, 35, 217, 121, 60, 114, 166
]);

// PumpSwap Event Authority PDA - Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1
pub const PUMPSWAP_EVENT_AUTHORITY: Pubkey = Pubkey::new_from_array([
    172, 241, 54, 235, 1, 252, 28, 78, 136, 61, 35, 200, 181, 132, 74, 181,
    154, 55, 246, 106, 221, 87, 197, 233, 172, 59, 83, 224, 89, 211, 92, 100
]);

// Fee Program - pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ
pub const PUMP_FEE_PROGRAM: Pubkey = Pubkey::new_from_array([
    12, 53, 255, 169, 5, 90, 142, 86, 141, 168, 247, 188, 7, 86, 21, 39,
    76, 241, 201, 44, 164, 31, 64, 0, 156, 81, 106, 164, 20, 194, 124, 112
]);

// Global Volume Accumulator PDA - Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y
pub const PUMPSWAP_GLOBAL_VOLUME_ACCUMULATOR: Pubkey = Pubkey::new_from_array([
    250, 9, 17, 165, 72, 99, 65, 45, 99, 31, 78, 7, 135, 3, 41, 108,
    3, 95, 13, 19, 51, 160, 217, 200, 131, 141, 115, 183, 16, 254, 110, 45
]);

// Standard protocol fee recipients (from PumpSwap GlobalConfig) - 6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs
pub const PUMPSWAP_PROTOCOL_FEE_RECIPIENTS: [Pubkey; 1] = [
    Pubkey::new_from_array([
        80, 91, 86, 43, 240, 254, 69, 217, 123, 109, 178, 11, 165, 24, 224, 160,
        197, 204, 48, 77, 217, 105, 172, 23, 142, 107, 116, 145, 130, 79, 179, 164
    ])
];

/// Helper to manually deserialize PumpFun bonding curve (avoids struct alignment issues)
fn deserialize_bonding_curve(data: &[u8]) -> Result<(u64, u64)> {
    require!(data.len() >= 24, ErrorCode::InvalidPool);

    // Read virtual_token_reserves (bytes 0-7)
    let virtual_token_reserves = u64::from_le_bytes(
        data[0..8].try_into().map_err(|_| ErrorCode::InvalidPool)?
    );

    // Read virtual_sol_reserves (bytes 8-15)
    let virtual_sol_reserves = u64::from_le_bytes(
        data[8..16].try_into().map_err(|_| ErrorCode::InvalidPool)?
    );

    #[cfg(feature = "verbose")]
    msg!("Bonding curve: virtual_token={}, virtual_sol={}", virtual_token_reserves, virtual_sol_reserves);

    Ok((virtual_token_reserves, virtual_sol_reserves))
}

// SPL Protocol fee recipient - 6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs
pub const PROTOCOL_FEE_RECIPIENTS: [Pubkey; 1] = [
    Pubkey::new_from_array([80, 91, 86, 43, 240, 254, 69, 217, 123, 109, 178, 11, 165, 24, 224, 160, 197, 204, 48, 77, 217, 105, 172, 23, 142, 107, 116, 145, 130, 79, 179, 164]),
];

// Mayhem Mode constants - MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e
pub const MAYHEM_PROGRAM: Pubkey = Pubkey::new_from_array([
    5, 42, 229, 215, 167, 218, 167, 36, 166, 234, 176, 167, 41, 84, 145, 133,
    90, 212, 160, 103, 22, 96, 103, 76, 78, 3, 69, 89, 128, 61, 101, 163
]);

// Mayhem Fee Recipient (Token2022) - GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS
pub const MAYHEM_FEE_RECIPIENT: Pubkey = Pubkey::new_from_array([
    232, 147, 20, 31, 177, 142, 159, 21, 116, 216, 16, 225, 120, 225, 158, 48,
    96, 78, 49, 117, 170, 46, 74, 50, 223, 200, 96, 7, 39, 209, 7, 9
]);

// Mayhem Agent Wallet - BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s
pub const MAYHEM_AGENT_WALLET: Pubkey = Pubkey::new_from_array([
    162, 139, 95, 210, 106, 180, 121, 166, 169, 204, 108, 191, 107, 11, 35, 235,
    97, 136, 90, 55, 30, 1, 32, 172, 169, 19, 190, 239, 61, 19, 138, 120
]);

// ⚠️ TESTING MODE CONFIGURATION - CRITICAL SECURITY SETTING ⚠️
// ══════════════════════════════════════════════════════════════════════════════
// CURRENT: false (MAINNET PRODUCTION MODE)
// ══════════════════════════════════════════════════════════════════════════════
// When true (TESTING):
//   - Disables minimum cycle interval check (allows rapid testing)
//   - Disables minimum fees threshold (allows cycles with any amount)
// When false (PRODUCTION):
//   - Enforces minimum 60s between cycles
//   - Requires minimum fees threshold to be met
// NOTE: Random cycle timing (1/day per token) is controlled by TypeScript daemon
//       The program no longer enforces AM/PM limits - only min interval
// ══════════════════════════════════════════════════════════════════════════════
// SECURITY: Use feature flag instead of runtime constant
// Build with: anchor build -- --features testing (for devnet)
// Build with: anchor build (for mainnet - testing disabled by default)
#[cfg(feature = "testing")]
pub const TESTING_MODE: bool = true;
#[cfg(not(feature = "testing"))]
pub const TESTING_MODE: bool = false;

// Execute buy constants (module level to reduce stack usage)
pub const RENT_EXEMPT_MINIMUM: u64 = 890_880;
pub const SAFETY_BUFFER: u64 = 50_000;
pub const ATA_RENT_RESERVE: u64 = 2_100_000;
pub const MIN_FEES_FOR_SPLIT: u64 = 5_500_000;
pub const MINIMUM_BUY_AMOUNT: u64 = 100_000;

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
        data: PUMPFUN_COLLECT_FEE_DISCRIMINATOR.to_vec(),
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

/// Helper function to collect creator fees from PumpSwap AMM via CPI
/// This is used for tokens that have migrated from bonding curve to AMM
/// The DAT authority PDA must be set as the coin_creator in PumpSwap
#[inline(never)]
fn collect_amm_creator_fee_cpi<'info>(
    quote_mint: &AccountInfo<'info>,
    quote_token_program: &AccountInfo<'info>,
    dat_authority: &AccountInfo<'info>,  // coin_creator (signer via invoke_signed)
    coin_creator_vault_authority: &AccountInfo<'info>,
    coin_creator_vault_ata: &AccountInfo<'info>,
    destination_token_account: &AccountInfo<'info>,
    pump_swap_program: &AccountInfo<'info>,
    seeds: &[&[u8]],
) -> Result<()> {
    // Build the collect_coin_creator_fee instruction
    // Account order: quote_mint, quote_token_program, coin_creator (signer),
    //                coin_creator_vault_authority, coin_creator_vault_ata, coin_creator_token_account
    let instruction = Box::new(Instruction {
        program_id: PUMPSWAP_PROGRAM,
        accounts: vec![
            AccountMeta::new_readonly(*quote_mint.key, false),
            AccountMeta::new_readonly(*quote_token_program.key, false),
            AccountMeta::new_readonly(*dat_authority.key, true),  // coin_creator = signer
            AccountMeta::new_readonly(*coin_creator_vault_authority.key, false),
            AccountMeta::new(*coin_creator_vault_ata.key, false),
            AccountMeta::new(*destination_token_account.key, false),
        ],
        data: PUMPSWAP_COLLECT_CREATOR_FEE_DISCRIMINATOR.to_vec(),
    });

    let account_infos = Box::new([
        quote_mint.to_account_info(),
        quote_token_program.to_account_info(),
        dat_authority.to_account_info(),
        coin_creator_vault_authority.to_account_info(),
        coin_creator_vault_ata.to_account_info(),
        destination_token_account.to_account_info(),
        pump_swap_program.to_account_info(),
    ]);

    invoke_signed(&*instruction, &*account_infos, &[seeds])?;
    Ok(())
}

/// Helper function to calculate buy parameters for PumpFun
/// Returns (max_sol_cost, desired_tokens)
/// PumpFun buy instruction expects: token_amount (how many tokens we want) and max_sol_cost (max SOL we'll pay)
#[inline(never)]
fn calculate_buy_amount_and_slippage(
    buy_amount: u64,
    bonding_curve_data: &[u8],
    max_fees_per_cycle: u64,
    slippage_bps: u16, // Now actually used - max 500 bps (5%)
) -> Result<(u64, u64)> {
    // buy_amount already has rent subtracted, just cap it
    let capped = buy_amount.min(max_fees_per_cycle);

    // Validate bonding curve data size: 8-byte discriminator + 24 bytes for reserves
    require!(bonding_curve_data.len() >= 32, ErrorCode::InvalidPool);

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

    // Calculate how many tokens we expect to receive with our SOL
    // Use PumpFun's exact formula: tokens_out = (sol_in * virtual_token_reserves) / (virtual_sol_reserves + sol_in)
    let expected_tokens = calculate_tokens_out_pumpfun(
        final_amount,
        virtual_sol_reserves,
        virtual_token_reserves,
    )?;

    // Apply configurable slippage tolerance (default 500 bps = 5%)
    // slippage_bps is capped at 500 in update_parameters
    let slippage_multiplier = 10000u128.saturating_sub(slippage_bps as u128);
    let target_tokens = ((expected_tokens as u128) * slippage_multiplier / 10000) as u64;

    #[cfg(feature = "verbose")]
    msg!("Expected tokens: {}, Target tokens ({}% slippage): {}",
         expected_tokens, slippage_bps as f64 / 100.0, target_tokens);

    // Return (max_sol_cost, desired_token_amount)
    Ok((final_amount, target_tokens))
}

/// Helper function to split fees for secondary tokens (extracted to reduce stack usage)
/// HIGH-03 FIX: Added balance verification after transfer to ensure root_treasury received funds
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
        // HIGH-03 FIX: Record balance before transfer for verification
        let treasury_balance_before = root_treasury.lamports();

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

        // HIGH-03 FIX: Verify transfer succeeded by checking balance increased
        let treasury_balance_after = root_treasury.lamports();
        require!(
            treasury_balance_after >= treasury_balance_before.saturating_add(sol_for_root),
            ErrorCode::InvalidParameter
        );
    }

    Ok(sol_for_root)
}

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

/// Minimal CPI executor for PumpFun buy
#[inline(never)]
fn execute_pumpfun_cpi<'info>(
    global_config: Pubkey,
    fee_recipient: Pubkey,
    mint: Pubkey,
    pool: Pubkey,
    pool_token_account: Pubkey,
    user_token_account: Pubkey,
    user: Pubkey,
    max_sol_cost: u64,
    desired_tokens: u64,
    account_infos: &[AccountInfo<'info>],
    seeds: &[&[u8]],
) -> Result<()> {
    let mut data = Vec::with_capacity(25);
    data.extend_from_slice(&PUMPFUN_BUY_DISCRIMINATOR);
    data.extend_from_slice(&desired_tokens.to_le_bytes());
    data.extend_from_slice(&max_sol_cost.to_le_bytes());
    data.push(0);

    let ix = Instruction {
        program_id: PUMP_PROGRAM,
        accounts: vec![
            AccountMeta::new_readonly(global_config, false),
            AccountMeta::new(fee_recipient, false),
            AccountMeta::new(mint, false),
            AccountMeta::new(pool, false),
            AccountMeta::new(pool_token_account, false),
            AccountMeta::new(user_token_account, false),
            AccountMeta::new(user, true),
            AccountMeta::new_readonly(account_infos[7].key(), false), // system
            AccountMeta::new_readonly(account_infos[8].key(), false), // token
            AccountMeta::new(account_infos[9].key(), false), // creator_vault
            AccountMeta::new_readonly(account_infos[10].key(), false), // event_auth
            AccountMeta::new_readonly(PUMP_PROGRAM, false),
            AccountMeta::new_readonly(account_infos[12].key(), false), // global_vol
            AccountMeta::new(account_infos[13].key(), false), // user_vol
            AccountMeta::new_readonly(account_infos[14].key(), false), // fee_config
            AccountMeta::new_readonly(account_infos[15].key(), false), // fee_program
        ],
        data,
    };

    invoke_signed(&ix, account_infos, &[seeds])?;
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

    // Update the fee split ratio (admin only)
    // Bounded between 1000 (10%) and 9000 (90%) to prevent extreme configurations
    // HIGH-02 FIX: Maximum 5% (500 bps) change per call to prevent instant rug
    // NOTE: For larger changes, use propose_fee_split + execute_fee_split (timelocked)
    pub fn update_fee_split(ctx: Context<AdminControl>, new_fee_split_bps: u16) -> Result<()> {
        require!(
            new_fee_split_bps >= 1000 && new_fee_split_bps <= 9000,
            ErrorCode::InvalidFeeSplit
        );

        let state = &mut ctx.accounts.dat_state;
        let old_fee_split_bps = state.fee_split_bps;

        // HIGH-02 FIX: Limit instant changes to max 5% (500 bps) per call
        let delta = (new_fee_split_bps as i32 - old_fee_split_bps as i32).unsigned_abs() as u16;
        require!(delta <= 500, ErrorCode::FeeSplitDeltaTooLarge);

        state.fee_split_bps = new_fee_split_bps;
        let clock = Clock::get()?;

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

    /// PERMISSIONLESS - Register validated fees extracted from PumpFun transaction logs
    /// Anyone can call this to commit fee data from off-chain validation
    ///
    /// Security: Protected by slot progression and fee caps
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

        #[cfg(feature = "verbose")]
        let old_slot = validator.last_validated_slot;
        validator.last_validated_slot = current_slot;

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
            return err!(ErrorCode::InvalidParameter);
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
        token_stats_account.realloc(NEW_SIZE, false).map_err(|_| ErrorCode::InvalidParameter)?;

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
    pub fn execute_buy_amm(
        ctx: Context<ExecuteBuyAMM>,
        desired_tokens: u64,     // Amount of tokens to buy
        max_sol_cost: u64,       // Maximum SOL to spend (in lamports, will use WSOL)
    ) -> Result<()> {
        // Check state conditions first (read-only)
        require!(ctx.accounts.dat_state.is_active && !ctx.accounts.dat_state.emergency_pause, ErrorCode::DATNotActive);

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

        // Validate slippage: max 5% (500 bps)
        if let Some(v) = new_slippage_bps {
            require!(v <= 500, ErrorCode::InvalidParameter);
            state.slippage_bps = v;
        }

        // Validate min_interval: must be positive
        if let Some(v) = new_min_interval {
            require!(v > 0, ErrorCode::InvalidParameter);
            state.min_cycle_interval = v;
        }

        // Apply fee thresholds
        if let Some(v) = new_min_fees { state.min_fees_threshold = v; }
        if let Some(v) = new_max_fees { state.max_fees_per_cycle = v; }

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
    pub fn cancel_admin_transfer(ctx: Context<ProposeAdminTransfer>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        require!(state.pending_admin.is_some(), ErrorCode::InvalidParameter);
        state.pending_admin = None;
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

        require!(state.pending_fee_split.is_some(), ErrorCode::InvalidParameter);

        let elapsed = clock.unix_timestamp.saturating_sub(state.pending_fee_split_timestamp);
        require!(
            elapsed >= state.admin_operation_cooldown,
            ErrorCode::CycleTooSoon // Reusing existing error for timelock
        );

        let new_fee_split = state.pending_fee_split.unwrap();
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
}

// HELPERS

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

    #[cfg(feature = "verbose")]
    msg!("PumpFun calc: sol_in={}, virtual_sol={}, virtual_token={}", sol_in, virtual_sol_reserves, virtual_token_reserves);

    // PumpFun formula: tokens_out = (sol_in * virtual_token_reserves) / (virtual_sol_reserves + sol_in)
    let numerator = sol.saturating_mul(vtoken);
    let denominator = vsol.saturating_add(sol);

    require!(denominator > 0, ErrorCode::MathOverflow);

    let tokens_out = numerator / denominator;
    let result = tokens_out.min(u64::MAX as u128) as u64;

    #[cfg(feature = "verbose")]
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

    #[cfg(feature = "verbose")]
    msg!("calculate_tokens_out: sol_in={}, quote_res={}, base_res={}, supply={}", sol_in, quote_res, base_res, supply);

    // Safe mcap calculation with overflow protection
    let mcap = if base == 0 {
        0
    } else {
        quote.saturating_mul(sup).saturating_div(base)
    };

    #[cfg(feature = "verbose")]
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

    #[cfg(feature = "verbose")]
    msg!("calculate_tokens_out: fee_bps={}", fee_bps);

    let with_fee = sol.checked_mul(10000 - fee_bps as u128).ok_or(ErrorCode::MathOverflow)?;
    #[cfg(feature = "verbose")]
    msg!("calculate_tokens_out: with_fee={}", with_fee);

    let num = with_fee.checked_mul(base).ok_or(ErrorCode::MathOverflow)?;
    #[cfg(feature = "verbose")]
    msg!("calculate_tokens_out: num={}", num);

    let quote_10k = quote.checked_mul(10000).ok_or(ErrorCode::MathOverflow)?;
    #[cfg(feature = "verbose")]
    msg!("calculate_tokens_out: quote_10k={}", quote_10k);

    let denom = quote_10k.checked_add(with_fee).ok_or(ErrorCode::MathOverflow)?;
    #[cfg(feature = "verbose")]
    msg!("calculate_tokens_out: denom={}", denom);

    // Prevent division by zero
    require!(denom > 0, ErrorCode::MathOverflow);

    let out = num.checked_div(denom).ok_or(ErrorCode::MathOverflow)?;
    msg!("calculate_tokens_out: out={}", out);

    Ok(out as u64)
}

// REMOVED: apply_slippage function - slippage now integrated in calculate_buy_amount_and_slippage

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

// REMOVED: ExecuteBuyAllocated - Merged into ExecuteBuy with allocated_lamports parameter

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
    #[account(mut)]
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

/// Accounts for sync_validator_slot instruction (permissionless)
#[derive(Accounts)]
pub struct SyncValidatorSlot<'info> {
    #[account(
        mut,
        seeds = [VALIDATOR_STATE_SEED, validator_state.mint.as_ref()],
        bump = validator_state.bump,
    )]
    pub validator_state: Account<'info, ValidatorState>,

    // NOTE: NO SIGNER REQUIRED - This is PERMISSIONLESS!
    // Anyone can call this to sync a stale validator to current slot
    // The instruction itself validates that sync is only allowed if stale
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
    #[account(mut)]
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
    pub last_sol_sent_to_root: u64,        // Track SOL sent to root in last cycle (for stats update)
    // Security audit additions (v2)
    pub pending_admin: Option<Pubkey>,     // Two-step admin transfer: proposed new admin
    pub pending_fee_split: Option<u16>,    // Timelock: proposed fee split change
    pub pending_fee_split_timestamp: i64,  // Timelock: when fee split was proposed
    pub admin_operation_cooldown: i64,     // Timelock: cooldown period in seconds (default 3600 = 1hr)
}

impl DATState {
    // Size calculation:
    // - 5 Pubkeys: 32 * 5 = 160 bytes
    // - 14 u64/i64: 8 * 14 = 112 bytes (includes last_sol_sent_to_root)
    // - 2 u32: 4 * 2 = 8 bytes
    // - 5 u8/bool: 1 * 5 = 5 bytes
    // - 2 u16: 2 * 2 = 4 bytes (slippage_bps, fee_split_bps)
    // - 1 Option<Pubkey>: 33 bytes (root_token_mint)
    // - NEW: 1 Option<Pubkey>: 33 bytes (pending_admin)
    // - NEW: 1 Option<u16>: 3 bytes (pending_fee_split)
    // - NEW: 2 i64: 8 * 2 = 16 bytes (pending_fee_split_timestamp, admin_operation_cooldown)
    // Total: 160 + 112 + 8 + 5 + 4 + 33 + 33 + 3 + 16 = 374 bytes
    pub const LEN: usize = 32 * 5 + 8 * 16 + 4 * 2 + 1 * 5 + 2 * 2 + 33 + 33 + 3;
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
    // NEW: Precise per-token fee tracking for multi-token ecosystems
    pub pending_fees_lamports: u64,      // Accumulated fees not yet collected (tracking attribution)
    pub last_fee_update_timestamp: i64,  // Timestamp of last fee update
    pub cycles_participated: u64,        // Number of ecosystem cycles this token participated in
}

impl TokenStats {
    pub const LEN: usize = 32 + 8 * 12 + 1 + 1; // Pubkey(32) + u64(12) + bool(1) + u8(1) = 130
}

/// Validator state for trustless per-token fee attribution
/// Tracks fees validated from PumpFun transaction logs
#[account]
pub struct ValidatorState {
    pub mint: Pubkey,                      // Token mint being tracked
    pub bonding_curve: Pubkey,             // Associated PumpFun bonding curve
    pub last_validated_slot: u64,          // Last slot that was validated
    pub total_validated_lamports: u64,     // Cumulative fees validated historically
    pub total_validated_count: u64,        // Number of validation batches
    pub fee_rate_bps: u16,                 // Expected fee rate (50 = 0.5%)
    pub bump: u8,                          // PDA bump seed
    pub _reserved: [u8; 32],               // Reserved for future use
}

impl ValidatorState {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 2 + 1 + 32; // 123 bytes
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
pub struct AdminTransferProposed {
    pub current_admin: Pubkey,
    pub proposed_admin: Pubkey,
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
    pub old_bps: u16,
    pub new_bps: u16,
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

#[event]
pub struct PendingFeesUpdated {
    pub mint: Pubkey,
    pub amount: u64,
    pub total_pending: u64,
    pub timestamp: i64,
}

#[event]
pub struct ValidatorInitialized {
    pub mint: Pubkey,
    pub bonding_curve: Pubkey,
    pub slot: u64,
    pub timestamp: i64,
}

#[event]
pub struct ValidatorSlotReset {
    pub mint: Pubkey,
    pub old_slot: u64,
    pub new_slot: u64,
    pub timestamp: i64,
}

#[event]
pub struct ValidatedFeesRegistered {
    pub mint: Pubkey,
    pub fee_amount: u64,
    pub end_slot: u64,
    pub tx_count: u32,
    pub total_pending: u64,
    pub timestamp: i64,
}

#[event]
pub struct BuyExecuted {
    pub tokens_bought: u64,
    pub sol_spent: u64,
    pub timestamp: i64,
}

#[event]
pub struct AmmFeesCollected {
    pub mint: Pubkey,
    pub wsol_amount: u64,
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