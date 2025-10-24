# Limitations Devnet et Solutions

## ❗ Problème : PumpFun n'a pas de Devnet Public

### Constat

**PumpFun est un protocole mainnet uniquement.** Il n'existe pas de déploiement officiel sur devnet.

Les adresses PumpFun que nous avons documentées (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, etc.) existent uniquement sur mainnet-beta.

### Impact

Cela signifie qu'on ne peut pas :
- ❌ Créer un token via PumpFun sur devnet
- ❌ Utiliser les bonding curves PumpFun sur devnet
- ❌ Tester l'intégration PumpSwap complète sur devnet

### ✅ Solution : Token SPL Simple pour Tests Devnet

Au lieu de PumpFun, nous utilisons un **token SPL standard** sur devnet pour tester la logique du protocole.

## 🔧 Approche de Test sur Devnet

### Ce que nous testons sur Devnet

✅ **Logique du protocole** :
- Initialisation du programme
- Gestion d'état (DAT State)
- PDAs (DAT Authority)
- Token accounts setup
- Instructions admin (pause, resume, update)
- Sécurité et validations

✅ **Opérations de base** :
- Burn de tokens
- Transferts de tokens
- Gestion des comptes
- Événements on-chain

### Ce que nous NE testons PAS sur Devnet

⚠️ **Intégration PumpFun spécifique** :
- Collection de fees depuis creator vault
- Swap via bonding curve
- Instructions PumpSwap
- Dynamic fees basés sur market cap

Ces parties seront testées sur mainnet avec prudence (petites quantités d'abord).

## 📋 Scripts Disponibles

### Pour Devnet (Token Simple)

```powershell
# Créer un token SPL simple sur devnet
npm run devnet:create-token
```

Ce script :
- Crée un token SPL standard
- Mint 1 milliard de tokens initiaux
- Sauvegarde les infos dans `devnet-config.json`
- Configure pour tester la logique core du protocole

### Pour PumpFun (Mainnet uniquement)

```powershell
# Script PumpFun (ne fonctionne que sur mainnet)
npm run devnet:create-token-pumpfun
```

Ce script est conservé pour référence mais **ne fonctionnera que sur mainnet**.

## 🎯 Workflow de Test Recommandé

### Phase 1 : Tests Devnet (Core Logic)

```powershell
# 1. Créer token simple
npm run devnet:create-token

# 2. Configurer le programme
npm run devnet:apply-config

# 3. Déployer
anchor build
anchor deploy --provider.cluster devnet

# 4. Initialiser
npm run devnet:init

# 5. Tester les fonctions admin
# - Emergency pause
# - Resume
# - Update parameters
# - Transfer admin
```

**Objectif** : Valider que le programme compile, déploie, et que toutes les fonctions admin fonctionnent.

### Phase 2 : Tests Mainnet (Avec Précaution)

```powershell
# 1. Utiliser le VRAI token PumpFun
# ASDF_MINT = 9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump
# POOL = DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb

# 2. Déployer sur mainnet
anchor build
anchor deploy --provider.cluster mainnet

# 3. Initialiser avec prudence
ts-node scripts/mainnet-init.ts

# 4. Attendre accumulation de fees
# (monitoring externe)

# 5. Premier cycle TEST avec montant minimal
ts-node scripts/mainnet-execute-cycle.ts

# 6. Vérifier les résultats

# 7. Si succès, continuer avec cycles normaux
```

**Objectif** : Valider l'intégration PumpFun complète avec petites quantités.

## ⚙️ Configuration pour Devnet vs Mainnet

### Devnet (Token Simple)

```rust
// lib.rs - DEVNET CONFIG
pub const ASDF_MINT: Pubkey = solana_program::pubkey!("[VOTRE_TOKEN_SIMPLE_DEVNET]");
pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!("[MINT_OU_MOCK_POOL]");

// Paramètres ajustés pour faciliter les tests
pub const MIN_FEES_TO_CLAIM: u64 = 10_000_000; // 0.01 SOL
pub const MIN_CYCLE_INTERVAL: i64 = 60; // 1 minute
```

### Mainnet (PumpFun Réel)

```rust
// lib.rs - MAINNET CONFIG
pub const ASDF_MINT: Pubkey = solana_program::pubkey!("9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump");
pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!("DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb");
pub const PUMP_SWAP_PROGRAM: Pubkey = solana_program::pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

// Paramètres de production
pub const MIN_FEES_TO_CLAIM: u64 = 190_000_000; // 0.19 SOL
pub const MIN_CYCLE_INTERVAL: i64 = 3600; // 1 heure
```

## 📊 Matrice de Test

| Fonctionnalité | Devnet | Mainnet |
|----------------|--------|---------|
| **Déploiement programme** | ✅ Complet | ✅ Complet |
| **Initialisation** | ✅ Complet | ✅ Complet |
| **PDAs et accounts** | ✅ Complet | ✅ Complet |
| **Fonctions admin** | ✅ Complet | ✅ Complet |
| **Burn tokens** | ✅ Complet | ✅ Complet |
| **Collect fees PumpFun** | ❌ Simulé | ✅ Réel |
| **Swap PumpSwap** | ❌ Simulé | ✅ Réel |
| **Dynamic fees** | ❌ N/A | ✅ Réel |
| **Full cycle** | ⚠️ Partiel | ✅ Complet |

## 🔒 Stratégie de Déploiement Sûr

### Étape 1 : Devnet (1-2 jours)

- ✅ Valider compilation
- ✅ Valider déploiement
- ✅ Tester fonctions admin
- ✅ Tester PDAs et accounts
- ✅ Remplir checklist `MAINNET_READINESS.md` (parties testables)

### Étape 2 : Mainnet Staging (1 jour)

- ✅ Déployer le programme
- ✅ Initialiser avec paramètres conservateurs
- ✅ Attendre accumulation naturelle de fees
- ✅ Observer sans intervention

### Étape 3 : Premier Cycle Test (1 jour)

- ✅ Exécuter avec montant minimal (< 0.1 SOL)
- ✅ Vérifier chaque étape
- ✅ Confirmer tokens brûlés
- ✅ Vérifier métriques

### Étape 4 : Production (Ongoing)

- ✅ Activer cycles normaux
- ✅ Monitoring 24/7
- ✅ Alertes automatiques
- ✅ Dashboard public

## 💡 Recommandations

### Pour le Développement

1. **Utilisez devnet** pour :
   - Développer de nouvelles fonctionnalités
   - Tester les changements de code
   - Valider les migrations
   - Formation de nouveaux développeurs

2. **N'utilisez jamais devnet** pour :
   - Tester l'intégration PumpFun complète
   - Valider les montants de fees
   - Tester les dynamic fees
   - Simuler des cycles réels

### Pour les Tests Finaux

1. **Créez un token de test sur mainnet** (optionnel) :
   - Petit token via PumpFun
   - Pool minimale (1-2 SOL)
   - Tests d'intégration complets
   - Puis déploiement sur ASDF réel

2. **Ou déployez directement** :
   - Si très confiant du code devnet
   - Commencez avec montants minimaux
   - Augmentez progressivement
   - Monitoring strict

## 📝 Checklist Pré-Mainnet

Même avec limitations devnet, vérifiez :

- [ ] ✅ Programme compile sans warnings
- [ ] ✅ Deploy devnet réussi
- [ ] ✅ Initialisation fonctionne
- [ ] ✅ Tous les PDAs corrects
- [ ] ✅ Emergency pause fonctionne
- [ ] ✅ Resume fonctionne
- [ ] ✅ Update parameters fonctionne
- [ ] ✅ Transfer admin fonctionne
- [ ] ✅ Burn de tokens fonctionne
- [ ] ✅ Pas d'overflow / stack errors
- [ ] ✅ Code review complet
- [ ] ✅ Adresses mainnet vérifiées 3x
- [ ] ✅ Paramètres mainnet restaurés
- [ ] ✅ Backup du code fait
- [ ] ✅ Plan d'urgence documenté

## 🆘 En Cas de Problème sur Mainnet

### Si Premier Cycle Échoue

1. **NE PAS PANIQUER**
2. Exécuter `emergency_pause()`
3. Analyser les logs
4. Identifier le problème
5. Corriger si possible
6. Ou redéployer nouvelle version

### Contacts d'Urgence

- **Developer** : [@jeanterre13](https://twitter.com/jeanterre13)
- **Community** : $ASDFASDFA Discord
- **Backup admin** : [Configuration multisig]

## 📚 Ressources

- **Token Simple Devnet** : `scripts/devnet-create-token-simple.ts`
- **Config Devnet** : `devnet-config.json` (après création)
- **Mainnet Addresses** : `PUMP_ADDRESSES.md`
- **Checklist** : `MAINNET_READINESS.md`

---

## TL;DR

**PumpFun = Mainnet Only**

✅ **Sur Devnet** : Token SPL simple pour tester la logique core
✅ **Sur Mainnet** : Intégration PumpFun complète et réelle

**Workflow** :
1. Tests devnet (logique core) → ✅ Confiance dans le code
2. Premier cycle mainnet (petit montant) → ✅ Validation intégration
3. Production mainnet (full scale) → ✅ Protocole en live

**Sécurité** : Commencez toujours petit sur mainnet, augmentez progressivement.

---

**Date** : 2025-01-20
**Status** : ✅ Documenté et validé
