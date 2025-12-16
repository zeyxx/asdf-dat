import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, SystemProgram, ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import fs from 'fs';

const IDL = JSON.parse(fs.readFileSync('./target/idl/asdf_dat.json', 'utf8'));
const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

async function main() {
  const connection = new Connection('https://devnet.helius-rpc.com/?api-key=ac94987a-2acd-4778-8759-1bb4708e905b', 'confirmed');
  const walletKeyPair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('./devnet-wallet.json', 'utf8'))));
  const wallet = new anchor.Wallet(walletKeyPair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(IDL, provider);
  
  const mint = new PublicKey('FuBryC4gM3SvNLPXPsckH4zaMs6pktxUWLhCiG7aBavb');
  const creator = new PublicKey('84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68');
  
  const [datState] = PublicKey.findProgramAddressSync([Buffer.from('dat_v3')], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([Buffer.from('auth_v3')], PROGRAM_ID);
  const [tokenStats] = PublicKey.findProgramAddressSync([Buffer.from('token_stats_v1'), mint.toBuffer()], PROGRAM_ID);
  const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PUMP_PROGRAM);
  const [rootTreasury] = PublicKey.findProgramAddressSync([Buffer.from('root_treasury'), mint.toBuffer()], PROGRAM_ID);

  console.log('DAT State:', datState.toBase58());
  console.log('DAT Authority:', datAuthority.toBase58());
  console.log('Token Stats:', tokenStats.toBase58());
  console.log('Creator Vault:', creatorVault.toBase58());
  console.log('Root Treasury:', rootTreasury.toBase58());
  
  // Check vault balance
  const vaultBalance = await connection.getBalance(creatorVault);
  console.log('Vault balance:', vaultBalance / 1e9, 'SOL');
  
  // Check if datAuthority is the creator (it should be for this to work)
  console.log('\nDAT Authority expected as creator:', datAuthority.toBase58());
  console.log('Actual creator config:', creator.toBase58());
  console.log('IMPORTANT: These MUST match for collect_creator_fee to work!');

  const collectIx = await program.methods
    .collectFees(true, true)
    .accounts({
      datState,
      tokenStats,
      tokenMint: mint,
      datAuthority,
      creatorVault,
      pumpEventAuthority,
      pumpSwapProgram: PUMP_PROGRAM,
      rootTreasury,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(collectIx);
    
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = wallet.publicKey;
  
  console.log('\nSimulating collect_fees only...');
  try {
    const result = await connection.simulateTransaction(tx);
    if (result.value.err) {
      console.log('Simulation failed:', JSON.stringify(result.value.err));
      console.log('Logs:');
      result.value.logs?.forEach(l => console.log('  ', l));
    } else {
      console.log('✅ Simulation succeeded!');
      console.log('Logs:', result.value.logs?.slice(-5).join('\n'));
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);
