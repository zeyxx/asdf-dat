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
            AccountMeta::new(dat_authority.key(), true),  // signer = true for invoke_signed
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
        program_id: PUMP_SWAP_PROGRAM,
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

/// Minimal CPI executor for PumpFun buy (CORRECT 16-account format)
/// Based on successful devnet tx 3Rqh43z2Vt2BkSPbkchLKsJr4CZiNbqbfRgapJtuGqfoaKLuyCNYbRyvCwv7ksRRdsRPTjdQGCTfgeZQMmJGksHW
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

    // CORRECT 16-account order (with volume accumulators):
    // 0: global_config, 1: fee_recipient, 2: mint, 3: pool,
    // 4: pool_token_account, 5: user_token_account, 6: user,
    // 7: system_program, 8: token_program, 9: creator_vault,
    // 10: event_authority, 11: pump_program, 12: global_volume_acc, 13: user_volume_acc,
    // 14: fee_config, 15: fee_program
    let ix = Instruction {
        program_id: PUMP_PROGRAM,
        accounts: vec![
            AccountMeta::new_readonly(global_config, false),           // 0
            AccountMeta::new(fee_recipient, false),                    // 1
            AccountMeta::new(mint, false),                             // 2
            AccountMeta::new(pool, false),                             // 3
            AccountMeta::new(pool_token_account, false),               // 4
            AccountMeta::new(user_token_account, false),               // 5
            AccountMeta::new(user, true),                              // 6: signer
            AccountMeta::new_readonly(account_infos[7].key(), false),  // 7: system
            AccountMeta::new_readonly(account_infos[8].key(), false),  // 8: token_program (BEFORE creator_vault!)
            AccountMeta::new(account_infos[9].key(), false),           // 9: creator_vault (AFTER token_program!)
            AccountMeta::new_readonly(account_infos[10].key(), false), // 10: event_auth
            AccountMeta::new_readonly(PUMP_PROGRAM, false),            // 11: pump_program
            AccountMeta::new_readonly(account_infos[12].key(), false), // 12: global_volume_acc
            AccountMeta::new(account_infos[13].key(), false),          // 13: user_volume_acc
            AccountMeta::new_readonly(account_infos[14].key(), false), // 14: fee_config
            AccountMeta::new_readonly(account_infos[15].key(), false), // 15: fee_program
        ],
        data,
    };

    invoke_signed(&ix, account_infos, &[seeds])?;
    Ok(())
}
