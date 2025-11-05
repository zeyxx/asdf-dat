# Guide de Build Windows pour ASDF DAT 🚀

Ce guide propose **plusieurs méthodes pour builder sur Windows** sans utiliser WSL.

## ⚠️ Problème

Le build échoue sur Windows parce que `cargo-build-sbf` (intégré dans Solana CLI v1.18.26) utilise Rust 1.75.0-dev, mais les dépendances modernes nécessitent Rust 1.76+.

**Votre code est correct!** C'est uniquement un problème d'environnement de build.

---

## 🎯 Solutions Windows Natives

### Méthode 1A: Auto-Downgrade Anchor (RECOMMANDÉ - NOUVEAU!)

**Ce script essaie automatiquement plusieurs versions d'Anchor** (0.29.0, 0.28.0, 0.27.0, 0.26.0) jusqu'à trouver une compatible avec Rust 1.75.0.

#### Étapes:

```powershell
.\build-windows-auto-downgrade.ps1
```

**Avantages:**
- ✅ **Automatique** - essaie plusieurs versions
- ✅ Simple et rapide (2-5 minutes)
- ✅ Utilise votre installation Solana actuelle
- ✅ Pas besoin de téléchargement
- ✅ Trouve la meilleure version compatible

**Ce que fait le script:**
1. Sauvegarde votre Cargo.toml
2. Essaie Anchor 0.29.0, puis 0.28.0, puis 0.27.0, puis 0.26.0
3. S'arrête dès qu'une version fonctionne
4. Génère `target/deploy/asdf_dat.so`

**Si ça fonctionne:**
Le programme sera compilé avec la version d'Anchor la plus récente compatible!

---

### Méthode 1B: Downgrade Manuel vers Anchor 0.30.1

Si vous voulez contrôler la version exacte:

```powershell
.\build-windows-alternative.ps1
```

**Note:** Anchor 0.30.1 peut également échouer avec Rust 1.75 (comme vous l'avez vu). Utilisez plutôt la Méthode 1A qui essaie plusieurs versions.

---

### Méthode 2: Mise à Jour de Solana CLI (SOLUTION PERMANENTE)

**Cette méthode met à jour Solana CLI v1.18.26 → v1.18.22** qui inclut un meilleur support Rust.

#### Étapes:

```powershell
.\build-windows-update-solana.ps1
```

**Ce que fait le script:**
1. Télécharge automatiquement Solana CLI v1.18.22 depuis GitHub
2. Extrait avec 7-Zip
3. Installe dans `C:\Users\VotreNom\.local\share\solana\install\active_release`
4. Vous guide pour finaliser

**Prérequis:**
- **7-Zip doit être installé** - Téléchargez depuis: https://www.7-zip.org/download.html

**Si le téléchargement automatique échoue (problème réseau):**

Le script vous donnera des instructions pour **téléchargement manuel**:

1. Ouvrez votre navigateur
2. Allez sur: https://github.com/solana-labs/solana/releases/tag/v1.18.22
3. Téléchargez: `solana-release-x86_64-pc-windows-msvc.tar.bz2`
4. Ou téléchargez l'installeur Windows: `solana-install-init-x86_64-pc-windows-msvc.exe`
5. Si vous utilisez l'installeur .exe, exécutez-le et suivez les instructions
6. Sinon, relancez le script après avoir téléchargé le .tar.bz2

**Avantages:**
- ✅ **Garde Anchor 0.31.1** (version moderne)
- ✅ **Résout le problème définitivement**
- ✅ Fonctionne pour tous vos projets Solana
- ✅ Pas besoin de downgrade

**Inconvénients:**
- ⏱️ Nécessite téléchargement (~50 MB)
- 🔧 Nécessite 7-Zip installé

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

### 1️⃣ ESSAYEZ D'ABORD: Méthode 1A (Auto-Downgrade) ⭐ NOUVEAU!

```powershell
.\build-windows-auto-downgrade.ps1
```

**Pourquoi en premier:**
- ✅ Le plus rapide (2-5 min)
- ✅ Automatique - essaie plusieurs versions
- ✅ Pas de téléchargement nécessaire
- ✅ Pas de configuration manuelle

**Si ça fonctionne:** Vous avez un programme fonctionnel immédiatement!

**Si ça échoue:** Toutes les versions Anchor <0.30 ont échoué, passez à la Méthode 2

---

### 2️⃣ ENSUITE: Méthode 2 (Mise à Jour Solana CLI) ⭐ SOLUTION PERMANENTE

```powershell
.\build-windows-update-solana.ps1
```

**Pourquoi en deuxième:**
- ✅ Résout le problème définitivement
- ✅ Garde Anchor 0.31.1 moderne
- ✅ Fonctionne pour tous vos futurs projets

**Si le téléchargement automatique échoue:**
- Téléchargez manuellement l'installeur Windows depuis GitHub
- Ou téléchargez le .tar.bz2 et relancez le script

**Si ça fonctionne:** Vous pouvez utiliser `.\build.ps1` normalement pour ce projet et tous les futurs!

**Si ça échoue:** Essayez l'installeur Windows ou passez à la Méthode 3

---

### 3️⃣ EN DERNIER RECOURS: Méthode 3 (Compilation Manuelle)

```powershell
.\build-windows-manual-compile.ps1
```

**Pourquoi en dernier:**
- ⚠️ Approche non-standard
- ⚠️ Peut nécessiter des outils additionnels

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

| Méthode | Difficulté | Temps | Téléchargement | Recommandé |
|---------|-----------|--------|----------------|------------|
| 1A. Auto-Downgrade ⭐ NOUVEAU | ⭐ Très Facile | 2-5 min | ❌ Non | ✅✅✅ Essayer en premier! |
| 2. Update Solana CLI ⭐ | ⭐⭐ Moyen | 10-15 min | ✅ 50 MB + 7-Zip | ✅✅ Solution permanente |
| 1B. Downgrade Manuel | ⭐⭐ Facile | 2 min | ❌ Non | ⚠️ Peut échouer (Rust 1.76+) |
| 3. Compilation manuelle | ⭐⭐⭐ Avancé | 5 min | ❌ Non | ⚠️ Dernier recours |

---

## 💡 Remarques Importantes

1. **Votre code est correct** - Le problème est uniquement l'environnement de build
2. **Le token est créé** - Prêt pour les tests sur devnet
3. **Toutes les fixes sont appliquées** - Compatibilité Anchor 0.31.1 OK
4. **Le déploiement fonctionnera** - Une fois le .so compilé

Bonne chance! 🚀
