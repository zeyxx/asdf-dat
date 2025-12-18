# ASDF Burn Engine

Optimistic burn protocol for sustainable token economics.

## Quick Reference

```
Program ID: ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui
```

| Constant | Value | Description |
|----------|-------|-------------|
| `FLUSH_THRESHOLD` | 0.1 SOL | Minimum to trigger cycle |
| `MIN_CYCLE_INTERVAL` | 60s | Cooldown between cycles |
| `FEE_SPLIT_BPS` | 5520 | 55.2% keep / 44.8% to root |
| `DEV_FEE_BPS` | 100 | 1% on secondaries only |

## Architecture

```
Volume → Creator Fees → Daemon Attributes → Flush Cycle → Buyback & Burn
```

**Root Token**: 100% burn (no split, no dev fee)
**Secondary Tokens**: 55.2% burn + 44.8% to root treasury, 1% dev fee

## PDA Seeds

| Account | Seeds |
|---------|-------|
| DAT State | `["dat_v3"]` |
| DAT Authority | `["auth_v3"]` |
| Token Stats | `["token_stats_v1", mint]` |
| Root Treasury | `["root_treasury", root_mint]` |

## Scripts

```bash
# Monitor fees (daemon)
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet

# Execute flush cycle
npx ts-node scripts/execute-ecosystem-cycle.ts --network devnet

# Generate volume (devnet testing)
npx ts-node scripts/generate-volume.ts TOKEN_SYMBOL ROUNDS SOL_AMOUNT
```

## Documentation

See `docs/` for detailed documentation:
- `ARCHITECTURE.md` - System design
- `DEVELOPER_GUIDE.md` - Development setup
- `OPERATIONS.md` - Day-to-day operations
- `FORMAL_SPEC.md` - Mathematical specification

## Principles

1. **Don't trust, verify** - Always check on-chain state
2. **Creation > Extraction** - We burn, not print
3. **Test before mainnet** - Devnet first, always

---

*Collect. Burn. This is fine.* 🔥
