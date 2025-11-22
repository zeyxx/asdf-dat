# 🧪 Test End-to-End - ASDF DAT Protocol

Script de test complet pour valider le protocole ASDF DAT en conditions réelles sur Devnet.

## 📋 Prérequis

### 1. Build du programme
```bash
anchor build
```

### 2. Déploiement (si pas déjà fait)
```bash
anchor deploy --provider.cluster devnet
```

### 3. Initialisation du protocole
```bash
npm run ts-node scripts/devnet-init-v3.ts
```
Crée:
- ✅ DAT State PDA
- ✅ DAT Authority PDA
- ✅ Fichier `devnet-config.json`

### 4. Création du token PumpFun
```bash
npm run ts-node scripts/create-token-final.ts
```
Crée:
- ✅ Token avec DAT Authority comme creator
- ✅ Bonding curve active
- ✅ Fichier `devnet-token-info.json`

## 🚀 Lancement du Test

### Commande simple
```bash
npm run test:e2e
```

### Ou avec ts-node
```bash
npm run ts-node scripts/test-end-to-end.ts
```

## 📊 Ce que fait le script

### Phase 1: Setup des Wallets de Test
- ✅ Crée 3 wallets de test (ou les charge s'ils existent)
- ✅ Fait un airdrop de 2 SOL par wallet
- ✅ Sauvegarde les wallets dans `./test-wallets/`

### Phase 2: Simulation de Trading
- ✅ Chaque wallet achète des tokens sur PumpSwap
- ✅ Génère ~0.5-1.5 SOL de volume de trading
- ✅ Accumule des fees dans la Creator Vault
- ✅ Affiche les fees générées

### Phase 3: Exécution du Cycle DAT

#### Étape 1: Collect Fees
- Collecte les fees depuis la Creator Vault PumpFun
- Transfère vers le DAT WSOL Account
- Vérifie le montant collecté

#### Étape 2: Execute Buy
- Achète des tokens ASDF avec les SOL collectés
- Protection slippage (5%)
- Maximum 1% des réserves du pool
- Stocke les tokens dans pending_burn_amount

#### Étape 3: Burn and Update
- Brûle tous les tokens achetés
- Met à jour les statistiques globales
- Émet l'événement CycleCompleted

### Phase 4: Rapport Final
- 📊 État du protocole (actif, pause)
- 🔥 Total tokens brûlés
- 💰 Total SOL collecté
- 🔄 Nombre de cycles complétés
- ⚙️ Paramètres actuels

## 📁 Fichiers Générés

```
project/
├── devnet-config.json              # Config du protocole DAT
├── devnet-token-info.json          # Info du token créé
└── test-wallets/                   # Wallets de test
    ├── test-wallet-0.json
    ├── test-wallet-1.json
    └── test-wallet-2.json
```

## 🎯 Résultats Attendus

### ✅ Succès
```
╔════════════════════════════════════════════════╗
║          📊 STATISTIQUES DU PROTOCOLE          ║
╚════════════════════════════════════════════════╝

État du Protocole:
  ✅ Actif: true
  🚨 Pause d'urgence: false
  👤 Admin: 9Uopf...

Statistiques Globales:
  🔥 Total brûlé: 1,234,567.89 tokens
  💰 Total SOL collecté: 0.0123 SOL
  🔄 Total de cycles: 1
  ❌ Cycles échoués: 0
  ⚠️  Échecs consécutifs: 0
```

### ⚠️ Erreurs Possibles

#### "InsufficientFees"
**Cause**: Pas assez de fees dans la Creator Vault (min: 0.01 SOL)

**Solution**:
- Vérifier que les trades ont bien généré des fees
- Augmenter le nombre de wallets ou le montant par trade
- Modifier `NUM_TEST_WALLETS` ou `SOL_PER_TRADE` dans le script

#### "AlreadyExecutedThisPeriod"
**Cause**: Un cycle a déjà été exécuté durant cette période (AM/PM)

**Solution**:
- Attendre la prochaine période (matin ou après-midi)
- Ou modifier `MIN_CYCLE_INTERVAL` avec `update_parameters`

#### "CycleTooSoon"
**Cause**: Moins de 60s depuis le dernier cycle

**Solution**:
- Attendre 60 secondes
- Le script inclut déjà une pause de 5s, mais peut ne pas suffire

## 🔧 Configuration

### Modifier les Paramètres de Test

Dans `scripts/test-end-to-end.ts`:

```typescript
const NUM_TEST_WALLETS = 3;     // Nombre de wallets de test
const SOL_PER_WALLET = 2;        // SOL par wallet (airdrop)
const SOL_PER_TRADE = 0.5;       // SOL par trade
```

### Modifier les Paramètres du Protocole

Utilisez le script d'update:
```typescript
await program.methods
  .updateParameters(
    new anchor.BN(0.01 * LAMPORTS_PER_SOL),  // min_fees_threshold
    new anchor.BN(1 * LAMPORTS_PER_SOL),      // max_fees_per_cycle
    500,                                       // slippage_bps (5%)
    60                                         // min_cycle_interval (60s)
  )
  .accounts({
    datState,
    admin: admin.publicKey,
  })
  .signers([admin])
  .rpc();
```

## 📊 Monitoring en Temps Réel

### Vérifier le Creator Vault
```bash
npm run ts-node scripts/find-creator-vault.ts
```

### Vérifier l'état du DAT
```bash
solana account <DAT_STATE_PUBKEY> --url devnet
```

### Explorer les transactions
Chaque étape affiche un lien vers Solana Explorer:
```
https://explorer.solana.com/tx/<SIGNATURE>?cluster=devnet
```

## 🐛 Debug

### Activer les logs détaillés
```typescript
// Dans le script, avant l'exécution
console.log = console.debug;
```

### Vérifier les comptes
```bash
# Vérifier le DAT Authority balance
solana balance <DAT_AUTHORITY> --url devnet

# Vérifier les ATAs
spl-token accounts --owner <DAT_AUTHORITY> --url devnet
```

## 🔄 Reset Complet

Si vous voulez tout recommencer:

```bash
# 1. Supprimer les fichiers de config
rm devnet-config.json devnet-token-info.json

# 2. Supprimer les wallets de test
rm -rf test-wallets/

# 3. Redéployer le programme
anchor build
anchor deploy --provider.cluster devnet

# 4. Réinitialiser
npm run ts-node scripts/devnet-init-v3.ts
npm run ts-node scripts/create-token-final.ts

# 5. Relancer le test
npm run test:e2e
```

## 📈 Métriques de Succès

Pour un test réussi, vous devez voir:

✅ **Phase 1**: 3 wallets créés avec 2 SOL chacun
✅ **Phase 2**: Au moins 1 trade réussi générant > 0.01 SOL de fees
✅ **Phase 3**:
  - Collect fees: SOL transféré vers DAT Authority
  - Execute buy: Tokens achetés et stockés
  - Burn: Tokens brûlés avec succès
✅ **Phase 4**: Stats mises à jour avec:
  - `total_buybacks` > 0
  - `total_burned` > 0
  - `total_sol_collected` > 0

## 🎯 Prochaines Étapes

Après un test réussi:

1. **Bot automatique**: Utilisez `scripts/devnet-bot-v2-fixed.ts` pour des cycles automatiques
2. **Monitoring**: Configurez un dashboard pour suivre les stats
3. **Optimisation**: Ajustez les paramètres selon les résultats
4. **Mainnet**: Préparez le déploiement en production

## 💡 Conseils

- **Devnet Airdrop**: Le faucet devnet peut être lent, soyez patient
- **Fees PumpFun**: Les fees dépendent du market cap (0.3%-1.25%)
- **Slippage**: 5% est suffisant pour devnet, ajustez si nécessaire
- **Monitoring**: Gardez un œil sur les logs pour comprendre le flow

## 📞 Support

Si vous rencontrez des problèmes:

1. Vérifiez que tous les prérequis sont remplis
2. Consultez les logs d'erreur pour des messages spécifiques
3. Vérifiez que le programme est bien déployé sur devnet
4. Assurez-vous que les fichiers de config existent

---

**Bonne chance avec vos tests! 🚀**
