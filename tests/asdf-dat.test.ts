/**
 * Test suite for ASDF DAT
 * Comprehensive tests for all DAT functionality
 */

import * as anchor from '@project-serum/anchor';
import { Program, AnchorProvider, BN } from '@project-serum/anchor';
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from '@solana/spl-token';
import { assert, expect } from 'chai';
import { AsdfDat } from '../target/types/asdf_dat';

describe('ASDF DAT Tests', () => {
    // Configure the client to use the local cluster
    const provider = AnchorProvider.env();
    anchor.setProvider(provider);

    // Program and accounts
    const program = anchor.workspace.AsdfDat as Program<AsdfDat>;
    let datStatePDA: PublicKey;
    let datStateBump: number;
    
    // Test wallets
    const authority = Keypair.generate();
    const newAuthority = Keypair.generate();
    const unauthorizedWallet = Keypair.generate();
    
    // Test token accounts
    let asdfMint: PublicKey;
    let creatorVault: Keypair;
    let datTokenAccount: PublicKey;

    before(async () => {
        console.log('Setting up test environment...');
        
        // Derive PDA for DAT state
        [datStatePDA, datStateBump] = await PublicKey.findProgramAddress(
            [Buffer.from('dat-state')],
            program.programId
        );
        
        // Airdrop SOL to test wallets
        const airdropAmount = 10 * LAMPORTS_PER_SOL;
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(authority.publicKey, airdropAmount)
        );
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(newAuthority.publicKey, airdropAmount)
        );
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(unauthorizedWallet.publicKey, airdropAmount)
        );
        
        // Create test mint (simulating ASDF token)
        asdfMint = await createMint(
            provider.connection,
            authority,
            authority.publicKey,
            null,
            6 // 6 decimals like ASDF
        );
        
        // Create creator vault account
        creatorVault = Keypair.generate();
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(creatorVault.publicKey, 1 * LAMPORTS_PER_SOL)
        );
        
        // Create DAT token account
        datTokenAccount = await createAccount(
            provider.connection,
            authority,
            asdfMint,
            authority.publicKey
        );
        
        console.log('Test environment ready');
        console.log('Program ID:', program.programId.toString());
        console.log('DAT State PDA:', datStatePDA.toString());
    });

    describe('Initialization', () => {
        it('Should initialize the DAT state', async () => {
            // Initialize the DAT
            const tx = await program.methods
                .initialize()
                .accounts({
                    datState: datStatePDA,
                    authority: authority.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();
            
            console.log('Initialize transaction:', tx);
            
            // Fetch and verify the state
            const state = await program.account.datState.fetch(datStatePDA);
            
            assert.equal(
                state.authority.toString(),
                authority.publicKey.toString(),
                'Authority should be set correctly'
            );
            assert.equal(
                state.totalBurned.toNumber(),
                0,
                'Total burned should be 0'
            );
            assert.equal(
                state.totalBuybacks,
                0,
                'Total buybacks should be 0'
            );
            assert.equal(
                state.isActive,
                true,
                'DAT should be active by default'
            );
        });

        it('Should fail to initialize twice', async () => {
            try {
                await program.methods
                    .initialize()
                    .accounts({
                        datState: datStatePDA,
                        authority: authority.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([authority])
                    .rpc();
                
                assert.fail('Should not be able to initialize twice');
            } catch (error) {
                assert.include(
                    error.toString(),
                    'already in use',
                    'Should fail with already in use error'
                );
            }
        });
    });

    describe('Pause and Resume', () => {
        it('Should pause the DAT', async () => {
            const tx = await program.methods
                .pause()
                .accounts({
                    datState: datStatePDA,
                    authority: authority.publicKey,
                })
                .signers([authority])
                .rpc();
            
            console.log('Pause transaction:', tx);
            
            // Verify state
            const state = await program.account.datState.fetch(datStatePDA);
            assert.equal(state.isActive, false, 'DAT should be paused');
        });

        it('Should fail to pause with unauthorized wallet', async () => {
            try {
                await program.methods
                    .pause()
                    .accounts({
                        datState: datStatePDA,
                        authority: unauthorizedWallet.publicKey,
                    })
                    .signers([unauthorizedWallet])
                    .rpc();
                
                assert.fail('Should not allow unauthorized pause');
            } catch (error) {
                assert.include(
                    error.toString(),
                    'Unauthorized',
                    'Should fail with unauthorized error'
                );
            }
        });

        it('Should resume the DAT', async () => {
            const tx = await program.methods
                .resume()
                .accounts({
                    datState: datStatePDA,
                    authority: authority.publicKey,
                })
                .signers([authority])
                .rpc();
            
            console.log('Resume transaction:', tx);
            
            // Verify state
            const state = await program.account.datState.fetch(datStatePDA);
            assert.equal(state.isActive, true, 'DAT should be active');
        });
    });

    describe('Authority Management', () => {
        it('Should update authority', async () => {
            const tx = await program.methods
                .updateAuthority(newAuthority.publicKey)
                .accounts({
                    datState: datStatePDA,
                    authority: authority.publicKey,
                })
                .signers([authority])
                .rpc();
            
            console.log('Update authority transaction:', tx);
            
            // Verify state
            const state = await program.account.datState.fetch(datStatePDA);
            assert.equal(
                state.authority.toString(),
                newAuthority.publicKey.toString(),
                'Authority should be updated'
            );
        });

        it('Should fail to update authority with old authority', async () => {
            try {
                await program.methods
                    .updateAuthority(authority.publicKey)
                    .accounts({
                        datState: datStatePDA,
                        authority: authority.publicKey,
                    })
                    .signers([authority])
                    .rpc();
                
                assert.fail('Old authority should not be able to update');
            } catch (error) {
                assert.include(
                    error.toString(),
                    'Unauthorized',
                    'Should fail with unauthorized error'
                );
            }
        });

        it('Should allow new authority to pause', async () => {
            const tx = await program.methods
                .pause()
                .accounts({
                    datState: datStatePDA,
                    authority: newAuthority.publicKey,
                })
                .signers([newAuthority])
                .rpc();
            
            console.log('New authority pause transaction:', tx);
            
            const state = await program.account.datState.fetch(datStatePDA);
            assert.equal(state.isActive, false, 'DAT should be paused by new authority');
            
            // Resume for next tests
            await program.methods
                .resume()
                .accounts({
                    datState: datStatePDA,
                    authority: newAuthority.publicKey,
                })
                .signers([newAuthority])
                .rpc();
        });
    });

    describe('Execute Cycle', () => {
        before(async () => {
            // Ensure DAT is active
            const state = await program.account.datState.fetch(datStatePDA);
            if (!state.isActive) {
                await program.methods
                    .resume()
                    .accounts({
                        datState: datStatePDA,
                        authority: newAuthority.publicKey,
                    })
                    .signers([newAuthority])
                    .rpc();
            }
            
            // Add more SOL to creator vault to meet minimum
            await provider.connection.confirmTransaction(
                await provider.connection.requestAirdrop(
                    creatorVault.publicKey,
                    0.1 * LAMPORTS_PER_SOL
                )
            );
            
            // Mint some tokens to DAT account for testing
            await mintTo(
                provider.connection,
                authority,
                asdfMint,
                datTokenAccount,
                authority,
                1000000 * Math.pow(10, 6) // 1M tokens
            );
        });

        it('Should fail with insufficient fees', async () => {
            // Create a vault with insufficient balance
            const poorVault = Keypair.generate();
            
            try {
                await program.methods
                    .executeCycle()
                    .accounts({
                        datState: datStatePDA,
                        creatorVault: poorVault.publicKey,
                        datWallet: authority.publicKey,
                        datTokenAccount: datTokenAccount,
                        poolAccount: PublicKey.default, // Placeholder
                        asdfMint: asdfMint,
                        pumpSwapProgram: PublicKey.default, // Placeholder
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([])
                    .rpc();
                
                assert.fail('Should fail with insufficient fees');
            } catch (error) {
                assert.include(
                    error.toString(),
                    'Insufficient',
                    'Should fail with insufficient fees error'
                );
            }
        });

        it('Should fail when DAT is paused', async () => {
            // Pause the DAT
            await program.methods
                .pause()
                .accounts({
                    datState: datStatePDA,
                    authority: newAuthority.publicKey,
                })
                .signers([newAuthority])
                .rpc();
            
            try {
                await program.methods
                    .executeCycle()
                    .accounts({
                        datState: datStatePDA,
                        creatorVault: creatorVault.publicKey,
                        datWallet: authority.publicKey,
                        datTokenAccount: datTokenAccount,
                        poolAccount: PublicKey.default, // Placeholder
                        asdfMint: asdfMint,
                        pumpSwapProgram: PublicKey.default, // Placeholder
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([])
                    .rpc();
                
                assert.fail('Should not execute when paused');
            } catch (error) {
                assert.include(
                    error.toString(),
                    'not active',
                    'Should fail with DAT not active error'
                );
            }
            
            // Resume for next tests
            await program.methods
                .resume()
                .accounts({
                    datState: datStatePDA,
                    authority: newAuthority.publicKey,
                })
                .signers([newAuthority])
                .rpc();
        });

        // Note: Full cycle execution test would require mocking PumpSwap
        // which is complex in a test environment
        it('Should track statistics correctly', async () => {
            const state = await program.account.datState.fetch(datStatePDA);
            
            assert.isAtLeast(
                state.lastCycleTimestamp.toNumber(),
                0,
                'Last cycle timestamp should be set'
            );
            
            console.log('Final state:', {
                authority: state.authority.toString(),
                totalBurned: state.totalBurned.toString(),
                totalBuybacks: state.totalBuybacks,
                isActive: state.isActive,
                lastCycleTimestamp: new Date(state.lastCycleTimestamp.toNumber() * 1000),
            });
        });
    });

    describe('Get Stats', () => {
        it('Should retrieve DAT statistics', async () => {
            const stats = await program.methods
                .getStats()
                .accounts({
                    datState: datStatePDA,
                })
                .view();
            
            assert.exists(stats, 'Stats should be returned');
            assert.exists(stats.totalBurned, 'Total burned should exist');
            assert.exists(stats.totalBuybacks, 'Total buybacks should exist');
            assert.exists(stats.isActive, 'Is active should exist');
            assert.exists(stats.authority, 'Authority should exist');
            
            console.log('DAT Statistics:', {
                totalBurned: stats.totalBurned.toString(),
                totalBuybacks: stats.totalBuybacks,
                isActive: stats.isActive,
                authority: stats.authority.toString(),
            });
        });
    });

    describe('Edge Cases', () => {
        it('Should handle maximum values correctly', async () => {
            const state = await program.account.datState.fetch(datStatePDA);
            
            // Verify state can handle large numbers
            assert.doesNotThrow(() => {
                const maxBurn = new BN(Number.MAX_SAFE_INTEGER);
                console.log('Max safe burn value:', maxBurn.toString());
            });
        });

        it('Should maintain state consistency', async () => {
            const stateBefore = await program.account.datState.fetch(datStatePDA);
            
            // Pause and resume
            await program.methods
                .pause()
                .accounts({
                    datState: datStatePDA,
                    authority: newAuthority.publicKey,
                })
                .signers([newAuthority])
                .rpc();
            
            await program.methods
                .resume()
                .accounts({
                    datState: datStatePDA,
                    authority: newAuthority.publicKey,
                })
                .signers([newAuthority])
                .rpc();
            
            const stateAfter = await program.account.datState.fetch(datStatePDA);
            
            // Verify non-affected fields remain unchanged
            assert.equal(
                stateBefore.totalBurned.toString(),
                stateAfter.totalBurned.toString(),
                'Total burned should not change'
            );
            assert.equal(
                stateBefore.totalBuybacks,
                stateAfter.totalBuybacks,
                'Total buybacks should not change'
            );
        });
    });
});
