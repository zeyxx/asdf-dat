# Guide d'Installation et Résolution des Problèmes

## Installation Initiale

### 1. Installer les Dépendances Node.js

```powershell
# Dans le dossier du projet
npm install
```

Cette commande installe :
- `ts-node` : Pour exécuter les scripts TypeScript
- `typescript` : Compilateur TypeScript
- `@coral-xyz/anchor` : Framework Anchor
- `@solana/web3.js` et `@solana/spl-token` : SDK Solana

### 2. Vérifier l'Installation

```powershell
# Vérifier que ts-node est installé
npx ts-node --version

# Ou utiliser les scripts npm
npm run devnet:status
```

## Utilisation des Scripts

### Via NPM Scripts (Recommandé sur Windows)

Au lieu de `ts-node scripts/...`, utilisez les commandes npm :

```powershell
# Setup complet automatisé
npm run devnet:setup

# Créer un token
npm run devnet:create-token

# Appliquer la configuration
npm run devnet:apply-config

# Initialiser le protocole
npm run devnet:init

# Vérifier le statut
npm run devnet:status

# Exécuter un cycle
npm run devnet:execute

# Setup des comptes
npm run devnet:setup-accounts
```

### Via npx (Alternative)

Si les scripts npm ne fonctionnent pas :

```powershell
npx ts-node scripts/devnet-full-setup.ts
npx ts-node scripts/devnet-create-token.ts
npx ts-node scripts/devnet-status.ts
```

## Problèmes Courants

### 1. "ts-node n'est pas reconnu"

**Solution** :
```powershell
npm install
```

Si cela ne fonctionne pas :
```powershell
npm install -g ts-node typescript
```

### 2. "Cannot find module '@coral-xyz/anchor'"

**Solution** :
```powershell
npm install @coral-xyz/anchor @solana/web3.js @solana/spl-token
```

### 3. Erreurs de permissions sur Windows

Exécutez PowerShell en mode Administrateur :
```powershell
# Clic droit sur PowerShell > Exécuter en tant qu'administrateur
```

Ou modifiez la politique d'exécution :
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 4. "anchor command not found"

Installez Anchor Framework :
```powershell
# Via cargo
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

### 5. "solana command not found"

Installez Solana CLI :
```powershell
# Télécharger depuis
# https://github.com/solana-labs/solana/releases

# Ou via scoop (si installé)
scoop install solana
```

## Configuration Solana sur Windows

```powershell
# Configurer le cluster
solana config set --url https://api.devnet.solana.com

# Créer ou utiliser un wallet
solana-keygen new --outfile $env:USERPROFILE\.config\solana\devnet-wallet.json

# Configurer le wallet
solana config set --keypair $env:USERPROFILE\.config\solana\devnet-wallet.json

# Obtenir du SOL devnet
solana airdrop 2
solana airdrop 2

# Vérifier
solana balance
```

## Vérification Complète de l'Environnement

```powershell
# Vérifier toutes les dépendances
node --version        # Devrait afficher v18+
npm --version         # Devrait afficher 9+
npx ts-node --version # Devrait afficher 10+
anchor --version      # Devrait afficher 0.30.0
solana --version      # Devrait afficher 1.17+
```

## Quick Start Complet sur Windows

```powershell
# 1. Installer les dépendances
npm install

# 2. Vérifier Solana
solana config get

# 3. Si pas configuré pour devnet
solana config set --url https://api.devnet.solana.com

# 4. Obtenir du SOL
solana airdrop 2
solana airdrop 2

# 5. Lancer le setup (utilisez npm run au lieu de ts-node)
npm run devnet:setup
```

## Structure des Commandes

### Format NPM (Recommandé)
```powershell
npm run <script-name>
```

### Format NPX (Alternative)
```powershell
npx ts-node scripts/<script-name>.ts
```

### Format Direct (Nécessite installation globale)
```powershell
ts-node scripts/<script-name>.ts
```

## Aide Supplémentaire

### Logs Détaillés

Pour voir plus de détails sur les erreurs :
```powershell
# Activer les logs verbeux
$env:DEBUG="*"
npm run devnet:setup
```

### Nettoyer et Réinstaller

Si rien ne fonctionne :
```powershell
# Supprimer node_modules
Remove-Item -Recurse -Force node_modules

# Supprimer package-lock.json
Remove-Item package-lock.json

# Réinstaller
npm install

# Réessayer
npm run devnet:setup
```

## Contact Support

Si vous rencontrez toujours des problèmes :

1. Vérifiez les versions :
   ```powershell
   node --version
   npm --version
   solana --version
   anchor --version
   ```

2. Partagez l'erreur complète

3. Indiquez votre OS : Windows (version)

---

**TL;DR pour Windows** :

```powershell
# Installation
npm install

# Utilisation
npm run devnet:setup

# Au lieu de ts-node, toujours utiliser "npm run"
```
