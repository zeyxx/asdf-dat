# 🚀 Quick Start - Test Complet sur Devnet

Guide rapide pour tester le protocole ASDF DAT de A à Z sur Devnet.

## ⚡ En 4 Commandes

### 1️⃣ Build et Deploy
```bash
anchor build && anchor deploy --provider.cluster devnet
```

### 2️⃣ Initialiser le Protocole
```bash
npm run init
```
✅ Crée le DAT State et DAT Authority
✅ Génère `devnet-config.json`

### 3️⃣ Créer le Token PumpFun
```bash
npm run create-token
```
✅ Token avec DAT Authority comme creator
✅ Bonding curve active
✅ Génère `devnet-token-info.json`

### 4️⃣ Lancer le Test End-to-End
```bash
npm run test:e2e
```
✅ Crée 3 wallets de test
✅ Simule du trading pour générer des fees
✅ Exécute le cycle complet (collect → buy → burn)
✅ Affiche les statistiques

## 📊 Résultat Attendu

```
╔══════════════════════════════════════════════════════════╗
║     🧪 TEST END-TO-END - PROTOCOLE ASDF DAT DEVNET      ║
╚══════════════════════════════════════════════════════════╝

==========================================================
PHASE 1: SETUP DES WALLETS DE TEST
==========================================================

✨ Wallet 1 créé: AbC...123
💰 Airdrop de 2 SOL vers wallet 1...
✅ Airdrop réussi pour wallet 1

... (wallets 2 et 3)

==========================================================
PHASE 2: SIMULATION DE TRADING
==========================================================

🔄 Simulation d'achats pour générer des fees...

🛒 Wallet 1 achète ~1M tokens...
✅ Trade 1 réussi
🛒 Wallet 2 achète ~1M tokens...
✅ Trade 2 réussi
🛒 Wallet 3 achète ~1M tokens...
✅ Trade 3 réussi

💼 Creator Vault balance final: 0.0234 SOL
💰 Fees générées: 0.0234 SOL
📈 Trades réussis: 3/3

==========================================================
PHASE 3: EXÉCUTION DU CYCLE DAT
==========================================================

💰 Étape 1/3: Collecte des fees...
✅ Fees collectées | TX: 5a3b2c...
💼 DAT WSOL balance: 0.0234 SOL

🛒 Étape 2/3: Achat de tokens...
✅ Tokens achetés | TX: 7d4e5f...
🪙 DAT token balance: 123456.78 tokens

🔥 Étape 3/3: Burn des tokens...
✅ Tokens brûlés | TX: 9g6h7i...

🎉 Cycle DAT complété avec succès!

==========================================================
PHASE 4: STATISTIQUES FINALES
==========================================================

╔════════════════════════════════════════════════╗
║          📊 STATISTIQUES DU PROTOCOLE          ║
╚════════════════════════════════════════════════╝

État du Protocole:
  ✅ Actif: true
  🚨 Pause d'urgence: false

Statistiques Globales:
  🔥 Total brûlé: 123,456.78 tokens
  💰 Total SOL collecté: 0.0234 SOL
  🔄 Total de cycles: 1
  ❌ Cycles échoués: 0

Dernier Cycle:
  🪙 Tokens brûlés: 123,456.78
  💵 SOL utilisé: 0.0234
  ⏰ Timestamp: 2025-11-22T10:30:00.000Z

==========================================================
✅ TEST TERMINÉ AVEC SUCCÈS!
==========================================================
```

## 🔄 Relancer un Test

Si tout est déjà setup:
```bash
npm run test:e2e
```

## 🤖 Bot Automatique

Après un test réussi, lancez le bot pour des cycles automatiques:
```bash
npm run bot
```

Le bot exécutera automatiquement un cycle toutes les heures.

## 🛠️ Commandes Utiles

### Vérifier l'état
```bash
# Voir les comptes créés
ls -la test-wallets/

# Voir la config
cat devnet-config.json
cat devnet-token-info.json

# Balance du DAT Authority
solana balance <DAT_AUTHORITY> --url devnet
```

### Reset Complet
```bash
# Supprimer les fichiers
rm -rf test-wallets/ devnet-config.json devnet-token-info.json

# Recommencer
npm run init
npm run create-token
npm run test:e2e
```

## 📋 Checklist

Avant de lancer le test, vérifiez:

- [ ] `anchor build` a réussi
- [ ] Le programme est déployé sur devnet
- [ ] `devnet-wallet.json` existe (wallet admin)
- [ ] Le wallet admin a du SOL devnet
- [ ] `target/idl/asdf_dat.json` existe

## ⚠️ Troubleshooting

### "IDL non trouvé"
```bash
anchor build
```

### "Wallet non trouvé"
Créez un wallet:
```bash
solana-keygen new --outfile devnet-wallet.json
solana airdrop 2 <PUBKEY> --url devnet
```

### "Config non trouvée"
Initialisez d'abord:
```bash
npm run init
```

### "Token info non trouvé"
Créez le token d'abord:
```bash
npm run create-token
```

### "Airdrop failed"
Le faucet devnet peut être lent. Réessayez ou utilisez:
```bash
# Faucet web
https://faucet.solana.com/
```

### "InsufficientFees"
Pas assez de fees générées. Options:
1. Augmenter `NUM_TEST_WALLETS` dans le script
2. Augmenter `SOL_PER_TRADE`
3. Faire plusieurs passes de trading

## 📚 Documentation Complète

Pour plus de détails, consultez:
- `TEST_E2E_README.md` - Documentation complète du test
- `README.md` - Documentation générale du projet
- `QUICK_START_DEVNET.md` - Guide devnet détaillé

## 🎯 Prochaines Étapes

1. ✅ Tester en local avec le script e2e
2. 🔄 Lancer le bot pour des cycles réguliers
3. 📊 Monitorer les statistiques
4. ⚙️ Ajuster les paramètres si nécessaire
5. 🚀 Préparer le déploiement mainnet

---

**Happy Testing! 🎉**
