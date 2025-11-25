# 🔥 Guide de Lancement Mayhem Mode

## ✅ Ce Qui Est Prêt

- [x] Programme Rust compilé avec support Mayhem Mode
- [x] Fonction `create_pumpfun_token_mayhem` implémentée
- [x] Struct `CreatePumpfunTokenMayhem` avec tous les comptes
- [x] Script TypeScript `launch-mayhem-token.ts`
- [x] Constantes et discriminator `create_v2`

## 🚀 Comment Lancer Ton Token Mayhem

### Étape 1: Préparation

**1.1 Créer une image pour ton token**
```bash
# Place ton image dans le dossier racine
cp /path/to/your/image.png token-image.png
```

**1.2 Uploader les métadonnées**

Tu dois uploader ton image et métadonnées sur IPFS ou Arweave. Options :
- [NFT.Storage](https://nft.storage) (gratuit)
- [Pinata](https://pinata.cloud)
- [Arweave](https://www.arweave.org)

**1.3 Modifier le script**

Édite `scripts/launch-mayhem-token.ts` ligne 23-30 :
```typescript
const TOKEN_METADATA = {
  name: "Ton Nom de Token",      // ← CHANGE
  symbol: "SYMBOL",               // ← CHANGE
  description: "Ta description",  // ← CHANGE
  twitter: "https://twitter.com/...",  // ← CHANGE
  telegram: "https://t.me/...",   // ← CHANGE
  website: "https://...",         // ← CHANGE
  image: "./token-image.png",     // Path vers ton image
};
```

**1.4 Mettre l'URI de métadonnées**

Après upload, modifie la fonction `uploadMetadata` ligne 97 pour retourner ton URI :
```typescript
return "https://ipfs.io/ipfs/TON_CID_ICI"; // ← TON URI
```

### Étape 2: Vérification Wallet

**Mainnet (REAL SOL!):**
```bash
# Créer wallet mainnet
solana-keygen new -o mainnet-wallet.json

# Transférer SOL
solana transfer <ADDRESS> 0.5 --url mainnet-beta

# Vérifier balance
solana balance mainnet-wallet.json --url mainnet-beta
```

**Besoin:** Au moins **0.2-0.5 SOL** pour :
- Frais de création token
- Rent exemption pour comptes
- Frais de transaction

### Étape 3: Configuration DAT

**3.1 Vérifier que DAT est initialisé sur mainnet**

Vérifie `config/mainnet-dat-deployment.json` existe.

Si pas :
```bash
# Initialiser DAT sur mainnet
NETWORK=mainnet npm run init
```

**3.2 Vérifier les addresses**
```json
{
  "datState": "...",
  "datAuthority": "...",
  "admin": "...",
  ...
}
```

### Étape 4: Lancement ! 🚀

**⚠️ CRITICAL: Désactiver TESTING_MODE pour mainnet**

Avant de compiler, édite `programs/asdf-dat/src/lib.rs` ligne 59 :
```rust
// Change de true à false !
pub const TESTING_MODE: bool = false;  // ← DOIT ÊTRE FALSE POUR MAINNET
```

Pourquoi ? TESTING_MODE désactive les contraintes de sécurité (intervalles, limites AM/PM, seuils de fees).

```bash
# Compiler le programme (si pas déjà fait)
anchor build

# Installer les dépendances
npm install

# LANCER LE TOKEN MAYHEM !
npx ts-node scripts/launch-mayhem-token.ts
```

### Étape 5: Post-Lancement

**Immédiatement après:**
1. ✅ Sauvegarde le fichier `mainnet-mayhem-token-info.json`
2. ✅ Note le mint address
3. ✅ Vérifie la transaction sur Solscan
4. ✅ Vérifie que l'AI agent commence à trader

**Dans les 24h:**
- 🤖 L'AI agent va trader automatiquement
- 📊 Volume et liquidité vont augmenter
- 💰 Fees vont s'accumuler dans le creator vault

**Après 24h:**
- 🔥 Agent brûle les tokens restants
- ✅ Creator vault a des fees collectées
- 🔄 DAT peut commencer les cycles buyback-and-burn

## 📊 Différences Mayhem vs Normal

| Aspect | Normal | Mayhem |
|--------|--------|--------|
| Supply | 1B tokens | **2B tokens** |
| AI Trading | ❌ | ✅ **24h auto** |
| Initial Volume | Dépend traders | **Garanti par AI** |
| Creator Vault | Créé au 1er trade | **Créé immédiatement** |
| Token Program | Token | **Token2022** |
| Risque | Standard | **Plus volatile** |

## ⚠️ Points Importants

### Sécurité
- ✅ **CRITICAL: Set `TESTING_MODE = false` dans lib.rs avant build mainnet**
- ✅ Garde `mainnet-wallet.json` en sécurité (JAMAIS commit!)
- ✅ Backup tous les fichiers importants
- ✅ Teste d'abord sur devnet si possible (mode normal uniquement)

### Coûts
- 💰 Création token: ~0.02-0.05 SOL
- 💰 Rent exemption: ~0.01 SOL
- 💰 Transaction fees: ~0.00002 SOL
- 💰 **Total estimé: ~0.1 SOL**

### Mayhem Spécifique
- ⚠️ L'AI agent va acheter/vendre pendant 24h
- ⚠️ Volume peut être très variable
- ⚠️ Prix va fluctuer (c'est normal!)
- ✅ Fees garanties grâce au trading AI

## 🔍 Monitoring

**Pendant les 24h de Mayhem:**

```bash
# Vérifier le creator vault
npx ts-node scripts/init-creator-vault.ts

# Voir les transactions
# https://solscan.io/token/TON_MINT_ADDRESS

# Monitor PumpFun
# https://pump.fun/TOKEN_ADDRESS
```

## 🆘 Troubleshooting

### "Insufficient balance"
- Ajoute plus de SOL au wallet (0.5 SOL recommandé)

### "Account not initialized"
- Vérifie que DAT est initialisé sur mainnet
- Run: `NETWORK=mainnet npm run init`

### "Invalid PDA"
- Vérifie que toutes les addresses sont correctes
- Vérifie le network (mainnet vs devnet)

### "Transaction failed"
- Check les logs dans la console
- Vérifie que tu as assez de SOL
- Vérifie que le mint n'existe pas déjà

## 📞 Support

Si problèmes :
1. Check les logs d'erreur
2. Vérifie la transaction sur Solscan
3. Vérifie que tous les comptes existent
4. Vérifie la balance SOL

## 🎯 Checklist Pré-Lancement

- [ ] **🔴 TESTING_MODE mis à `false` dans lib.rs (ligne 59)**
- [ ] Image du token prête
- [ ] Métadonnées uploadées (IPFS/Arweave)
- [ ] URI de métadonnées mis à jour dans le script
- [ ] Wallet mainnet créé avec 0.5+ SOL
- [ ] DAT initialisé sur mainnet
- [ ] Script modifié avec tes infos
- [ ] Programme compilé (`anchor build`)
- [ ] Dependencies installées (`npm install`)
- [ ] Backup de tous les fichiers importants
- [ ] Plan de communication prêt (Twitter, Telegram, etc.)

## 🚀 Go Time!

Quand tout est ✅ :

```bash
npx ts-node scripts/launch-mayhem-token.ts
```

**Bonne chance ! 🔥🚀**
