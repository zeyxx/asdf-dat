# Guide de Setup Complet pour Windows

Guide étape par étape pour configurer et tester ASDF DAT sur Windows avec PowerShell.

## 📋 Prérequis

### 1. Installer Node.js

```powershell
# Télécharger depuis https://nodejs.org/
# Version recommandée : 18.x LTS ou supérieure

# Vérifier l'installation
node --version   # Devrait afficher v18.x ou supérieur
npm --version    # Devrait afficher 9.x ou supérieur
```

### 2. Installer Rust

```powershell
# Télécharger depuis https://rustup.rs/
# Ou utiliser l'installeur Windows : rustup-init.exe

# Vérifier l'installation
rustc --version  # Devrait afficher 1.70.0 ou supérieur
cargo --version
```

### 3. Installer Solana CLI

Option A - Via l'installeur Windows (Recommandé) :
```powershell
# Télécharger depuis
# https://github.com/solana-labs/solana/releases

# Chercher : solana-install-init-x86_64-pc-windows-msvc.exe
# Exécuter l'installeur

# Redémarrer PowerShell puis vérifier
solana --version  # Devrait afficher 1.17.0 ou supérieur
```

Option B - Via script :
```powershell
# Télécharger et installer
cmd /c "curl https://release.solana.com/stable/solana-install-init-x86_64-pc-windows-msvc.exe --output C:\solana-install-tmp\solana-install-init.exe --create-dirs"

# Exécuter
C:\solana-install-tmp\solana-install-init.exe v1.17.0

# Ajouter au PATH (redémarrer PowerShell après)
$env:PATH += ";$env:USERPROFILE\.local\share\solana\install\active_release\bin"
```

### 4. Installer Anchor

```powershell
# Installer Anchor Version Manager
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

# Installer Anchor
avm install latest
avm use latest

# Vérifier
anchor --version  # Devrait afficher 0.30.0
```

## 🚀 Setup du Projet

### Étape 1 : Cloner et Installer

```powershell
# Aller dans votre dossier de travail
cd C:\Users\[VOTRE_NOM]\Desktop\pumpfun

# Cloner le repo
git clone https://github.com/zeyxx/asdf-dat
cd asdf-dat

# Installer les dépendances
npm install

# Vérifier que ts-node fonctionne
npx ts-node --version
```

### Étape 2 : Configurer Solana pour Devnet

```powershell
# 1. Configurer le cluster devnet
solana config set --url https://api.devnet.solana.com

# 2. Créer un wallet devnet
solana-keygen new --outfile devnet-wallet.json

# IMPORTANT : Noter votre seed phrase en lieu sûr !

# 3. Configurer ce wallet
solana config set --keypair devnet-wallet.json

# 4. Vérifier la configuration
solana config get
# Devrait afficher :
#   RPC URL: https://api.devnet.solana.com
#   Keypair Path: devnet-wallet.json
```

### Étape 3 : Obtenir du SOL Devnet

```powershell
# Demander des airdrops (2 SOL à la fois max)
solana airdrop 2
Start-Sleep -Seconds 5
solana airdrop 2

# Vérifier le solde
solana balance
# Devrait afficher : 4 SOL
```

**⚠️ Si l'airdrop échoue** :
```powershell
# Utiliser le faucet web
# https://faucet.solana.com/

# Ou réessayer plusieurs fois
for ($i=0; $i -lt 5; $i++) {
    solana airdrop 2
    Start-Sleep -Seconds 10
}
```

## 🎯 Lancer le Setup Automatique

### Option 1 : Setup Complet (Recommandé)

```powershell
# Lancer le wizard automatique
npm run devnet:setup
```

Le wizard va :
1. ✅ Vérifier votre config Solana
2. ✅ Vérifier votre solde SOL
3. ✅ Créer un token sur PumpFun devnet
4. ✅ Configurer automatiquement le code
5. ✅ Build et deploy le programme
6. ✅ Initialiser le protocole
7. ✅ Guider pour les étapes manuelles

### Option 2 : Étape par Étape (Manuel)

Si vous préférez contrôler chaque étape :

#### 1. Créer le Token

```powershell
npm run devnet:create-token
```

**Output attendu** :
```
✅ Token created successfully!
  Mint: [ADRESSE_DU_TOKEN]
  Bonding Curve: [ADRESSE_BONDING_CURVE]

Files Created:
  ✅ devnet-token-info.json
  ✅ devnet-config.json
```

#### 2. Appliquer la Configuration

```powershell
npm run devnet:apply-config
```

**Output attendu** :
```
✅ lib.rs updated successfully!
✅ Anchor.toml configured for devnet

Next: anchor build
```

#### 3. Build le Programme

```powershell
anchor build
```

**Si erreur "anchor: command not found"** :
```powershell
# Vérifier l'installation d'Anchor
avm use latest
anchor --version

# Ou réinstaller
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked --force
```

#### 4. Obtenir le Program ID

```powershell
solana address -k target/deploy/asdf_dat-keypair.json
```

Copiez l'adresse affichée (exemple : `EJdSbSXMXQLp7WLqgVYjJ6a6BqMw6t8MzfavWQBZM6a2`)

#### 5. Mettre à Jour le Program ID

**Dans `programs/asdf-dat/src/lib.rs`** (ligne 9) :
```rust
declare_id!("VOTRE_PROGRAM_ID_ICI");
```

**Dans `Anchor.toml`** (section [programs.devnet]) :
```toml
[programs.devnet]
asdf_dat = "VOTRE_PROGRAM_ID_ICI"
```

#### 6. Rebuild et Deploy

```powershell
# Rebuild avec le nouveau program ID
anchor build

# Deploy sur devnet (prend 2-3 minutes)
anchor deploy --provider.cluster devnet

# Vérifier le déploiement
solana program show [VOTRE_PROGRAM_ID] --url devnet
```

#### 7. Initialiser le Protocole

```powershell
npm run devnet:init
```

**Output attendu** :
```
✅ Initialized successfully!

Next Steps:
1. Transfer coin_creator to DAT Authority
2. Generate trading activity
```

#### 8. Vérifier le Statut

```powershell
npm run devnet:status
```

## 🔄 Étapes Post-Initialisation

### 1. Transférer le Creator (IMPORTANT)

Le protocole a besoin d'être le `coin_creator` pour collecter les frais.

**Via PumpFun Devnet** :
1. Allez sur https://pump.fun (switch to devnet)
2. Trouvez votre token
3. Transférez le creator à l'adresse DAT Authority
   - Visible dans `devnet-config.json`
   - Ou affiché par `npm run devnet:status`

### 2. Générer de l'Activité de Trading

Le protocole a besoin de frais accumulés pour fonctionner.

**Option A - Via Interface PumpFun** :
1. Utilisez un autre wallet
2. Faites des achats/ventes sur votre token
3. Les frais s'accumulent automatiquement

**Option B - Via Script** (à implémenter) :
```powershell
# Script pour automatiser les trades
npm run devnet:generate-activity
```

Objectif : Au moins 0.01 SOL de frais (devnet)

### 3. Vérifier les Frais Accumulés

```powershell
npm run devnet:status
```

Regardez la section "Creator Vault Balance"

### 4. Exécuter un Cycle de Test

Une fois que vous avez ≥0.01 SOL de frais :

```powershell
npm run devnet:execute
```

**Output attendu** :
```
✅ Cycle executed successfully!

📊 Cycle Results:
  Cycle #: 1
  SOL Used: 0.0100 SOL
  Tokens Burned: 150000

🎉 Success!
```

### 5. Tester Plusieurs Cycles

```powershell
# Boucle de test (5 cycles)
for ($i=1; $i -le 5; $i++) {
    Write-Host "=== Cycle $i ==="
    npm run devnet:execute
    Start-Sleep -Seconds 70  # Attendre l'intervalle (60s devnet)
}

# Vérifier les résultats
npm run devnet:status
```

## 🔧 Dépannage

### Erreur : "ts-node not found"

```powershell
# Réinstaller les dépendances
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

### Erreur : "anchor command not found"

```powershell
# Réinstaller Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked --force

# Vérifier
anchor --version
```

### Erreur : "solana command not found"

```powershell
# Ajouter au PATH
$env:PATH += ";$env:USERPROFILE\.local\share\solana\install\active_release\bin"

# Ou redémarrer PowerShell

# Vérifier
solana --version
```

### Erreur : "Insufficient balance"

```powershell
# Obtenir plus de SOL devnet
solana airdrop 2
Start-Sleep -Seconds 5
solana airdrop 2

# Ou utiliser le faucet web
# https://faucet.solana.com/
```

### Erreur : "Insufficient fees"

- Générez plus de trades sur votre token
- Ou réduisez `MIN_FEES_TO_CLAIM` dans lib.rs (ligne 24)

### Erreur : "Not coin creator"

- Assurez-vous d'avoir transféré le creator au DAT Authority
- L'adresse est dans `devnet-config.json`

### Scripts Échouent avec Erreurs TypeScript

```powershell
# Mettre à jour le code
git pull origin claude/prepare-mainnet-deployment-011CUKGdyUXczWdGXWmpyv79

# Réinstaller
npm install

# Réessayer
npm run devnet:setup
```

## 📊 Checklist Complète

### Setup Initial
- [ ] Node.js installé (v18+)
- [ ] Rust installé
- [ ] Solana CLI installé (v1.17+)
- [ ] Anchor installé (v0.30.0)
- [ ] Dépendances npm installées

### Configuration
- [ ] Solana configuré pour devnet
- [ ] Wallet devnet créé
- [ ] Au moins 4 SOL devnet obtenu
- [ ] Seed phrase sauvegardée

### Déploiement
- [ ] Token créé sur PumpFun devnet
- [ ] Configuration appliquée (lib.rs, Anchor.toml)
- [ ] Programme build sans erreur
- [ ] Program ID mis à jour
- [ ] Programme déployé sur devnet
- [ ] Protocole initialisé

### Test
- [ ] Creator transféré au DAT Authority
- [ ] Trading activity générée
- [ ] Frais ≥0.01 SOL accumulés
- [ ] Premier cycle exécuté avec succès
- [ ] 5+ cycles réussis
- [ ] Toutes fonctions admin testées

### Validation Mainnet
- [ ] MAINNET_READINESS.md rempli à 100%
- [ ] Tous les tests passés
- [ ] Code mainnet restauré
- [ ] Prêt pour production

## 🎯 Commandes Rapides

```powershell
# Setup complet
npm install
npm run devnet:setup

# Tester
npm run devnet:execute
npm run devnet:status

# Debug
git log -1                          # Voir derniers commits
git pull origin [BRANCHE]           # Mettre à jour
solana config get                   # Voir config Solana
solana balance                      # Voir solde

# Nettoyer
Remove-Item -Recurse target, dist   # Supprimer builds
anchor clean                        # Nettoyer Anchor
```

## 📚 Ressources

- **Quick Start** : `QUICK_START_DEVNET.md`
- **Troubleshooting** : `TROUBLESHOOTING.md`
- **Adresses PumpFun** : `PUMP_ADDRESSES.md`
- **Checklist Mainnet** : `MAINNET_READINESS.md`

## 🆘 Besoin d'Aide ?

1. Vérifiez `TROUBLESHOOTING.md`
2. Vérifiez que toutes les versions sont correctes
3. Partagez l'erreur complète avec contexte

---

**TL;DR** :

```powershell
# Setup
npm install
solana config set --url https://api.devnet.solana.com
solana-keygen new --outfile devnet-wallet.json
solana config set --keypair devnet-wallet.json
solana airdrop 2 && solana airdrop 2

# Lancer
npm run devnet:setup

# Tester
npm run devnet:execute
```

**Temps total : ~30 minutes (première fois)**

Bon setup ! 🚀
