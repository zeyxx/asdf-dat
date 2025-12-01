use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use crate::constants::*;
use crate::errors::ErrorCode;

/// Helper function to collect creator fees CPI (extracted to reduce stack usage)
/// Used for PumpFun bonding curve tokens
#[inline(never)]
pub fn collect_creator_fee_cpi<'info>(
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
pub fn collect_amm_creator_fee_cpi<'info>(
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

/// Helper function to split fees for secondary tokens (extracted to reduce stack usage)
/// HIGH-03 FIX: Added balance verification after transfer to ensure root_treasury received funds
#[inline(never)]
pub fn split_fees_to_root<'info>(
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

/// Minimal CPI executor for PumpFun buy
#[inline(never)]
pub fn execute_pumpfun_cpi<'info>(
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
