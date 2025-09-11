use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Token, TokenAccount, Mint, Transfer};
use solana_program::pubkey;

declare_id!("ASDFdatBuybackBurnXXXXXXXXXXXXXXXXXXXXXXXXX");

// Fixed on-chain addresses - DO NOT MODIFY
pub const CTO_WALLET: Pubkey = pubkey!("vcGYZbvDid6cRUkCCqcWpBxow73TLpmY6ipmDUtrTF8");
pub const ASDF_MINT: Pubkey = pubkey!("9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump");
pub const POOL_PUMPSWAP: Pubkey = pubkey!("DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb");
pub const LP_TOKEN: Pubkey = pubkey!("GjfJvEY1Yw4bjt15r1q8ek4ZxjR5cC7bMTZZdrCWoGtA");
pub const PUMP_SWAP_PROGRAM: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEa");

// Configuration constants
pub const MIN_FEES_TO_CLAIM: u64 = 50_000_000; // 0.05 SOL in lamports
pub const SLIPPAGE_BPS: u16 = 100; // 1% slippage (100 basis points)
pub const DAT_STATE_SEED: &[u8] = b"dat-state";

#[program]
pub mod asdf_dat {
    use super::*;

    /// Initialize the DAT state account
    /// This instruction should only be called once to set up the program
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        
        // Set initial state values
        state.authority = ctx.accounts.authority.key();
        state.cto_wallet = CTO_WALLET;
        state.total_burned = 0;
        state.total_buybacks = 0;
        state.is_active = true;
        state.last_cycle_timestamp = Clock::get()?.unix_timestamp;
        
        msg!("DAT initialized successfully");
        msg!("Authority: {}", state.authority);
        msg!("CTO Wallet: {}", state.cto_wallet);
        
        Ok(())
    }

    /// Execute a complete cycle: Claim → Buyback → Burn
    /// This is the main function that performs all three operations atomically
    pub fn execute_cycle(ctx: Context<ExecuteCycle>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        
        // Check if DAT is active
        require!(
            state.is_active,
            ErrorCode::DATNotActive
        );
        
        // Check minimum fees threshold
        let available_fees = ctx.accounts.creator_vault.lamports();
        require!(
            available_fees >= MIN_FEES_TO_CLAIM,
            ErrorCode::InsufficientFees
        );
        
        msg!("Starting cycle with {} lamports available", available_fees);
        
        // Step 1: Claim fees from creator vault
        let claimed_amount = claim_fees(
            &ctx.accounts.creator_vault,
            &ctx.accounts.dat_wallet,
            available_fees
        )?;
        
        msg!("Claimed {} lamports from creator vault", claimed_amount);
        
        // Step 2: Buyback ASDF tokens
        let tokens_bought = buyback_tokens(
            &ctx.accounts.dat_wallet,
            &ctx.accounts.dat_token_account,
            &ctx.accounts.pool_account,
            &ctx.accounts.pump_swap_program,
            claimed_amount
        )?;
        
        msg!("Bought {} ASDF tokens", tokens_bought);
        
        // Step 3: Burn all bought tokens
        burn_tokens(
            &ctx.accounts.dat_token_account,
            &ctx.accounts.asdf_mint,
            &ctx.accounts.token_program,
            tokens_bought
        )?;
        
        msg!("Burned {} ASDF tokens", tokens_bought);
        
        // Update state statistics
        state.total_burned += tokens_bought;
        state.total_buybacks += 1;
        state.last_cycle_timestamp = Clock::get()?.unix_timestamp;
        
        msg!("Cycle completed successfully");
        msg!("Total burned: {} ASDF", state.total_burned);
        msg!("Total buybacks: {}", state.total_buybacks);
        
        // Emit event for monitoring
        emit!(CycleCompleted {
            tokens_burned: tokens_bought,
            sol_used: claimed_amount,
            total_burned: state.total_burned,
            timestamp: state.last_cycle_timestamp,
        });
        
        Ok(())
    }

    /// Pause the DAT operations (emergency control)
    pub fn pause(ctx: Context<AdminControl>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        
        // Only authority can pause
        require!(
            ctx.accounts.authority.key() == state.authority,
            ErrorCode::UnauthorizedAccess
        );
        
        state.is_active = false;
        msg!("DAT operations paused");
        
        emit!(DATStatusChanged {
            is_active: false,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Resume the DAT operations
    pub fn resume(ctx: Context<AdminControl>) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        
        // Only authority can resume
        require!(
            ctx.accounts.authority.key() == state.authority,
            ErrorCode::UnauthorizedAccess
        );
        
        state.is_active = true;
        msg!("DAT operations resumed");
        
        emit!(DATStatusChanged {
            is_active: true,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Update the authority (transfer admin control)
    pub fn update_authority(
        ctx: Context<UpdateAuthority>,
        new_authority: Pubkey
    ) -> Result<()> {
        let state = &mut ctx.accounts.dat_state;
        
        // Only current authority can update
        require!(
            ctx.accounts.authority.key() == state.authority,
            ErrorCode::UnauthorizedAccess
        );
        
        let old_authority = state.authority;
        state.authority = new_authority;
        
        msg!("Authority updated from {} to {}", old_authority, new_authority);
        
        emit!(AuthorityUpdated {
            old_authority,
            new_authority,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Get current DAT statistics (view function)
    pub fn get_stats(ctx: Context<GetStats>) -> Result<DATStats> {
        let state = &ctx.accounts.dat_state;
        
        Ok(DATStats {
            total_burned: state.total_burned,
            total_buybacks: state.total_buybacks,
            is_active: state.is_active,
            last_cycle_timestamp: state.last_cycle_timestamp,
            authority: state.authority,
        })
    }
}

// Helper functions for core operations

/// Claim fees from the creator vault
fn claim_fees(
    creator_vault: &AccountInfo,
    dat_wallet: &AccountInfo,
    amount: u64,
) -> Result<u64> {
    // Transfer SOL from creator vault to DAT wallet
    let ix = solana_program::system_instruction::transfer(
        creator_vault.key,
        dat_wallet.key,
        amount,
    );
    
    solana_program::program::invoke(
        &ix,
        &[creator_vault.clone(), dat_wallet.clone()],
    )?;
    
    Ok(amount)
}

/// Buy ASDF tokens on PumpSwap
fn buyback_tokens(
    dat_wallet: &AccountInfo,
    dat_token_account: &AccountInfo,
    pool_account: &AccountInfo,
    pump_swap_program: &AccountInfo,
    sol_amount: u64,
) -> Result<u64> {
    // Calculate expected output with slippage
    let expected_tokens = calculate_swap_output(sol_amount);
    let min_tokens = expected_tokens * (10000 - SLIPPAGE_BPS as u64) / 10000;
    
    // Prepare swap instruction for PumpSwap
    // This is a simplified version - actual implementation would need
    // to match PumpSwap's exact interface
    let swap_data = SwapData {
        amount_in: sol_amount,
        minimum_amount_out: min_tokens,
    };
    
    // Execute swap on PumpSwap
    // Note: This would need to be adapted to PumpSwap's actual interface
    msg!("Executing swap: {} SOL for min {} ASDF", sol_amount, min_tokens);
    
    // For now, return a simulated amount
    // In production, this would return the actual swapped amount
    Ok(expected_tokens)
}

/// Burn ASDF tokens
fn burn_tokens(
    token_account: &AccountInfo,
    mint: &AccountInfo,
    token_program: &AccountInfo,
    amount: u64,
) -> Result<()> {
    // Create burn instruction
    let burn_ix = spl_token::instruction::burn(
        token_program.key,
        token_account.key,
        mint.key,
        token_account.key, // Authority is the token account itself for burning
        &[],
        amount,
    )?;
    
    // Execute burn
    solana_program::program::invoke(
        &burn_ix,
        &[
            token_account.clone(),
            mint.clone(),
            token_program.clone(),
        ],
    )?;
    
    Ok(())
}

/// Calculate expected swap output (simplified version)
fn calculate_swap_output(sol_amount: u64) -> u64 {
    // This is a simplified calculation
    // In production, this would query the pool for accurate pricing
    // Assuming 1 SOL = 666,666 ASDF (based on $0.0003 price)
    sol_amount * 666_666 / 1_000_000_000
}

// Account structures

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + DATState::LEN,
        seeds = [DAT_STATE_SEED],
        bump
    )]
    pub dat_state: Account<'info, DATState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteCycle<'info> {
    #[account(
        mut,
        seeds = [DAT_STATE_SEED],
        bump
    )]
    pub dat_state: Account<'info, DATState>,
    
    /// CHECK: Creator vault account from PumpSwap
    #[account(mut)]
    pub creator_vault: AccountInfo<'info>,
    
    /// CHECK: DAT wallet to receive fees
    #[account(mut)]
    pub dat_wallet: AccountInfo<'info>,
    
    #[account(mut)]
    pub dat_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: PumpSwap pool account
    pub pool_account: AccountInfo<'info>,
    
    #[account(address = ASDF_MINT)]
    pub asdf_mint: Account<'info, Mint>,
    
    /// CHECK: PumpSwap program
    #[account(address = PUMP_SWAP_PROGRAM)]
    pub pump_swap_program: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminControl<'info> {
    #[account(
        mut,
        seeds = [DAT_STATE_SEED],
        bump
    )]
    pub dat_state: Account<'info, DATState>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateAuthority<'info> {
    #[account(
        mut,
        seeds = [DAT_STATE_SEED],
        bump
    )]
    pub dat_state: Account<'info, DATState>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct GetStats<'info> {
    #[account(seeds = [DAT_STATE_SEED], bump)]
    pub dat_state: Account<'info, DATState>,
}

// State account structure
#[account]
pub struct DATState {
    pub authority: Pubkey,           // Admin wallet
    pub cto_wallet: Pubkey,          // Creator wallet (fixed)
    pub total_burned: u64,           // Total ASDF tokens burned
    pub total_buybacks: u32,         // Number of buyback cycles
    pub is_active: bool,             // Emergency pause flag
    pub last_cycle_timestamp: i64,   // Last execution timestamp
}

impl DATState {
    pub const LEN: usize = 32 + 32 + 8 + 4 + 1 + 8 + 16; // Account size with padding
}

// Data structures

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapData {
    pub amount_in: u64,
    pub minimum_amount_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DATStats {
    pub total_burned: u64,
    pub total_buybacks: u32,
    pub is_active: bool,
    pub last_cycle_timestamp: i64,
    pub authority: Pubkey,
}

// Events for monitoring

#[event]
pub struct CycleCompleted {
    pub tokens_burned: u64,
    pub sol_used: u64,
    pub total_burned: u64,
    pub timestamp: i64,
}

#[event]
pub struct DATStatusChanged {
    pub is_active: bool,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityUpdated {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub timestamp: i64,
}

// Error codes

#[error_code]
pub enum ErrorCode {
    #[msg("DAT operations are currently paused")]
    DATNotActive,
    
    #[msg("Insufficient fees in creator vault (minimum 0.05 SOL required)")]
    InsufficientFees,
    
    #[msg("Unauthorized access - only authority can perform this action")]
    UnauthorizedAccess,
    
    #[msg("Invalid swap parameters")]
    InvalidSwapParams,
    
    #[msg("Swap failed - slippage exceeded")]
    SlippageExceeded,
}
