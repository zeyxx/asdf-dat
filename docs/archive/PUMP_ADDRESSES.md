# Adresses Officielles PumpFun / PumpSwap

Ce document liste toutes les adresses officielles du programme PumpFun qui sont **identiques sur devnet et mainnet**.

## 🔑 Adresses de Programme (Devnet & Mainnet)

### Programmes Principaux

| Programme | Adresse | Usage |
|-----------|---------|-------|
| **Pump Program** | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Programme principal de création de tokens |
| **Pump Global Config** | `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf` | Configuration globale |
| **Event Authority** | `Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1` | Autorité pour les événements |
| **Fee Recipient** | `CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM` | Destinataire des frais |

### Programmes Standard Solana

| Programme | Adresse | Usage |
|-----------|---------|-------|
| **WSOL** | `So11111111111111111111111111111111111111112` | Wrapped SOL (identique partout) |
| **Token Program** | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | SPL Token |
| **Token-2022** | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Token Extensions |
| **Associated Token** | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | ATA Program |
| **Metadata Program** | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | Metaplex Token Metadata |

## 📝 Utilisation dans le Code

### Pour lib.rs

```rust
// Adresses PumpFun (identiques devnet/mainnet)
pub const PUMP_PROGRAM: Pubkey =
    solana_program::pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

pub const PUMP_GLOBAL: Pubkey =
    solana_program::pubkey!("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");

pub const PUMP_EVENT_AUTHORITY: Pubkey =
    solana_program::pubkey!("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");

pub const WSOL_MINT: Pubkey =
    solana_program::pubkey!("So11111111111111111111111111111111111111112");

// Programmes standard
pub const TOKEN_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

pub const METADATA_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
```

### Pour TypeScript

```typescript
import { PublicKey } from "@solana/web3.js";

const PUMP_ADDRESSES = {
  PUMP_PROGRAM: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
  PUMP_GLOBAL: new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"),
  PUMP_EVENT_AUTHORITY: new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"),
  FEE_RECIPIENT: new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"),
  WSOL: new PublicKey("So11111111111111111111111111111111111111112"),
};
```

## 🔍 Différences Devnet vs Mainnet

### Ce qui est IDENTIQUE ✅

- ✅ Adresses de programme PumpFun
- ✅ Adresses des programmes SPL standard
- ✅ Structure des PDAs
- ✅ Format des instructions
- ✅ Seeds pour dérivation

### Ce qui est DIFFÉRENT ⚠️

- ⚠️ **Token Mints** : Votre token de test devnet aura une adresse différente
- ⚠️ **Bonding Curves** : Chaque token a sa propre bonding curve (PDA)
- ⚠️ **Comptes utilisateur** : Token accounts, wallets, etc.
- ⚠️ **État du réseau** : Données on-chain différentes

## 📋 PDAs (Program Derived Addresses)

### Bonding Curve

```rust
// PDA pour la bonding curve d'un token
seeds = [
    b"bonding-curve",
    mint.key().as_ref()
]
program_id = PUMP_PROGRAM
```

### Associated Bonding Curve

```typescript
// ATA de la bonding curve (détient les tokens)
const bondingCurve = PublicKey.findProgramAddressSync(
  [Buffer.from("bonding-curve"), mint.toBuffer()],
  PUMP_PROGRAM
)[0];

const associatedBondingCurve = await getAssociatedTokenAddress(
  mint,
  bondingCurve,
  true // allowOwnerOffCurve
);
```

### Metadata

```rust
// PDA pour les métadonnées du token
seeds = [
    b"metadata",
    METADATA_PROGRAM_ID.as_ref(),
    mint.key().as_ref()
]
program_id = METADATA_PROGRAM_ID
```

## 🛠️ Instructions PumpFun

### Create Token

```rust
// Discriminator pour l'instruction "create"
const CREATE_DISCRIMINATOR: [u8; 8] = [0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77];

// Comptes requis pour create
pub struct Create {
    pub mint: Signer,                    // Nouveau mint (keypair)
    pub mint_authority: AccountInfo,     // PDA: bonding curve
    pub bonding_curve: AccountInfo,      // PDA: bonding curve
    pub associated_bonding_curve: AccountInfo, // ATA de bonding curve
    pub metadata: AccountInfo,           // PDA: metadata
    pub user: Signer,                    // Créateur
    pub system_program: AccountInfo,
    pub token_program: AccountInfo,
    pub associated_token_program: AccountInfo,
    pub rent: AccountInfo,
    pub event_authority: AccountInfo,
    pub program: AccountInfo,
}
```

### Buy

```rust
// Discriminator pour l'instruction "buy"
const BUY_DISCRIMINATOR: [u8; 8] = [0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea];

// Paramètres
pub struct BuyParams {
    pub amount: u64,           // Montant de SOL à dépenser
    pub max_sol_cost: u64,     // Coût max en SOL (slippage)
}
```

### Sell

```rust
// Discriminator pour l'instruction "sell"
const SELL_DISCRIMINATOR: [u8; 8] = [0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad];

// Paramètres
pub struct SellParams {
    pub amount: u64,           // Nombre de tokens à vendre
    pub min_sol_output: u64,   // SOL minimum à recevoir (slippage)
}
```

## 🔗 Liens Utiles

### Documentation Officielle

- **PumpFun Website** : https://pump.fun
- **PumpFun Docs** : https://docs.pump.fun (si disponible)
- **Solana Explorer** : https://explorer.solana.com

### Vérifier les Adresses

```bash
# Vérifier qu'un programme existe sur devnet
solana program show 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P --url devnet

# Vérifier sur mainnet
solana program show 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P --url mainnet-beta
```

### Explorer les Transactions

Pour comprendre le format exact des instructions :

1. Trouvez une transaction PumpFun réussie sur Explorer
2. Examinez les instructions et données
3. Utilisez comme référence pour votre implémentation

**Exemple de transaction de création** :
```
https://explorer.solana.com/tx/[SIGNATURE]?cluster=devnet
```

## ⚠️ Notes Importantes

### Sécurité

- ✅ Ces adresses sont publiques et vérifiables
- ✅ Toujours vérifier via Solana Explorer
- ✅ Ne jamais envoyer de SOL/tokens à des adresses non vérifiées

### Changements de Version

- PumpFun peut déployer de nouvelles versions du programme
- Vérifiez toujours les adresses officielles avant utilisation
- Suivez les annonces officielles pour les mises à jour

### Support

Si les adresses ou instructions changent :

1. Consultez la documentation officielle PumpFun
2. Vérifiez les transactions récentes sur Explorer
3. Contactez le support PumpFun si nécessaire

## 📊 Résumé pour ASDF DAT

Pour le protocole ASDF DAT :

### Devnet
```rust
// Même adresses de programme que mainnet
pub const PUMP_PROGRAM: Pubkey = solana_program::pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// SEULEMENT ces adresses changent :
pub const ASDF_MINT: Pubkey = solana_program::pubkey!("[VOTRE_TOKEN_DEVNET]");
pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!("[BONDING_CURVE_DEVNET]");
```

### Mainnet
```rust
// Même adresses de programme
pub const PUMP_PROGRAM: Pubkey = solana_program::pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// Adresses de production :
pub const ASDF_MINT: Pubkey = solana_program::pubkey!("9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump");
pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!("DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb");
```

---

**Dernière mise à jour** : 2025-01-20

**Source** : Adresses vérifiées via transactions PumpFun sur Solana Explorer

**Statut** : ✅ Vérifié et actif sur devnet et mainnet
