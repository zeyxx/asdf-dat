# ASDF-DAT Scripts

This directory contains operational scripts for the ASDF-DAT ecosystem.

**Total scripts**: 24 (cleaned from 55)
**Last updated**: 2025-11-30

---

## Quick Reference

| Script | Purpose | Network |
|--------|---------|---------|
| `execute-ecosystem-cycle.ts` | Run complete DAT cycle | devnet/mainnet |
| `monitor-ecosystem-fees.ts` | Background fee daemon | devnet/mainnet |
| `check-current-stats.ts` | View token stats | devnet/mainnet |

---

## Core Operations (6 scripts)

### execute-ecosystem-cycle.ts
**Main orchestrator for DAT ecosystem cycles.**

Executes the complete fee collection and buyback cycle for all tokens:
1. Triggers daemon flush to sync pending fees
2. Collects fees from creator vault
3. Distributes proportionally to each token
4. Executes buyback on each secondary token
5. Executes buyback on root token (44.8% share)
6. Burns purchased tokens

```bash
npx ts-node scripts/execute-ecosystem-cycle.ts <root-token-config> --network devnet
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet
```

### monitor-ecosystem-fees.ts
**Background daemon for real-time fee monitoring.**

Continuously polls bonding curves to attribute fees to correct tokens (solves shared vault problem). Persists state to `.daemon-state.json` for crash recovery.

```bash
# Start daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet

# Or with PM2
pm2 start scripts/monitor-ecosystem-fees.ts --name "asdf-daemon" \
  --interpreter="npx" --interpreter-args="ts-node" -- --network devnet
```

**API Endpoints:**
- `POST /flush` - Force flush pending fees
- `GET /status` - Basic daemon status
- `GET /metrics` - Prometheus format metrics
- `GET /stats` - JSON detailed statistics
- `GET /health` - Health check endpoint

### generate-volume.ts
**Generate trading volume for testing.**

Executes multiple buy transactions to accumulate creator fees.

```bash
npx ts-node scripts/generate-volume.ts <token-config> <num-buys> <sol-per-buy>
npx ts-node scripts/generate-volume.ts devnet-tokens/02-fs1.json 2 0.5
```

### sell-spl-tokens-simple.ts
**Sell all SPL tokens of a given mint.**

```bash
npx ts-node scripts/sell-spl-tokens-simple.ts <token-config>
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-tokens/02-fs1.json
```

### sell-mayhem-tokens.ts
**Sell all Token2022 (Mayhem mode) tokens.**

```bash
npx ts-node scripts/sell-mayhem-tokens.ts
```

### buy-single-token.ts
**Execute a single token purchase.**

```bash
npx ts-node scripts/buy-single-token.ts <token-config> <sol-amount>
```

---

## Initialization (6 scripts)

### init-dat-state.ts
**Initialize global DAT state account.**

One-time setup that creates the DATState PDA with program configuration.

```bash
npx ts-node scripts/init-dat-state.ts --network devnet
```

### init-token-stats.ts
**Initialize per-token statistics tracking.**

Creates TokenStats PDA for a token. Required before token can participate in cycles.

```bash
npx ts-node scripts/init-token-stats.ts <token-config> --network devnet
npx ts-node scripts/init-token-stats.ts devnet-tokens/02-fs1.json --network devnet
```

### init-pool-accounts.ts
**Initialize pool accounts and ATAs.**

Creates necessary Associated Token Accounts for bonding curve interactions. Auto-detects token type (SPL or Token2022).

```bash
npx ts-node scripts/init-pool-accounts.ts <token-config> --network devnet
```

### init-spl-pool-accounts.ts
**Initialize SPL-specific pool accounts.**

```bash
npx ts-node scripts/init-spl-pool-accounts.ts <token-config> --network devnet
```

### set-root-token.ts
**Configure the root token for the ecosystem.**

Sets which token receives the 44.8% share from all secondary tokens.

```bash
npx ts-node scripts/set-root-token.ts <root-token-config> --network devnet
npx ts-node scripts/set-root-token.ts devnet-tokens/01-froot.json --network devnet
```

### initialize-validators.ts
**Initialize ValidatorState accounts.**

Sets up trustless fee attribution infrastructure for each token.

```bash
npx ts-node scripts/initialize-validators.ts --network devnet
```

---

## Diagnostics (6 scripts)

### check-current-stats.ts
**Display real-time TokenStats for all configured tokens.**

Shows pending_fees, total_burned, cycles_participated for each token.

```bash
npx ts-node scripts/check-current-stats.ts --network devnet
```

### check-dat-state.ts
**Display global DAT configuration.**

Shows fee split ratio, root token setting, admin status.

```bash
npx ts-node scripts/check-dat-state.ts --network devnet
```

### check-fees.ts
**Show accumulated fees in creator vault and root treasury.**

```bash
npx ts-node scripts/check-fees.ts --network devnet
```

### check-token-balances.ts
**Display current wallet token balances.**

```bash
npx ts-node scripts/check-token-balances.ts --network devnet
```

### view-fee-distribution.ts
**Comprehensive fee distribution state overview.**

```bash
npx ts-node scripts/view-fee-distribution.ts --network devnet
```

### read-cycle-events.ts
**Parse and display CycleCompleted events from transaction logs.**

```bash
npx ts-node scripts/read-cycle-events.ts <transaction-signature>
```

---

## Utilities (6 scripts)

### validate-tokens.ts
**Validate token configuration files.**

Uses Zod schema to validate configuration files and check ecosystem consistency.

```bash
npx ts-node scripts/validate-tokens.ts devnet-tokens/
npx ts-node scripts/validate-tokens.ts --network devnet --verbose
```

### complete-ecosystem-validation.ts
**Comprehensive ecosystem test framework.**

Captures initial/final state, generates volume, executes cycles, produces detailed report.

```bash
npx ts-node scripts/complete-ecosystem-validation.ts --network devnet
```

### create-token-spl.ts
**Create new SPL token on PumpFun.**

```bash
npx ts-node scripts/create-token-spl.ts --network devnet
```

### create-token-mayhem.ts
**Create new Token2022 token (Mayhem mode).**

```bash
npx ts-node scripts/create-token-mayhem.ts --network devnet
```

### transfer-program-authority.ts
**Transfer admin and/or upgrade authority.**

```bash
npx ts-node scripts/transfer-program-authority.ts <new-admin> --network mainnet
```

### start-validator.ts
**Start the validator daemon for trustless fee attribution.**

```bash
npx ts-node scripts/start-validator.ts --network devnet
```

---

## Common Workflows

### Testing a Complete Cycle (Devnet)

```bash
# 1. Start daemon (if not running)
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# 2. Generate volume (buy + sell cycles)
npx ts-node scripts/generate-volume.ts devnet-tokens/02-fs1.json 2 0.5
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-tokens/02-fs1.json

# 3. Wait for daemon sync
sleep 15

# 4. Check fees accumulated
npx ts-node scripts/check-current-stats.ts --network devnet

# 5. Execute cycle
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet
```

### Adding a New Token

```bash
# 1. Create token on pump.fun and save config to devnet-tokens/
# 2. Validate config
npx ts-node scripts/validate-tokens.ts devnet-tokens/

# 3. Initialize TokenStats
npx ts-node scripts/init-token-stats.ts devnet-tokens/new-token.json --network devnet

# 4. Initialize pool accounts
npx ts-node scripts/init-pool-accounts.ts devnet-tokens/new-token.json --network devnet

# 5. Restart daemon to pick up new token
```

### Mainnet Deployment

See [docs/MAINNET_DEPLOYMENT_SOP.md](../docs/MAINNET_DEPLOYMENT_SOP.md) for complete procedure.

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SOLANA_RPC_DEVNET` | Devnet RPC URL | Yes |
| `SOLANA_RPC_MAINNET` | Mainnet RPC URL | Mainnet only |
| `HELIUS_API_KEY` | Helius API key for enhanced RPC | Recommended |
| `DEVNET_WALLET_PATH` | Path to devnet wallet | Devnet |
| `MAINNET_WALLET_PATH` | Path to mainnet wallet | Mainnet |

---

## Troubleshooting

### "Insufficient fees"
- `pending_fees` below minimum threshold (0.0055 SOL per secondary)
- Solution: Generate more volume or wait for daemon sync

### "Cycle too soon"
- Minimum 60 seconds between cycles
- Solution: Wait and retry

### "Daemon lock exists"
- Another daemon instance running or crashed
- Solution: Check process with `ps aux | grep monitor` or delete `.daemon-lock.json`

### "RPC rate limited"
- Too many requests to RPC
- Solution: Use Helius or dedicated RPC, add delays between operations

---

## Scripts Cleanup History

| Date | Scripts | Change |
|------|---------|--------|
| 2025-11-30 | 55 → 24 | Removed 31 obsolete/redundant scripts |
| 2025-11-27 | ~40 | Previous cleanup |
| 2025-11-23 | 37 → 18 | Initial cleanup |
