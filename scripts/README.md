# ASDF-DAT Scripts

Operational scripts for the Optimistic Burn Protocol.

---

## Quick Reference

```bash
# Set environment (required for all scripts)
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=./devnet-wallet.json

# Or for mainnet:
export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
export ANCHOR_WALLET=./mainnet-wallet.json
```

---

## Core Operations (Production)

### Ecosystem Cycle Orchestrator
```bash
# Execute full ecosystem cycle (secondaries + root + rebate)
npx ts-node scripts/execute-ecosystem-cycle.ts --network devnet
```

### Fee Monitoring Daemon
```bash
# Start fee attribution daemon (runs continuously)
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &
```

### Automated Cycle Trigger
```bash
# Start autonomous cycle trigger (threshold-based)
npx ts-node scripts/cycle-trigger-bot.ts --network devnet &
```

### Health Monitoring
```bash
# Monitor system health (mainnet)
npx ts-node scripts/monitor-health-mainnet.ts --network mainnet
```

---

## Initialization (Run Once)

### DAT State
```bash
# Initialize global DAT state
npx ts-node scripts/init-dat-state.ts --network devnet
```

### Token Stats
```bash
# Initialize per-token statistics
npx ts-node scripts/init-token-stats.ts devnet-tokens/01-froot.json --network devnet
```

### Root Token
```bash
# Set root token (receives 44.8% of secondary fees)
npx ts-node scripts/set-root-token.ts devnet-tokens/01-troot.json --network devnet
```

### Rebate Pool
```bash
# Initialize rebate pool for external app integration
npx ts-node scripts/initialize-rebate-pool.ts --network devnet
```

### Validators
```bash
# Initialize validator accounts for trustless fee tracking
npx ts-node scripts/initialize-validators.ts --network devnet
```

---

## Volume Generation (Testing)

### Rapid Volume (Recommended)
```bash
# Generate volume with buy+sell cycles (most efficient)
npx ts-node scripts/rapid-volume.ts devnet-tokens/01-froot.json 5 0.5 --network devnet
```

### Standard Volume
```bash
# Generate buy-only volume
npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 2 0.5 --network devnet
```

### Sell Tokens
```bash
# Sell accumulated tokens
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-tokens/01-froot.json --network devnet
```

### Mayhem Mode (Token2022)
```bash
# Buy Token2022 tokens
npx ts-node scripts/buy-mayhem-tokens.ts devnet-tokens/05-tmay.json --network devnet

# Sell Token2022 tokens
npx ts-node scripts/sell-mayhem-tokens.ts devnet-tokens/05-tmay.json --network devnet
```

---

## Diagnostics (Read-Only)

### Check DAT State
```bash
npx ts-node scripts/check-dat-state.ts --network devnet
```

### Check Token Stats
```bash
npx ts-node scripts/check-current-stats.ts --network devnet
```

### Check Pending Fees
```bash
npx ts-node scripts/check-fees.ts --network devnet
```

### Check Creator Vault
```bash
npx ts-node scripts/check-creator-vault.ts devnet-tokens/01-froot.json --network devnet
```

### Check Token Balances
```bash
npx ts-node scripts/check-token-balances.ts --network devnet
```

### View Fee Distribution
```bash
npx ts-node scripts/view-fee-distribution.ts --network devnet
```

---

## Admin Operations

### Transfer Admin
```bash
npx ts-node scripts/transfer-admin.ts <new-admin-pubkey> --network devnet
```

### Update Fee Split
```bash
npx ts-node scripts/update-fee-split.ts <new-bps> --network devnet
```

### Update Config
```bash
npx ts-node scripts/update-dat-config.ts --network devnet
```

---

## Token Creation (Devnet)

### Create SPL Token
```bash
npx ts-node scripts/create-devnet-token.ts --name "MyToken" --symbol "MTK" --network devnet
```

### Create Token2022 (Mayhem)
```bash
npx ts-node scripts/create-devnet-mayhem-token.ts --name "MayhemToken" --symbol "MAY" --network devnet
```

---

## Validation (Pre-Deploy)

### Validate Before Mainnet
```bash
npx ts-node scripts/validate-before-mainnet-launch.ts --network mainnet
```

### Verify Infrastructure
```bash
npx ts-node scripts/verify-mainnet-infrastructure.ts
```

### Validate Token Configs
```bash
npx ts-node scripts/validate-tokens.ts --network devnet
```

---

## Testing

### Complete Ecosystem Validation
```bash
npx ts-node scripts/complete-ecosystem-validation.ts --network devnet
```

### Test External App Deposit
```bash
npx ts-node scripts/test-deposit-fee-asdf.ts --network devnet
```

### Test User Rebate
```bash
npx ts-node scripts/test-process-user-rebate.ts --network devnet
```

---

## Recovery

### Rollback Failed Cycle
```bash
npx ts-node scripts/rollback-cycle.ts --network devnet
```

---

## Directory Structure

```
scripts/
├── execute-ecosystem-cycle.ts    # Main orchestrator
├── monitor-ecosystem-fees.ts     # Fee daemon
├── cycle-trigger-bot.ts          # Auto-trigger
├── init-*.ts                     # Initialization
├── check-*.ts                    # Diagnostics
├── validate-*.ts                 # Validation
├── generate-volume.ts            # Volume gen
├── rapid-volume.ts               # Fast volume
├── test-*.ts                     # Active tests
├── archive/                      # Deprecated scripts
│   ├── buy-sell/                 # Old buy/sell variants
│   ├── create-token/             # Old token creation
│   ├── execution/                # Old cycle execution
│   ├── test/                     # Archived tests
│   └── utils/                    # Deprecated utilities
└── README.md                     # This file
```

---

## Script Categories

| Category | Scripts | Purpose |
|----------|---------|---------|
| **CORE** | execute-ecosystem-cycle, monitor-ecosystem-fees, cycle-trigger-bot | Production operations |
| **INIT** | init-dat-state, init-token-stats, set-root-token, initialize-* | One-time setup |
| **CHECK** | check-*, view-fee-distribution | Read-only diagnostics |
| **VOLUME** | generate-volume, rapid-volume, sell-* | Trading activity |
| **ADMIN** | transfer-admin, update-* | Governance |
| **VALIDATE** | validate-*, verify-* | Pre-deployment checks |
| **TEST** | test-*, complete-ecosystem-validation | Testing |

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ANCHOR_PROVIDER_URL` | RPC endpoint | `https://api.devnet.solana.com` |
| `ANCHOR_WALLET` | Wallet file path | `./devnet-wallet.json` |
| `--network` | Network flag | `devnet` or `mainnet` |

---

## Archived Scripts

Scripts in `archive/` are deprecated but kept for reference:

- **buy-sell/**: Superseded by `rapid-volume.ts`
- **create-token/**: Superseded by `create-devnet-token.ts`
- **execution/**: Superseded by `execute-ecosystem-cycle.ts`
- **test/**: Old test scripts (use `complete-ecosystem-validation.ts`)
- **utils/**: Deprecated utilities

---

*Flush. Burn. Verify.* 🔥🐕
