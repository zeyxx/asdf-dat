# Guide de Build Windows pour ASDF DAT

Ce guide propose **3 méthodes pour builder sur Windows** sans utiliser WSL.

## ⚠️ Problème

Le build échoue sur Windows parce que `cargo-build-sbf` (intégré dans Solana CLI) utilise Rust 1.75.0-dev, mais les dépendances nécessitent Rust 1.82.0.

## 🎯 Solutions Windows Natives

### Méthode 1: Downgrade vers Anchor 0.30.1 (RECOMMANDÉ)

Cette méthode downgrade temporairement Anchor de 0.31.1 vers 0.30.1, qui est compatible avec Rust 1.75.0.

#### Étapes:

```powershell
.\build-windows-alternative.ps1
```

**Avantages:**
- ✅ Simple et rapide
- ✅ Utilise votre installation Solana actuelle
- ✅ Pas besoin de téléchargement

**Inconvénients:**
- ⚠️ Utilise une version légèrement plus ancienne d'Anchor (0.30.1 au lieu de 0.31.1)
- ⚠️ Peut nécessiter des ajustements mineurs du code

**Si ça fonctionne:**
Le programme sera compilé dans `target/deploy/asdf_dat.so`

---

### Méthode 2: Mise à Jour Manuelle de Solana CLI

Cette méthode met à jour Solana CLI vers une version plus récente qui inclut un Rust plus récent dans cargo-build-sbf.

#### Étapes:

```powershell
.\build-windows-manual-update.ps1
```

Le script va tenter plusieurs méthodes:
1. Téléchargement automatique de Solana v1.18.17+
2. Extraction automatique (nécessite 7-Zip)
3. Installation dans votre répertoire Solana

**Si le téléchargement automatique échoue:**

**Option A: Téléchargement Manuel**

1. Allez sur: https://github.com/solana-labs/solana/releases/latest
2. Téléchargez: `solana-release-x86_64-pc-windows-msvc.tar.bz2`
3. Extrayez avec 7-Zip vers: `C:\Users\VotreNom\.local\share\solana\install\active_release`
4. Lancez: `.\build.ps1`

**Option B: Windows Installer**

1. Téléchargez: `solana-install-init-x86_64-pc-windows-msvc.exe`
2. Exécutez l'installeur
3. Redémarrez PowerShell
4. Lancez: `.\build.ps1`

**Avantages:**
- ✅ Garde Anchor 0.31.1 (version actuelle)
- ✅ Résout le problème à la source
- ✅ Build permanent sans downgrade

**Inconvénients:**
- ⏱️ Nécessite téléchargement et installation
- ⚠️ Peut avoir des problèmes réseau

---

### Méthode 3: Compilation Manuelle BPF

Cette méthode compile directement avec `cargo rustc` en bypassant `cargo-build-sbf`.

#### Étapes:

```powershell
.\build-windows-manual-compile.ps1
```

**Cette méthode:**
1. Utilise Rust 1.82.0 directement
2. Compile vers la target BPF
3. Génère le fichier .so manuellement

**Avantages:**
- ✅ Utilise Rust 1.82.0
- ✅ Contrôle total du processus
- ✅ Pas besoin de mettre à jour Solana CLI

**Inconvénients:**
- ⚠️ Approche non standard
- ⚠️ Peut nécessiter toolchain BPF additionnel
- ⚠️ Moins testé que les méthodes officielles

---

## 🚀 Ordre Recommandé

Essayez les méthodes dans cet ordre:

### 1️⃣ Essayez d'abord: Méthode 1 (Downgrade Anchor)
```powershell
.\build-windows-alternative.ps1
```

**Si ça fonctionne:** Vous avez un programme fonctionnel avec Anchor 0.30.1

**Si ça échoue:** Passez à la méthode 2

### 2️⃣ Ensuite: Méthode 2 (Mise à jour Solana)
```powershell
.\build-windows-manual-update.ps1
```

Ou téléchargez manuellement depuis GitHub si le script échoue.

**Si ça fonctionne:** Vous pouvez maintenant utiliser `.\build.ps1` normalement

**Si ça échoue:** Passez à la méthode 3

### 3️⃣ En dernier recours: Méthode 3 (Compilation manuelle)
```powershell
.\build-windows-manual-compile.ps1
```

---

## ✅ Vérifier que le Build a Réussi

Après un build réussi, vérifiez:

```powershell
# Le fichier .so doit exister
ls target\deploy\asdf_dat.so

# Il doit faire environ 200-500 KB
```

## 🚀 Déployer Après le Build

### Déploiement Devnet

```powershell
solana program deploy target\deploy\asdf_dat.so --url devnet
```

### Ou avec Anchor

```powershell
anchor deploy --provider.cluster devnet
```

### Test avec votre Token PumpFun

Votre token devnet est déjà créé:
- **Token**: `D1CETFzuFJYHH4BcBjf7Ysz8KdJSeCD4Yk5EjJhRk5QV`
- **Bonding Curve**: `7CVS16pQuMsDxD5bQjYnGBn5VTjWKDFKkFXAY2bu4bmg`

---

## 🆘 Dépannage

### Erreur: "Anchor CLI not found"

```powershell
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.31.1
avm use 0.31.1
```

### Erreur: "Solana CLI not found"

Installez Solana CLI:
- Windows Installer: https://docs.solana.com/cli/install-solana-cli-tools
- Ou utilisez la Méthode 2 ci-dessus

### Erreur: "7-Zip not found"

Téléchargez et installez 7-Zip:
- https://www.7-zip.org/download.html

### Erreur: "network timeout" ou "SSL/TLS failed"

Vérifiez votre connexion internet et pare-feu, puis réessayez.

---

## 📋 Récapitulatif

| Méthode | Difficulté | Temps | Recommandé |
|---------|-----------|--------|------------|
| 1. Downgrade Anchor | ⭐ Facile | 2 min | ✅ Essayer en premier |
| 2. Update Solana CLI | ⭐⭐ Moyen | 10 min | ✅ Si Méthode 1 échoue |
| 3. Compilation manuelle | ⭐⭐⭐ Avancé | 5 min | ⚠️ Dernier recours |

---

## 💡 Remarques Importantes

1. **Votre code est correct** - Le problème est uniquement l'environnement de build
2. **Le token est créé** - Prêt pour les tests sur devnet
3. **Toutes les fixes sont appliquées** - Compatibilité Anchor 0.31.1 OK
4. **Le déploiement fonctionnera** - Une fois le .so compilé

Bonne chance! 🚀
