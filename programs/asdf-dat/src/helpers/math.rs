use anchor_lang::prelude::*;
use crate::errors::ErrorCode;
use crate::constants::*;

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

/// Calculate tokens out with market cap-based fee tiers
/// Used for PumpSwap AMM calculations
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

    // Market cap-based fee tiers (in basis points)
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

/// Format token amount with decimals for readable logs
/// Most tokens have 6 decimals, so we divide by 1_000_000
pub fn format_tokens(amount: u64) -> (u64, u64) {
    const DECIMALS: u64 = 1_000_000; // 6 decimals
    let whole = amount / DECIMALS;
    let fractional = amount % DECIMALS;
    (whole, fractional)
}

/// Helper to manually deserialize PumpFun bonding curve (avoids struct alignment issues)
pub fn deserialize_bonding_curve(data: &[u8]) -> Result<(u64, u64)> {
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

/// Helper function to calculate buy parameters for PumpFun
/// Returns (max_sol_cost, desired_tokens)
/// PumpFun buy instruction expects: token_amount (how many tokens we want) and max_sol_cost (max SOL we'll pay)
#[inline(never)]
pub fn calculate_buy_amount_and_slippage(
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
