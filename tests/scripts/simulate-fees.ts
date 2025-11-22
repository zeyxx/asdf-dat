import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  Transaction,
  TransactionInstruction
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction
} from "@solana/spl-token";
import fs from "fs";

const BONDING_CURVE = new PublicKey("8D4SySZrzM1AW4rYQg34QFAxdXFa52Lks18Sck24kP9E");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_SWAP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

async function simulateFees(amountSol: number) {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  console.log(`💰 Simulation de ${amountSol} SOL de fees dans le creator vault\n`);

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("coin-creator-vault-authority"), BONDING_CURVE.toBuffer()],
    PUMP_SWAP
  );
  
  const creatorVault = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);
  const walletWsol = await getAssociatedTokenAddress(WSOL_MINT, wallet.publicKey);

  const tx = new Transaction();
  const lamports = amountSol * 1e9;

  // Créer ATA WSOL si besoin
  const walletWsolInfo = await connection.getAccountInfo(walletWsol);
  if (!walletWsolInfo) {
    tx.add(createAssociatedTokenAccountInstruction(
      wallet.publicKey, walletWsol, wallet.publicKey, WSOL_MINT
    ));
  }

  // Transférer SOL vers le wrapped account
  tx.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: walletWsol,
    lamports,
  }));

  // Sync pour convertir en WSOL
  tx.add(createSyncNativeInstruction(walletWsol));

  // Transférer WSOL au creator vault
  tx.add(
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: walletWsol, isSigner: false, isWritable: true },
        { pubkey: creatorVault, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([3, ...new Uint8Array(new BigUint64Array([BigInt(lamports)]).buffer)]),
    })
  );

  const sig = await connection.sendTransaction(tx, [wallet]);
  await connection.confirmTransaction(sig);

  console.log(`✅ ${amountSol} SOL transférés au creator vault`);
  console.log(`Vault: ${creatorVault.toString()}`);
  console.log(`Signature: ${sig}\n`);
  console.log(`Le bot peut maintenant collecter ces fees!`);
}

const amount = parseFloat(process.argv[2] || "0.01");
simulateFees(amount).catch(console.error);
