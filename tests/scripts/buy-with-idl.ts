import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { 
  getAssociatedTokenAddress, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import fs from "fs";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const TOKEN_MINT = new PublicKey("3Xai2JhK9spvyTAbDbVBpXTDNdY13VJwmRh2Bs8PExQx");

async function buyWithIDL(amountSol: number) {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });

  // Charger l'IDL PumpSwap
  const pumpIdl = JSON.parse(fs.readFileSync("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P-idl.json", "utf-8"));
  const program = new Program(pumpIdl, provider);

  console.log(`🛒 Achat de ${amountSol} SOL de tokens...\n`);

  // Dériver les comptes
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), TOKEN_MINT.toBuffer()],
    PUMP_PROGRAM
  );

  const [global] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const associatedBondingCurve = await getAssociatedTokenAddress(
    TOKEN_MINT,
    bondingCurve,
    true
  );

  const associatedUser = await getAssociatedTokenAddress(
    TOKEN_MINT,
    wallet.publicKey
  );

  // Créer l'ATA si nécessaire
  const userAtaInfo = await connection.getAccountInfo(associatedUser);
  if (!userAtaInfo) {
    console.log(`Création ATA: ${associatedUser.toString()}`);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        associatedUser,
        wallet.publicKey,
        TOKEN_MINT
      )
    );
    await connection.sendTransaction(tx, [wallet]);
    console.log(`✅ ATA créé\n`);
  }

  // Lire le bonding curve pour obtenir le creator
  const bondingCurveData = await connection.getAccountInfo(bondingCurve);
  if (!bondingCurveData) {
    throw new Error("Bonding curve non trouvée");
  }
  
  // Le creator est aux bytes 40-72
  const creatorBytes = bondingCurveData.data.slice(40, 72);
  const creator = new PublicKey(creatorBytes);
  
  console.log(`Creator: ${creator.toString()}`);

  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM
  );

  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), wallet.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  // fee_config seed depuis l'IDL
  const feeConfigSeed = Buffer.from([
    1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170,
    81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176
  ]);

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), feeConfigSeed],
    FEE_PROGRAM
  );

  // Fee recipient connu pour devnet
  const feeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

  console.log(`Fee Recipient: ${feeRecipient.toString()}`);
  console.log(`Bonding Curve: ${bondingCurve.toString()}\n`);

  // Paramètres
  const amountTokens = new BN(1_000_000_000); // 1 billion tokens minimum
  const maxSolCost = new BN(Math.floor(amountSol * 1e9));
  const trackVolume = { some: {} }; // OptionBool::Some

  try {
    const tx = await program.methods
      .buy(amountTokens, maxSolCost, trackVolume)
      .accounts({
        global,
        feeRecipient,
        mint: TOKEN_MINT,
        bondingCurve,
        associatedBondingCurve,
        associatedUser,
        user: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        creatorVault,
        eventAuthority,
        program: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
      })
      .rpc();

    console.log(`✅ Achat réussi!`);
    console.log(`Signature: ${tx}`);
    console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);
  } catch (error: any) {
    console.error(`❌ Erreur:`, error.message);
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }
}

const amount = parseFloat(process.argv[2] || "0.1");
buyWithIDL(amount).catch(console.error);
