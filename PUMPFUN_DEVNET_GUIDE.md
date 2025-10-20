# Guide : Créer un Token sur PumpFun Devnet

Ce guide explique comment créer un token de test sur PumpFun devnet pour tester le protocole ASDF DAT.

## Option 1 : Interface PumpFun Devnet (Si Disponible)

### Prérequis
- Wallet Solana configuré pour devnet (Phantom, Solflare, etc.)
- SOL devnet (obtenu via `solana airdrop`)

### Étapes

1. **Obtenir du SOL Devnet**
   ```bash
   solana config set --url https://api.devnet.solana.com
   solana airdrop 2
   ```

2. **Accéder à PumpFun Devnet**
   - URL : https://devnet.pump.fun (vérifier avec la documentation officielle)
   - Ou utiliser l'interface avec le paramètre `?cluster=devnet`

3. **Connecter votre Wallet**
   - Assurez-vous que votre wallet est sur devnet
   - Connectez-vous à l'application

4. **Créer le Token**
   - Cliquez sur "Create Token" ou "Launch Token"
   - Remplissez les informations :
     ```
     Name: ASDF Test
     Symbol: ASDFT
     Description: Token de test pour le protocole ASDF DAT
     Supply: 1,000,000,000
     Image: [Optionnel]
     ```

5. **Configurer le Pool Initial**
   - Ajouter de la liquidité initiale (ex: 1 SOL)
   - Créer le pool

6. **Noter les Adresses Importantes**
   Après création, sauvegardez :
   ```
   Token Mint: [ADRESSE_DU_TOKEN]
   Pool Address: [ADRESSE_DE_LA_POOL]
   Creator: [VOTRE_WALLET]
   ```

## Option 2 : Via SDK/CLI PumpSwap (Programmation)

Si PumpFun fournit un SDK pour devnet :

```typescript
import { PumpFun } from '@pumpfun/sdk';  // Exemple hypothétique
import { Connection, Keypair } from '@solana/web3.js';

async function createDevnetToken() {
  const connection = new Connection('https://api.devnet.solana.com');
  const wallet = Keypair.fromSecretKey(/* votre clé */);

  const pumpfun = new PumpFun(connection, wallet, { cluster: 'devnet' });

  const token = await pumpfun.createToken({
    name: 'ASDF Test',
    symbol: 'ASDFT',
    decimals: 6,
    supply: 1_000_000_000,
    initialLiquidity: 1000000000, // 1 SOL en lamports
  });

  console.log('Token créé:', token.mint.toString());
  console.log('Pool créée:', token.pool.toString());

  return token;
}
```

## Option 3 : Créer un Token SPL Standard (Fallback)

Si PumpFun devnet n'est pas disponible, créez un token SPL standard pour tester la logique de base :

### 3.1 Installer spl-token CLI
```bash
cargo install spl-token-cli
```

### 3.2 Créer le Token
```bash
# Configurer devnet
solana config set --url https://api.devnet.solana.com

# Créer le token mint
spl-token create-token --decimals 6

# Sauvegarder l'adresse du token
TOKEN_MINT="[ADRESSE_RETOURNÉE]"

# Créer un compte de tokens pour vous
spl-token create-account $TOKEN_MINT

# Mint des tokens
spl-token mint $TOKEN_MINT 1000000000

# Vérifier
spl-token supply $TOKEN_MINT
```

### 3.3 Créer une Pool Manuelle (Avancé)

Pour simuler un pool PumpSwap, vous pouvez :

1. **Utiliser Raydium Devnet**
   ```
   https://raydium.io/?cluster=devnet
   ```

2. **Ou créer une pool Orca Devnet**
   ```
   https://www.orca.so/?network=devnet
   ```

## Étape Suivante : Configurer DAT pour Votre Token

Une fois votre token créé, mettez à jour les constantes dans `programs/asdf-dat/src/lib.rs` :

```rust
pub const ASDF_MINT: Pubkey = solana_program::pubkey!("VOTRE_TOKEN_MINT");
pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!("VOTRE_POOL_ADDRESS");
```

## Obtenir les Adresses PumpSwap Devnet

### Via Solana Explorer

1. Trouvez une transaction PumpSwap sur devnet
2. Identifiez les program IDs utilisés
3. Notez les adresses

### Via Documentation Officielle

Consultez :
- Documentation PumpFun : https://docs.pump.fun
- Documentation PumpSwap : [Lien officiel]
- Discord/Support PumpFun pour adresses devnet

### Adresses Typiques (À Vérifier)

```typescript
// ATTENTION: Ces adresses sont à titre d'exemple, vérifiez avec la doc officielle
const DEVNET_ADDRESSES = {
  PUMP_SWAP_PROGRAM: "pAMM...[devnet]",
  FEE_PROGRAM: "pfee...[devnet]",
  WSOL_MINT: "So11111111111111111111111111111111111111112", // Même partout
  TOKEN_2022_PROGRAM: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Même partout
};
```

## Transférer la Propriété Creator

**CRITIQUE** : Pour que DAT puisse collecter les frais, vous devez transférer le `coin_creator` :

### Via Interface PumpFun

1. Accédez aux paramètres de votre token
2. Trouvez "Transfer Creator" ou "Manage Creator"
3. Entrez l'adresse du DAT Authority PDA
4. Confirmez la transaction

### Via Programme

```typescript
import { PumpFun } from '@pumpfun/sdk';

async function transferCreator() {
  const pumpfun = new PumpFun(connection, wallet);

  // DAT Authority PDA dérivé de votre programme
  const datAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("dat-authority")],
    programId
  )[0];

  await pumpfun.transferCreator({
    pool: poolAddress,
    newCreator: datAuthority,
  });

  console.log('Creator transféré à:', datAuthority.toString());
}
```

## Générer de l'Activité de Trading

Pour accumuler des frais dans la creator vault :

### Via Interface
1. Connectez un autre wallet
2. Effectuez des swaps (achats et ventes)
3. Les frais s'accumulent automatiquement

### Via Script
```typescript
import { PumpFun } from '@pumpfun/sdk';

async function generateTrades() {
  for (let i = 0; i < 10; i++) {
    // Buy
    await pumpfun.buy({
      pool: poolAddress,
      amount: 0.1 * 1e9, // 0.1 SOL
      slippage: 1,
    });

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Sell half
    await pumpfun.sell({
      pool: poolAddress,
      tokenAmount: 1000,
      slippage: 1,
    });
  }
}
```

## Vérifier l'Accumulation des Frais

```bash
# Trouver l'adresse de la creator vault
# C'est un ATA de WSOL appartenant au creator vault authority PDA

# Vérifier le solde
spl-token accounts So11111111111111111111111111111111111111112 \
  --owner [CREATOR_VAULT_AUTHORITY]
```

Ou via script :
```typescript
const creatorVaultAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from("creator_vault"), datAuthority.toBuffer()],
  PUMP_SWAP_PROGRAM
)[0];

const creatorVault = await getAssociatedTokenAddress(
  WSOL_MINT,
  creatorVaultAuthority,
  true
);

const balance = await connection.getTokenAccountBalance(creatorVault);
console.log('Fees disponibles:', balance.value.uiAmount, 'SOL');
```

## Ressources

### Documentation Officielle
- **PumpFun Docs** : https://docs.pump.fun
- **Solana Devnet** : https://docs.solana.com/clusters#devnet
- **SPL Token** : https://spl.solana.com/token

### Outils
- **Solana Explorer (Devnet)** : https://explorer.solana.com/?cluster=devnet
- **Solana Faucet** : https://faucet.solana.com
- **spl-token CLI** : https://spl.solana.com/token#command-line-utility

### Support
- **PumpFun Discord** : [Lien Discord]
- **PumpFun Twitter** : @pumpfun (si disponible)

## Dépannage

### "PumpFun devnet non disponible"
- Utilisez un token SPL standard pour tester la logique
- Contactez le support PumpFun pour accès devnet
- Testez sur localnet avec un fork

### "Cannot find pool address"
- Vérifiez que le pool a été créé avec succès
- Utilisez Solana Explorer pour trouver les comptes du token
- Le pool est généralement un PDA dérivé du mint

### "Insufficient fees"
- Générez plus d'activité de trading
- Réduisez MIN_FEES_TO_CLAIM dans le code pour devnet
- Vérifiez que les frais s'accumulent dans la creator vault

## Checklist de Création

- [ ] ✅ SOL devnet obtenu (minimum 5 SOL)
- [ ] ✅ Token créé sur PumpFun devnet (ou SPL)
- [ ] ✅ Pool initialisé avec liquidité
- [ ] ✅ Adresses notées (mint, pool, programmes)
- [ ] ✅ Constantes mises à jour dans lib.rs
- [ ] ✅ Programme déployé sur devnet
- [ ] ✅ DAT initialisé
- [ ] ✅ Propriété creator transférée à DAT Authority
- [ ] ✅ Activité de trading générée
- [ ] ✅ Frais accumulés vérifiés
- [ ] ✅ Premier cycle exécuté avec succès

---

Une fois tous ces points complétés, vous êtes prêt à tester complètement le protocole ASDF DAT sur devnet avant le déploiement mainnet ! 🚀
