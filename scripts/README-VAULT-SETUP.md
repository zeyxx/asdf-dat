# Creator Vault Setup Guide

## Problem

The DAT `collect_fees` function requires a **creator vault** with fees to collect. The vault is created automatically when someone trades the token on PumpFun.

## Solution: Make a Trade

You need to buy a small amount of tokens to:
1. ✅ Create the creator vault ATA
2. ✅ Generate initial fees (~0.01% of trade)
3. ✅ Enable `collect_fees` to work

## Steps

### 1. Check Current Vault Status

```bash
npx ts-node scripts/init-creator-vault.ts
```

### 2. Create the Vault (Choose One)

#### Option A: PumpFun Devnet UI (Easiest)

1. Find PumpFun devnet interface
2. Search for your token: `1kJvz2NnAa3bEQ1Ro8Y9amCyySRZwHSeJ4DwNcMjvhM`
3. Buy 0.01-0.1 SOL worth of tokens
4. Vault is created automatically with fees

#### Option B: Programmatic Buy (Advanced)

```bash
# Adapt the existing buy script
npx ts-node tests/scripts/buy-with-idl.ts
```

You'll need to:
- Update token mint to match yours
- Ensure you have the PumpFun program IDL
- Or use @pump-fun/pump-swap-sdk directly

#### Option C: Manual SOL Transfer (Not Recommended)

You can manually fund the vault, but this doesn't simulate real conditions.

### 3. Verify Vault Was Created

```bash
npx ts-node scripts/init-creator-vault.ts
```

Should show:
```
✅ Creator Vault EXISTS!
💰 Balance: 0.000100 SOL
```

### 4. Run Full Cycle Test

```bash
npx ts-node tests/scripts/test-dat-cycle.ts
```

## Key Addresses

- **Token Mint**: `1kJvz2NnAa3bEQ1Ro8Y9amCyySRZwHSeJ4DwNcMjvhM`
- **Bonding Curve**: `7CVS16pQuMsDxD5bQjYnGBn5VTjWKDFKkFXAY2bu4bmg`
- **Vault Authority**: `3MyrTLHVh4d45ff3QJiwPEfyJhjikDunYAfDQPww4Zbt`
- **Creator Vault**: `FXmmUBiD7U6sngPN4ZXaWPHDh2qycpMFeoBAPNedQXpP`
- **DAT Authority**: `6r5gW93qREotZ9gThTV7SAcekCRaBrua6e1YSxirfNDs`

## Troubleshooting

### "Creator Vault DOES NOT EXIST"

- No one has traded the token yet
- Follow "Create the Vault" steps above

### "Vault has insufficient fees"

- Vault exists but balance < 0.01 SOL
- Make another trade to add more fees
- Or adjust test minimum threshold

### "AccountNotInitialized" error

- Same as "Creator Vault DOES NOT EXIST"
- The ATA hasn't been created yet
