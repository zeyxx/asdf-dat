# 🚀 Quick Start - Devnet Setup (5 Minutes)

Guide ultra-rapide pour tester ASDF DAT sur devnet avec création automatique du token.

## Prérequis (1 min)

```bash
# 1. Configurer Solana pour devnet
solana config set --url https://api.devnet.solana.com

# 2. Créer ou utiliser un wallet devnet
solana-keygen new -o devnet-wallet.json  # Ou utilisez un existant
solana config set --keypair ./devnet-wallet.json

# 3. Obtenir du SOL devnet
solana airdrop 2
solana airdrop 2

# 4. Vérifier
solana balance  # Devrait afficher ~4 SOL
```

## Setup Automatique (3 min)

### Option 1 : Setup Complet Automatisé (Recommandé)

```bash
# Lance le wizard interactif qui fait tout
ts-node scripts/devnet-full-setup.ts
```

Le wizard va :
- ✅ Créer votre token sur PumpFun devnet
- ✅ Configurer lib.rs automatiquement
- ✅ Build et deploy le programme
- ✅ Initialiser le protocole
- ✅ Setup les token accounts

**Suivez simplement les instructions à l'écran !**

### Option 2 : Étape par Étape (Manuel)

Si vous préférez contrôler chaque étape :

```bash
# 1. Créer le token sur PumpFun devnet
ts-node scripts/devnet-create-token.ts
# ✅ Crée: devnet-token-info.json, devnet-config.json

# 2. Appliquer la config au code
ts-node scripts/devnet-apply-config.ts
# ✅ Met à jour lib.rs et Anchor.toml automatiquement

# 3. Build
anchor build

# 4. Copier le program ID affiché et mettre à jour :
#    - lib.rs : declare_id!("PROGRAM_ID")
#    - Anchor.toml : [programs.devnet] asdf_dat = "PROGRAM_ID"

# 5. Rebuild
anchor build

# 6. Deploy
anchor deploy --provider.cluster devnet

# 7. Setup accounts (optionnel, souvent fait auto)
ts-node scripts/devnet-setup-accounts.ts

# 8. Initialiser
ts-node scripts/devnet-init.ts

# 9. Vérifier
ts-node scripts/devnet-status.ts
```

## Test (1 min)

```bash
# Vérifier le statut du protocole
ts-node scripts/devnet-status.ts
```

Vous devriez voir :
```
📊 ASDF DAT Protocol Status (Devnet)
================================
  Is Active: ✅ Yes
  Total Buybacks: 0

NEXT CYCLE ELIGIBILITY
  ✅ Ready to execute first cycle
```

## Générer de l'Activité

Le protocole a besoin de frais creator pour fonctionner :

### Option A : Via Interface PumpFun

1. Allez sur https://pump.fun (mode devnet)
2. Trouvez votre token (utilisez la mint address)
3. Faites quelques trades (buy/sell)
4. Les frais s'accumulent automatiquement

### Option B : Via Script (À venir)

```bash
# Script pour générer des trades automatiquement
# ts-node scripts/devnet-generate-activity.ts
```

## Exécuter un Cycle

Une fois que vous avez au moins 0.01 SOL de frais :

```bash
# Vérifier les frais disponibles
ts-node scripts/devnet-status.ts

# Exécuter un cycle
ts-node scripts/devnet-execute-cycle.ts
```

Output attendu :
```
✅ Cycle executed successfully!

📊 Cycle Results:
  Cycle #: 1
  SOL Used: 0.0100 SOL
  Tokens Burned: 150000

🎉 Success! The protocol is working correctly on devnet.
```

## Tester Plus en Profondeur

```bash
# Boucle de test (5-10 cycles)
for i in {1..5}; do
  echo "=== Cycle $i ==="
  ts-node scripts/devnet-execute-cycle.ts
  sleep 70  # Attendre l'intervalle minimum (60s devnet)
done

# Vérifier les résultats finaux
ts-node scripts/devnet-status.ts
```

## Vérifier la Checklist Mainnet

```bash
# Ouvrir et remplir la checklist
cat MAINNET_READINESS.md
```

Assurez-vous que TOUTES les cases sont cochées avant mainnet !

## Restaurer pour Mainnet

Quand vous êtes prêt à déployer sur mainnet :

```bash
# 1. Restaurer les fichiers originaux
cp programs/asdf-dat/src/lib.rs.mainnet.backup programs/asdf-dat/src/lib.rs
cp Anchor.toml.mainnet.backup Anchor.toml

# 2. Vérifier les adresses mainnet
grep -A2 "ASDF_MINT\|POOL_PUMPSWAP" programs/asdf-dat/src/lib.rs

# 3. Configurer mainnet
solana config set --url https://api.mainnet-beta.solana.com
solana config set --keypair ./wallet.json  # Votre VRAI wallet

# 4. Build et deploy
anchor build
anchor deploy --provider.cluster mainnet

# ⚠️ ATTENTION : Ceci déploie en PRODUCTION !
```

## Fichiers Créés

Après le setup, vous aurez :

```
asdf-dat/
├── devnet-token-info.json          # Infos complètes du token
├── devnet-config.json               # Config pour déploiement
├── programs/asdf-dat/src/
│   ├── lib.rs                       # Code configuré pour devnet
│   └── lib.rs.mainnet.backup        # Backup de la version mainnet
├── Anchor.toml                      # Config devnet
└── Anchor.toml.mainnet.backup       # Backup config mainnet
```

## Scripts Disponibles

| Script | Usage |
|--------|-------|
| `devnet-full-setup.ts` | 🎯 Setup complet automatisé (wizard) |
| `devnet-create-token.ts` | Créer token sur PumpFun |
| `devnet-apply-config.ts` | Appliquer config au code |
| `devnet-init.ts` | Initialiser le protocole |
| `devnet-status.ts` | Vérifier le statut |
| `devnet-execute-cycle.ts` | Exécuter un cycle |
| `devnet-setup-accounts.ts` | Créer les token accounts |

## Dépannage Rapide

### "Insufficient balance"
```bash
solana airdrop 2
```

### "Account does not exist"
```bash
ts-node scripts/devnet-init.ts
```

### "Insufficient fees"
- Générez plus de trades sur PumpFun
- Ou réduisez MIN_FEES_TO_CLAIM dans lib.rs

### "Cycle too soon"
- Attendez 60 secondes entre les cycles (devnet)
- Ou réduisez MIN_CYCLE_INTERVAL

### Le script devnet-create-token.ts échoue
- Vérifiez que vous avez assez de SOL (>0.5)
- Vérifiez que vous êtes sur devnet
- Les adresses PumpFun sont correctes (voir PUMP_ADDRESSES.md)

## Ressources

- **Guide Complet** : `DEVNET_DEPLOYMENT.md`
- **Adresses PumpFun** : `PUMP_ADDRESSES.md`
- **Scripts** : `scripts/README.md`
- **Checklist Mainnet** : `MAINNET_READINESS.md`

## Support

- **GitHub Issues** : [Votre repo]
- **Twitter** : [@jeanterre13](https://twitter.com/jeanterre13)

---

## TL;DR - La Version ULTRA Rapide

```bash
# Setup
solana config set --url https://api.devnet.solana.com
solana airdrop 2 && solana airdrop 2

# Lancer le wizard (fait TOUT automatiquement)
ts-node scripts/devnet-full-setup.ts

# Générer des trades sur pump.fun (devnet)

# Tester
ts-node scripts/devnet-execute-cycle.ts

# Profit! 🎉
```

---

**Temps total estimé : 5-10 minutes + temps de trading**

**Objectif : 5+ cycles réussis avant mainnet**

**Bon testing ! 🚀**
