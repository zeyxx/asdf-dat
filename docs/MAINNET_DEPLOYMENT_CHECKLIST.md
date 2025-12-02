# Mainnet Deployment Checklist

## Pre-Deployment Status (2025-12-02)

### Infrastructure Verification (PASSED)

| Test | Status | Details |
|------|--------|---------|
| RPC Connectivity | ✅ | Helius mainnet responsive |
| Token Mints | ✅ | Both ASDF and FOUSE exist |
| Pool/BC Existence | ✅ | AMM pool and BC verified |
| Creator Vault Derivation | ✅ | Both vaults correctly derived |
| Fee Detection | ✅ | 37 fee events detected (0.025 SOL) |
| Script Config Loading | ✅ | Daemon and cycle scripts work |

### Vault Addresses (Verified)
```
ASDF (AMM Authority): HB8yfCmVdZdJQMg4Di9BVX9PTu5gqqpPaDPtDZbmp4yM
ASDF (AMM WSOL ATA): 9hf6biPF6HrxvH6KuQqXSLYCeLuDUV88wvhsxJGuq1s2
FOUSE (BC Vault):    ECo6iR6yhyjrYsU5XbiMi3VXWeGTzqaLReWbNSHMg4LH
```

### Current Vault Balances (2025-12-02)
- ASDF WSOL Vault: **0.013 WSOL** (~$2.60 at $200/SOL)
- FOUSE BC Vault: **0.00196 SOL** (~$0.39)

### Configuration Files
| File | Status | Notes |
|------|--------|-------|
| `mainnet-token-root.json` | ✅ Verified | Creator: `vcGYZbvDid6cRUkCCqcWpBxow73TLpmY6ipmDUtrTF8` |
| `mainnet-tokens/01-root.json` | ✅ Verified | Matches root config |
| `mainnet-tokens/02-fouse.json` | ✅ Verified | Creator: `dcW5uy7wKdKFxkhyBfPv3MyvrCkDcv1rWucoat13KH4` |

### Wallet
| Item | Status | Value |
|------|--------|-------|
| Wallet Address | ✅ | `8vv8XBRS5hY2w1MURLXESVASfQZgcrvokGAYhWo5Nwh5` |
| Current Balance | ✅ | 2.7 SOL |
| Min for Operations | ✅ | 0.1 SOL (covered) |
| Min for Deployment | ❌ | ~5 SOL needed |

### Environment Variables
| Variable | Status |
|----------|--------|
| `HELIUS_API_KEY` | ✅ Configured |
| `NETWORK` | ✅ Set to `mainnet` |
| `DEVNET_RPC_URL` | ✅ Configured |

### RPC Connection
| Endpoint | Status |
|----------|--------|
| Helius Mainnet | ✅ Healthy |

### On-Chain Tokens
| Token | Mint | Pool Type | Status |
|-------|------|-----------|--------|
| ASDF (Root) | `9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump` | PumpSwap AMM | ✅ Exists |
| FOUSE (Secondary) | `66jGhyM4Vtc927T99t9QFHi2iDQDz2KvVHhJ3sfFpump` | Bonding Curve | ✅ Exists |

### Program
| Item | Status | Notes |
|------|--------|-------|
| Program ID | `ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui` | Reserved |
| Deployed | ❌ | NOT on mainnet |
| Devnet | ✅ | Working |

---

## Deployment Steps

### Phase 1: Pre-Deployment
```
□ Ensure wallet balance >= 5.5 SOL
□ Anchor build --verifiable
□ Verify devnet tests pass (fresh run)
□ Backup mainnet-wallet.json (secure location)
```

### Phase 2: Program Deployment
```
□ anchor deploy --provider.cluster mainnet
□ Verify program ID matches: ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui
□ Record deployment TX signature
```

### Phase 3: State Initialization
```bash
# 1. Initialize DAT State
npx ts-node scripts/init-dat-state.ts --network mainnet

# 2. Initialize TokenStats for root token
npx ts-node scripts/init-token-stats.ts mainnet-tokens/01-root.json --network mainnet

# 3. Set root token
npx ts-node scripts/set-root-token.ts mainnet-tokens/01-root.json --network mainnet

# 4. Initialize TokenStats for secondary tokens
npx ts-node scripts/init-token-stats.ts mainnet-tokens/02-fouse.json --network mainnet
```

### Phase 4: Verification
```
□ Verify DAT State exists on-chain
□ Verify TokenStats for all tokens
□ Verify root token configuration
□ Test daemon connection (dry-run mode)
```

### Phase 5: Go Live
```
□ Start daemon in dry-run mode first
□ Monitor for fee detection
□ Execute first cycle with small amounts
□ Verify burn transactions
□ Enable production mode
```

---

## Blockers

### Critical
1. **Wallet Balance**: Need ~2.3 SOL more for safe deployment (~5.5 SOL total)

### Important
1. **Program Not Deployed**: Main deployment task pending
2. ~~**Creator Vaults**: Need to verify vault derivation once trades occur~~ ✅ VERIFIED

---

## Token Information

### ASDF (Root Token)
- **Mint**: `9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump`
- **Pool**: `DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb`
- **Creator**: `vcGYZbvDid6cRUkCCqcWpBxow73TLpmY6ipmDUtrTF8`
- **Type**: PumpSwap AMM (post-migration)
- **isCTO**: Yes

### FOUSE (Secondary Token)
- **Mint**: `66jGhyM4Vtc927T99t9QFHi2iDQDz2KvVHhJ3sfFpump`
- **Bonding Curve**: `CZs3w68ELxXwjLUuBtdR4VpkzQaKsSGcbxd9jYnDkMvT`
- **Creator**: `dcW5uy7wKdKFxkhyBfPv3MyvrCkDcv1rWucoat13KH4`
- **Type**: Bonding Curve (pre-migration)

---

## Rollback Plan

If issues occur during deployment:

1. **Program Deployment Fails**
   - Retry with higher compute budget
   - Verify wallet has sufficient SOL

2. **State Init Fails**
   - Check PDA derivation
   - Verify admin wallet is signer

3. **Token Stats Fails**
   - Verify mint addresses
   - Check token configs are correct

4. **Emergency**
   - Use `emergency-pause.ts` script
   - Admin can pause all operations

---

## Commands Reference

```bash
# Check wallet balance
solana balance --keypair mainnet-wallet.json --url mainnet-beta

# Check program status
solana program show ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui --url mainnet-beta

# Check token on-chain
solana account <MINT_ADDRESS> --url mainnet-beta

# Test RPC
curl -s "https://mainnet.helius-rpc.com/?api-key=$HELIUS_API_KEY" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Verify infrastructure (run before deployment)
npx ts-node scripts/verify-mainnet-infrastructure.ts

# Test fee detection
npx ts-node scripts/test-mainnet-fee-detection.ts

# Dry-run cycle (after program deployed)
npx ts-node scripts/execute-ecosystem-cycle.ts mainnet-token-root.json --network mainnet --dry-run
```

---

*Last Updated: 2025-12-02*
*Status: Ready for deployment when funded*
