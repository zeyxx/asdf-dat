# ASDF Burn Engine Scripts

Core operational scripts for the Optimistic Burn Protocol.

## Quick Start

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=./devnet-wallet.json
```

## Core Operations

| Script | Purpose |
|--------|---------|
| `monitor-ecosystem-fees.ts` | Fee attribution daemon |
| `execute-ecosystem-cycle.ts` | Execute flush cycle |
| `cycle-trigger-bot.ts` | Auto-trigger on threshold |

```bash
# Start daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet

# Execute cycle
npx ts-node scripts/execute-ecosystem-cycle.ts --network devnet
```

## Token Management

| Script | Purpose |
|--------|---------|
| `create-token-v2.ts` | Create Token2022 token |
| `init-token-stats.ts` | Initialize token stats |
| `set-root-token.ts` | Configure root token |

```bash
# Create token (with optional vanity mint)
npx ts-node scripts/create-token-v2.ts "Name" "SYM" "path.json" --network devnet
npx ts-node scripts/create-token-v2.ts "ASDF" "ASDF" "token.json" --vanity-pool http://localhost:3030
```

## Initialization (Run Once)

| Script | Purpose |
|--------|---------|
| `init-dat-state.ts` | Initialize DAT program |
| `initialize-rebate-pool.ts` | Initialize rebate pool |

## Volume Testing

| Script | Purpose |
|--------|---------|
| `generate-volume.ts` | Generate buy volume |
| `sell-spl-tokens-simple.ts` | Sell tokens |

```bash
# Generate fees (buy + sell = fees both directions)
npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 2 0.5 --network devnet
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-tokens/01-froot.json --network devnet
```

## Diagnostics

| Script | Purpose |
|--------|---------|
| `check-dat-state.ts` | Check DAT state |
| `check-fees.ts` | Check pending fees |

## Admin & Validation

| Script | Purpose |
|--------|---------|
| `transfer-admin.ts` | Transfer admin rights |
| `validate-before-mainnet-launch.ts` | Pre-mainnet validation |
| `monitor-health-mainnet.ts` | Mainnet health check |

## Archived Scripts

Additional scripts in `scripts/archive/` for specific use cases:
- `check/` - Additional diagnostic tools
- `init/` - One-time initialization scripts
- `validate/` - Validation utilities
- `volume/` - Volume generation variants
- `mayhem/` - Token2022 Mayhem Mode scripts
- `test/` - Test scripts
- `utils/` - Utility scripts

---

*Flush. Burn. Verify.* 🔥
