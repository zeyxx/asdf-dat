# Mainnet Token Configurations

This directory contains token configuration files for the mainnet DAT ecosystem.

## File Naming Convention

Files are numbered in order of priority/processing:
- `01-root.json` - Root token (receives 44.8% of all secondary fees)
- `02-secondary-1.json` - First secondary token
- `03-secondary-2.json` - Second secondary token
- etc.

## Configuration Schema

Each token config file must contain:

```json
{
  "mint": "TokenMintAddress...",
  "bondingCurve": "BondingCurveOrPoolAddress...",
  "pool": "BondingCurveOrPoolAddress...",
  "creator": "CreatorAddress...",
  "name": "Token Name",
  "symbol": "SYMBOL",
  "uri": "https://pump.fun/coin/...",
  "isRoot": true|false,
  "mayhemMode": false,
  "tokenProgram": "SPL"|"Token2022",
  "poolType": "bonding_curve"|"pumpswap_amm",
  "network": "mainnet"
}
```

## Field Descriptions

| Field | Description |
|-------|-------------|
| `mint` | Token mint address |
| `bondingCurve` | Bonding curve or pool address (for BC tokens) |
| `pool` | Pool address (alias for bondingCurve, for AMM tokens) |
| `creator` | Creator wallet that receives fees |
| `name` | Human-readable token name |
| `symbol` | Token symbol (max 8 chars) |
| `uri` | Token metadata URI |
| `isRoot` | `true` for root token, `false` for secondaries |
| `mayhemMode` | Token2022 with extensions flag |
| `tokenProgram` | `SPL` or `Token2022` |
| `poolType` | `bonding_curve` (pre-migration) or `pumpswap_amm` (post) |
| `network` | Must be `mainnet` |

## Security Notes

- **NEVER commit actual token configs to git** (they're in .gitignore)
- Token configs contain sensitive addresses
- Keep backups in secure storage
- Use `.json.example` for templates

## Adding New Tokens

1. Copy `token.json.example` to `XX-name.json`
2. Fill in all required fields
3. Run `init-token-stats.ts` to initialize on-chain
4. Restart daemon to auto-detect
