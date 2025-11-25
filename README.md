# ASDF-DAT Ecosystem

**Automated Buyback & Burn Protocol for Solana**

Un système automatisé de collecte des fees de trading Pump.fun et d'exécution de cycles buyback-and-burn, avec support multi-token et redistribution hiérarchique.

[![Solana](https://img.shields.io/badge/Solana-Devnet-green)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-blue)](https://anchor-lang.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://typescriptlang.org)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ASDF-DAT ECOSYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  ROOT TOKEN  │◄───│  SECONDARY   │◄───│   MAYHEM     │      │
│  │   (DATSPL)   │    │   (DATS2)    │    │   (DATM)     │      │
│  │    100%      │    │  55.2%/44.8% │    │  55.2%/44.8% │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         └─────────┬─────────┴─────────┬─────────┘               │
│                   ▼                   ▼                         │
│           ┌──────────────────────────────────┐                  │
│           │     ECOSYSTEM ORCHESTRATOR       │                  │
│           │   Dynamic Balance Allocation     │                  │
│           └──────────────┬───────────────────┘                  │
│                          ▼                                      │
│           ┌──────────────────────────────────┐                  │
│           │      SOLANA SMART CONTRACT       │                  │
│           │   ASDfNfUHwVGfrg3SV7SQYWhaVxnrCU │                  │
│           └──────────────────────────────────┘                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flow Économique

1. **Trading Fees** → Collectés depuis Pump.fun creator vaults
2. **Fee Split** → Tokens secondaires envoient 44.8% au root treasury
3. **Buyback** → SOL utilisé pour acheter des tokens sur la bonding curve
4. **Burn** → Tokens achetés sont brûlés, réduisant le supply

---

## Caractéristiques

- **Multi-Token Ecosystem** - Support illimité de tokens secondaires
- **Hierarchical Fee Distribution** - 44.8% des fees secondaires → root token
- **Dynamic Allocation** - Distribution proportionnelle basée sur les pending fees
- **Mayhem Mode** - Support Token-2022 avec extensions
- **Graceful Deferral** - Tokens avec allocation insuffisante reportés au cycle suivant
- **Emergency Controls** - Pause/Resume pour situations critiques

---

## Quick Start (Devnet)

### Prérequis

```bash
# Installer les dépendances
npm install

# Configurer Solana CLI
solana config set --url devnet
```

### Générer du Volume de Test

```bash
# Générer des trades (achats + ventes) pour accumuler des fees
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 10 0.1
npx ts-node scripts/generate-volume.ts devnet-token-secondary.json 10 0.1
npx ts-node scripts/generate-volume.ts devnet-token-mayhem.json 10 0.1
```

### Exécuter un Cycle Écosystème

```bash
# Cycle complet : collect → distribute → buyback → burn (tous les tokens)
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json
```

### Vérifier les Statistiques

```bash
# État actuel des tokens
npx ts-node scripts/check-current-stats.ts

# État du protocole DAT
npx ts-node scripts/check-dat-state.ts
```

---

## Structure du Projet

```
asdf-dat/
├── programs/asdf-dat/          # Smart Contract Solana (Rust)
│   └── src/
│       ├── lib.rs              # Programme principal (2,164 LOC)
│       └── tests.rs            # Tests unitaires
│
├── scripts/                    # Scripts d'opération (56 fichiers)
│   ├── execute-ecosystem-cycle.ts   # Orchestrateur principal
│   ├── generate-volume.ts           # Génération de trades
│   ├── check-*.ts                   # Scripts de monitoring
│   ├── buy-*.ts / sell-*.ts         # Opérations de trading
│   └── init-*.ts / create-*.ts      # Initialisation
│
├── src/                        # Applications TypeScript
│   ├── bot.ts                  # Bot automatisé
│   ├── dashboard.ts            # Dashboard web
│   └── index.ts                # Point d'entrée CLI
│
├── lib/                        # Daemons et utilitaires
│   ├── fee-monitor.ts          # Monitoring des fees
│   └── validator-daemon.ts     # Synchronisation validateur
│
├── tests/                      # Tests d'intégration
├── docs/                       # Documentation
│
├── devnet-token-spl.json       # Config token root
├── devnet-token-secondary.json # Config token secondaire
├── devnet-token-mayhem.json    # Config token mayhem
└── asdf_dat.json               # IDL du programme
```

---

## Instructions Smart Contract (21 total)

### Core Operations
| Instruction | Description |
|-------------|-------------|
| `initialize` | Initialise DAT state et authority PDAs |
| `initialize_token_stats` | Crée le tracking par token |
| `collect_fees` | Collecte SOL depuis Pump.fun vault |
| `execute_buy` | Achète des tokens avec le SOL collecté |
| `burn_and_update` | Brûle les tokens et met à jour les stats |
| `finalize_allocated_cycle` | Finalise un cycle orchestré |

### Ecosystem Management
| Instruction | Description |
|-------------|-------------|
| `set_root_token` | Configure le token root pour le fee split |
| `update_fee_split` | Ajuste le ratio de distribution (1000-9000 bps) |
| `register_validated_fees` | Enregistre les fees validés par le daemon |
| `sync_validator_slot` | Synchronise l'état du validateur |

### Token Creation
| Instruction | Description |
|-------------|-------------|
| `create_pumpfun_token` | Crée un token SPL standard |
| `create_pumpfun_token_mayhem` | Crée un token Mayhem (Token-2022) |

### Administration
| Instruction | Description |
|-------------|-------------|
| `emergency_pause` | Pause toutes les opérations |
| `resume` | Reprend après une pause |
| `update_parameters` | Modifie les paramètres système |
| `transfer_admin` | Transfère l'autorité admin |

---

## Configuration

### Token Configs

Chaque token est configuré via un fichier JSON :

```json
{
  "mint": "rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr",
  "bondingCurve": "HDHVCfjbnxX3EzAhDpHj1Coiooq7yEPBXp74CDtkvCap",
  "creator": "4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd",
  "symbol": "DATSPL",
  "isRoot": true,
  "mayhemMode": false,
  "network": "devnet"
}
```

### Variables d'Environnement

```bash
# .env
RPC_URL=https://api.devnet.solana.com
WALLET_PATH=./devnet-wallet.json
```

---

## Fee Distribution

### Tokens Secondaires (55.2% / 44.8%)

```
Allocation reçue: 100%
    │
    ├── 55.2% → Buyback du token secondaire
    │
    └── 44.8% → Root Treasury
                    │
                    └── Buyback du token root
```

### Token Root (100%)

```
Fees collectés: 100%
    │
    └── 100% → Buyback du token root
```

---

## Scripts Principaux

### Cycle Écosystème
```bash
# Exécute le cycle complet sur tous les tokens
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json
```

### Génération de Volume
```bash
# Génère des trades pour accumuler des fees
# Args: <token-config> <rounds> <amount-sol>
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 10 0.1
```

### Monitoring
```bash
# Statistiques des tokens
npx ts-node scripts/check-current-stats.ts

# État du protocole
npx ts-node scripts/check-dat-state.ts

# Balance du vault
npx ts-node scripts/check-creator-vault.ts devnet-token-spl.json
```

### Vente de Tokens
```bash
# Vendre tous les tokens SPL
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json

# Vendre les tokens Mayhem
npx ts-node scripts/sell-mayhem-tokens.ts devnet-token-mayhem.json
```

---

## Sécurité

### TESTING_MODE

```rust
// programs/asdf-dat/src/lib.rs:97
pub const TESTING_MODE: bool = true;  // ⚠️ MUST BE false FOR MAINNET
```

| Mode | Cycle Interval | AM/PM Limits | Min Fees |
|------|----------------|--------------|----------|
| `true` (devnet) | Disabled | Disabled | Disabled |
| `false` (mainnet) | 60s min | Enforced | 10 SOL |

### Fichiers Sensibles (gitignored)

- `devnet-wallet.json` / `mainnet-wallet.json`
- `wallet.json`
- `ASDF*.json` (program keypairs)
- `*.key` / `*.pem`

---

## Déploiement Mainnet

### Checklist

- [ ] `TESTING_MODE = false` dans lib.rs
- [ ] Nouvelle program keypair (ne jamais réutiliser devnet)
- [ ] RPC endpoint mainnet configuré
- [ ] Wallet mainnet sécurisé
- [ ] Token configs mainnet créés
- [ ] Tests sur mainnet-beta effectués
- [ ] Monitoring/alerting configuré

### Commandes

```bash
# Build avec TESTING_MODE = false
anchor build

# Deploy mainnet
anchor deploy --provider.cluster mainnet

# Update IDL
cp target/idl/asdf_dat.json .
```

---

## Dépendances

### Rust
- `anchor-lang` = "0.31.1"
- `anchor-spl` = "0.31.1"

### TypeScript
- `@coral-xyz/anchor` = "0.31.1"
- `@solana/web3.js` = "^1.91.0"
- `@pump-fun/pump-sdk` = "^1.22.1"
- `@pump-fun/pump-swap-sdk` = "^1.7.7"

---

## Documentation

| Document | Description |
|----------|-------------|
| [AUDIT-REPORT-2025-11-25.md](AUDIT-REPORT-2025-11-25.md) | Audit professionnel complet |
| [PRODUCTION-WORKFLOW.md](PRODUCTION-WORKFLOW.md) | Guide de production |
| [QUICK_START_DEVNET.md](QUICK_START_DEVNET.md) | Guide de démarrage rapide |
| [PUMPFUN_DEVNET_GUIDE.md](PUMPFUN_DEVNET_GUIDE.md) | Intégration Pump.fun |
| [MAYHEM-MODE-LAUNCH-GUIDE.md](MAYHEM-MODE-LAUNCH-GUIDE.md) | Guide Mayhem Mode |

---

## Métriques

| Composant | Fichiers | Lignes |
|-----------|----------|--------|
| Smart Contract | 2 | 2,559 |
| Scripts | 56 | 13,748 |
| Utilities | 5 | 1,509 |
| Documentation | 20+ | 4,835+ |
| **Total** | **89+** | **~23,000** |

---

## Adresses (Devnet)

| Élément | Adresse |
|---------|---------|
| **Program ID** | `ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ` |
| **PumpSwap** | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| **Pump.fun** | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| **Token-2022** | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |

---

## Licence

Projet privé. Contacter l'équipe pour toute question.

---

**Built with [Anchor](https://anchor-lang.com) on [Solana](https://solana.com)**
