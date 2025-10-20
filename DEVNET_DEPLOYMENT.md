# Guide de Déploiement Devnet - ASDF DAT

Ce guide vous permet de déployer et tester le programme ASDF DAT sur Solana devnet avant le déploiement mainnet.

## Objectif

Tester le programme dans un environnement devnet avec un token créé sur PumpFun devnet pour valider :
- Le déploiement du programme
- L'initialisation du protocole
- Les cycles de buyback/burn
- L'intégration avec PumpSwap
- La gestion des frais creator

## Prérequis

1. **Outils Solana**
   ```bash
   solana --version  # 1.17.0 ou supérieur
   anchor --version  # 0.30.0
   ```

2. **Wallet Devnet avec SOL**
   ```bash
   # Créer un nouveau wallet pour devnet (ou utiliser existant)
   solana-keygen new -o devnet-wallet.json

   # Configurer Solana pour devnet
   solana config set --url https://api.devnet.solana.com
   solana config set --keypair ./devnet-wallet.json

   # Obtenir des SOL devnet (répéter si nécessaire)
   solana airdrop 2
   solana airdrop 2

   # Vérifier le solde
   solana balance
   ```

## Étape 1 : Créer un Token de Test sur PumpFun Devnet

### 1.1 Accéder à PumpFun Devnet

PumpFun devnet est accessible à : `https://devnet.pump.fun` (ou selon la documentation officielle)

**Note**: Si PumpFun n'a pas de devnet public, vous pouvez :
- Utiliser un token SPL standard pour tester la logique de base
- Contacter l'équipe PumpFun pour accès devnet
- Simuler localement avec Anchor

### 1.2 Créer votre Token de Test

1. Connectez votre wallet devnet à PumpFun devnet
2. Créez un nouveau token avec les paramètres :
   - **Nom**: ASDF Test
   - **Symbol**: ASDFT
   - **Supply initial**: 1,000,000,000 (1 milliard)
   - **Description**: Token de test pour ASDF DAT protocol

3. **Notez les adresses importantes** :
   ```
   Token Mint: [VOTRE_TOKEN_MINT_DEVNET]
   Pool Address: [POOL_ADDRESS_DEVNET]
   Creator: [VOTRE_WALLET]
   ```

### 1.3 Obtenir les Adresses PumpSwap Devnet

Les adresses suivantes doivent être mises à jour pour devnet :

```bash
# Adresses PumpSwap Devnet (à vérifier avec la doc officielle)
PUMP_SWAP_PROGRAM_DEVNET="[ADRESSE_PROGRAMME_PUMPSWAP_DEVNET]"
WSOL_MINT="So11111111111111111111111111111111111111112"  # Même sur devnet
TOKEN_2022_PROGRAM="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"  # Même sur devnet
FEE_PROGRAM_DEVNET="[ADRESSE_FEE_PROGRAM_DEVNET]"
```

## Étape 2 : Configurer le Programme pour Devnet

### 2.1 Modifier les Constantes dans `lib.rs`

Créez une copie de sauvegarde :
```bash
cp programs/asdf-dat/src/lib.rs programs/asdf-dat/src/lib.rs.mainnet.backup
```

Éditez `programs/asdf-dat/src/lib.rs` et remplacez les constantes (lignes 15-21) :

```rust
// ===========================
// DEVNET CONSTANTS - À REMPLACER AVEC VOS ADRESSES
// ===========================

// Vos adresses devnet
pub const ASDF_MINT: Pubkey = solana_program::pubkey!("[VOTRE_TOKEN_MINT_DEVNET]");
pub const WSOL_MINT: Pubkey = solana_program::pubkey!("So11111111111111111111111111111111111111112");
pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!("[POOL_ADDRESS_DEVNET]");
pub const PUMP_SWAP_PROGRAM: Pubkey = solana_program::pubkey!("[PUMP_SWAP_PROGRAM_DEVNET]");
pub const TOKEN_2022_PROGRAM: Pubkey = solana_program::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const FEE_PROGRAM: Pubkey = solana_program::pubkey!("[FEE_PROGRAM_DEVNET]");

// Protocol fee recipients (utiliser votre wallet devnet pour tester)
pub const PROTOCOL_FEE_RECIPIENTS: [Pubkey; 8] = [
    solana_program::pubkey!("[VOTRE_WALLET_DEVNET]"),
    solana_program::pubkey!("[VOTRE_WALLET_DEVNET]"),
    solana_program::pubkey!("[VOTRE_WALLET_DEVNET]"),
    solana_program::pubkey!("[VOTRE_WALLET_DEVNET]"),
    solana_program::pubkey!("[VOTRE_WALLET_DEVNET]"),
    solana_program::pubkey!("[VOTRE_WALLET_DEVNET]"),
    solana_program::pubkey!("[VOTRE_WALLET_DEVNET]"),
    solana_program::pubkey!("[VOTRE_WALLET_DEVNET]"),
];
```

### 2.2 Ajuster les Paramètres de Test

Pour faciliter les tests sur devnet, vous pouvez réduire les seuils :

```rust
// Operating parameters - DEVNET VALUES
pub const MIN_FEES_TO_CLAIM: u64 = 10_000_000; // 0.01 SOL (vs 0.19 mainnet)
pub const MAX_FEES_PER_CYCLE: u64 = 1_000_000_000; // 1 SOL max (vs 10 mainnet)
pub const MIN_CYCLE_INTERVAL: i64 = 60; // 1 minute (vs 1 hour mainnet)
```

### 2.3 Mettre à Jour Anchor.toml

Éditez `Anchor.toml` :

```toml
[provider]
cluster = "devnet"  # Changé de mainnet à devnet
wallet = "./devnet-wallet.json"  # Votre wallet devnet

[programs.devnet]
asdf_dat = "EJdSbSXMXQLp7WLqgVYjJ6a6BqMw6t8MzfavWQBZM6a2"  # Sera remplacé après build
```

## Étape 3 : Build et Déploiement

### 3.1 Build le Programme

```bash
# Build
anchor build

# Récupérer le program ID
solana address -k target/deploy/asdf_dat-keypair.json
```

### 3.2 Mettre à Jour le Program ID

Copiez le program ID obtenu et mettez à jour :

1. **Dans `lib.rs`** (ligne 9) :
   ```rust
   declare_id!("VOTRE_NOUVEAU_PROGRAM_ID");
   ```

2. **Dans `Anchor.toml`** :
   ```toml
   [programs.devnet]
   asdf_dat = "VOTRE_NOUVEAU_PROGRAM_ID"
   ```

3. **Rebuild** :
   ```bash
   anchor build
   ```

### 3.3 Déployer sur Devnet

```bash
# Vérifier que vous êtes sur devnet
solana config get

# Déployer (nécessite ~3-5 SOL)
anchor deploy --provider.cluster devnet

# Vérifier le déploiement
solana program show VOTRE_PROGRAM_ID
```

## Étape 4 : Initialiser le Protocole

### 4.1 Créer les Comptes Token pour DAT Authority

```bash
# Calculer l'adresse du DAT Authority (PDA)
# Utiliser un script ou anchor pour dériver le PDA
# seeds: [b"dat-authority"], program_id

# Créer les ATAs pour le DAT Authority
# Ceci sera fait automatiquement lors de l'initialisation
```

### 4.2 Script d'Initialisation

Créez `scripts/devnet-init.ts` :

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AsdfDat } from "../target/types/asdf_dat";

async function initialize() {
  // Configuration
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AsdfDat as Program<AsdfDat>;

  // Dériver les PDAs
  const [datState] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("dat-state")],
    program.programId
  );

  const [datAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("dat-authority")],
    program.programId
  );

  console.log("DAT State:", datState.toString());
  console.log("DAT Authority:", datAuthority.toString());

  // Initialiser
  try {
    const tx = await program.methods
      .initialize()
      .accounts({
        datState: datState,
        datAuthority: datAuthority,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Initialized successfully!");
    console.log("Transaction:", tx);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

initialize();
```

Exécutez :
```bash
ts-node scripts/devnet-init.ts
```

### 4.3 Transférer la Propriété Creator à DAT Authority

**CRITIQUE** : Pour que le protocole fonctionne, vous devez transférer la propriété du token (coin_creator) au DAT Authority.

Sur PumpFun devnet :
1. Accédez aux paramètres de votre token
2. Transférez le creator au DAT Authority PDA : `[ADRESSE_DAT_AUTHORITY]`

## Étape 5 : Tests

### 5.1 Créer de l'Activité de Trading

Pour générer des frais creator, effectuez des trades sur PumpFun devnet :

```bash
# Faire des swaps pour générer des frais
# Via l'interface PumpFun devnet ou scripts
```

### 5.2 Vérifier l'Accumulation des Frais

```bash
# Vérifier le solde du creator vault
spl-token accounts --owner [DAT_AUTHORITY]
```

### 5.3 Exécuter un Cycle de Test

Créez `scripts/devnet-execute-cycle.ts` :

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AsdfDat } from "../target/types/asdf_dat";
import { getAssociatedTokenAddress } from "@solana/spl-token";

async function executeCycle() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AsdfDat as Program<AsdfDat>;

  // Dériver PDAs et ATAs
  // ... (voir exemple complet dans le repo)

  try {
    const tx = await program.methods
      .executeCycle()
      .accounts({
        // ... tous les comptes requis
      })
      .rpc();

    console.log("✅ Cycle executed successfully!");
    console.log("Transaction:", tx);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

executeCycle();
```

## Étape 6 : Monitoring Devnet

### 6.1 Vérifier l'État du Protocole

```typescript
// scripts/devnet-status.ts
import * as anchor from "@coral-xyz/anchor";

async function getStatus() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AsdfDat;
  const [datState] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("dat-state")],
    program.programId
  );

  const state = await program.account.datState.fetch(datState);

  console.log("📊 DAT Protocol Status (Devnet)");
  console.log("================================");
  console.log("Active:", state.isActive);
  console.log("Emergency Pause:", state.emergencyPause);
  console.log("Total Burned:", state.totalBurned.toString());
  console.log("Total SOL Collected:", state.totalSolCollected.toString());
  console.log("Total Buybacks:", state.totalBuybacks);
  console.log("Failed Cycles:", state.failedCycles);
  console.log("Last Cycle:", new Date(state.lastCycleTimestamp.toNumber() * 1000));
}

getStatus();
```

### 6.2 Explorer Devnet

Utilisez Solana Explorer en mode devnet :
```
https://explorer.solana.com/?cluster=devnet
```

## Étape 7 : Checklist Avant Mainnet

Avant de déployer sur mainnet, vérifiez :

- [ ] ✅ Le programme se déploie sans erreur
- [ ] ✅ L'initialisation fonctionne correctement
- [ ] ✅ Les cycles s'exécutent avec succès
- [ ] ✅ Les tokens sont correctement burn
- [ ] ✅ Les frais sont collectés de la vault creator
- [ ] ✅ Les validations de sécurité fonctionnent (slippage, price impact)
- [ ] ✅ Le système AM/PM fonctionne
- [ ] ✅ Les fonctions admin fonctionnent (pause, resume, update)
- [ ] ✅ Pas d'erreurs de stack ou overflow
- [ ] ✅ Les événements sont correctement émis

## Étape 8 : Retour à Mainnet

Une fois les tests devnet réussis :

### 8.1 Restaurer la Configuration Mainnet

```bash
# Restaurer lib.rs original
cp programs/asdf-dat/src/lib.rs.mainnet.backup programs/asdf-dat/src/lib.rs

# Vérifier les constantes mainnet
grep "ASDF_MINT\|POOL_PUMPSWAP\|PUMP_SWAP_PROGRAM" programs/asdf-dat/src/lib.rs
```

### 8.2 Mettre à Jour Anchor.toml pour Mainnet

```toml
[provider]
cluster = "mainnet"
wallet = "./wallet.json"  # Votre wallet mainnet sécurisé

[programs.mainnet]
asdf_dat = "EJdSbSXMXQLp7WLqgVYjJ6a6BqMw6t8MzfavWQBZM6a2"
```

### 8.3 Build et Déploiement Final Mainnet

```bash
# Configurer mainnet
solana config set --url https://api.mainnet-beta.solana.com
solana config set --keypair ./wallet.json

# Build final
anchor build

# Déployer (ATTENTION : opération réelle)
anchor deploy --provider.cluster mainnet
```

## Résolution des Problèmes Courants

### Erreur : "Insufficient Fees"
- Vérifiez que des trades ont été effectués sur votre token
- Réduisez `MIN_FEES_TO_CLAIM` pour devnet

### Erreur : "Not Coin Creator"
- Assurez-vous d'avoir transféré le creator au DAT Authority
- Vérifiez que l'adresse du pool est correcte

### Erreur : "Cycle Too Soon"
- Attendez `MIN_CYCLE_INTERVAL` secondes entre les cycles
- Réduisez l'intervalle pour devnet (60s)

### Erreur de Slippage
- Augmentez `INITIAL_SLIPPAGE_BPS` dans le code
- Vérifiez qu'il y a suffisamment de liquidité dans le pool

## Ressources

- **Solana Devnet Faucet**: https://faucet.solana.com
- **Solana Explorer (Devnet)**: https://explorer.solana.com/?cluster=devnet
- **PumpFun Documentation**: [À ajouter selon disponibilité]
- **Anchor Documentation**: https://www.anchor-lang.com

## Support

Pour toute question sur le déploiement devnet :
- GitHub Issues : [Lien vers repo]
- Twitter : [@jeanterre13](https://twitter.com/jeanterre13)

---

**Note Importante** : Devnet est un environnement de test. Les tokens et SOL devnet n'ont aucune valeur. Ne déployez jamais sur mainnet sans avoir complètement testé sur devnet.
