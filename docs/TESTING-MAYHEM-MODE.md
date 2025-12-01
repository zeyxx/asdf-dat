# Testing Mayhem Mode

## Important Note

**Mayhem Mode is MAINNET ONLY** - The AI agent that trades for 24 hours is only available on Solana mainnet. Devnet does not have the Mayhem Mode AI agent.

## Pre-Launch Validation

Before launching a Mayhem Mode token on mainnet, use the validation script to check all prerequisites:

```bash
npm run validate-mayhem
```

This script checks:

1. ✅ **TESTING_MODE flag** - Must be `false` for mainnet
2. ✅ **NFT.Storage API key** - For metadata upload
3. ✅ **Token image** - Image file exists
4. ✅ **Mainnet wallet** - Wallet exists with sufficient SOL (0.5+)
5. ✅ **DAT configuration** - DAT initialized on mainnet
6. ✅ **Program build** - IDL and binary compiled
7. ✅ **Dependencies** - npm packages installed

### Validation Results

The script will output:
- 🔴 **Critical failures**: Must be fixed before launch
- ⚠️ **Warnings**: Recommended to fix, but not blocking
- ✅ **Passed checks**: All good

Exit codes:
- `0` - All critical checks passed, ready to launch
- `1` - Critical failures present, NOT ready to launch

## Testing Strategy

Since Mayhem Mode requires mainnet, the testing strategy is:

### 1. Validate Prerequisites (Devnet-compatible)

```bash
# Run validation script
npm run validate-mayhem
```

Fix any critical issues flagged by the validator.

### 2. Test Normal Token Creation on Devnet

Before using Mayhem Mode on mainnet, test the normal token creation flow on devnet:

```bash
# Test normal token creation (without Mayhem)
npx ts-node scripts/create-token-via-dat.ts
```

This verifies:
- Program deployed correctly
- DAT is initialized
- PDA derivations are correct
- Token creation works

### 3. Dry Run on Mainnet (Optional)

If you want extra confidence, you can:

1. Set up a test mainnet wallet with minimal SOL (0.1 SOL)
2. Run the validation script
3. Review the code flow in `scripts/launch-mayhem-token.ts`
4. Ensure you understand what will happen

**DO NOT** actually execute the launch unless you're ready for a real token!

### 4. Launch on Mainnet

When ready:

```bash
# Final validation
npm run validate-mayhem

# If all checks pass:
npx ts-node scripts/launch-mayhem-token.ts
```

## Checklist Before Launch

Use this checklist before launching:

- [ ] Ran `npm run validate-mayhem` - all critical checks passed
- [ ] TESTING_MODE set to `false` in `programs/asdf-dat/src/lib.rs`
- [ ] Program compiled with `anchor build`
- [ ] Mainnet wallet created with 0.5+ SOL
- [ ] DAT initialized on mainnet (`config/mainnet-dat-deployment.json` exists)
- [ ] Token image created and placed at `./token-image.png`
- [ ] NFT.Storage API key obtained and set (`export NFT_STORAGE_API_KEY="..."`)
- [ ] Token metadata customized in `scripts/launch-mayhem-token.ts`
- [ ] Social media accounts ready (Twitter, Telegram)
- [ ] Website or landing page ready
- [ ] Communication plan prepared
- [ ] Backup of all important files (wallet, configs)

## What Happens During Launch

1. **Metadata Upload**
   - Token image uploaded to IPFS via NFT.Storage
   - Metadata JSON created and uploaded to IPFS
   - IPFS URIs generated

2. **Token Creation**
   - Mint account created (Token2022 program)
   - 2 billion tokens minted (1B + 1B for AI agent)
   - Bonding curve initialized
   - Mayhem Mode activated

3. **AI Agent Activation**
   - AI agent receives 1 billion tokens
   - Begins automated trading for 24 hours
   - Generates volume and liquidity
   - Accumulates fees in creator vault

4. **Post-Launch**
   - Transaction details saved to `mainnet-mayhem-token-info.json`
   - Monitor on Solscan and PumpFun
   - Watch AI agent trading activity

## Monitoring After Launch

### Check Token on Solscan

```
https://solscan.io/token/YOUR_MINT_ADDRESS
```

### Check on PumpFun

```
https://pump.fun/YOUR_TOKEN_ADDRESS
```

### Monitor Creator Vault

```bash
npx ts-node scripts/init-creator-vault.ts
```

### View Recent Transactions

Check Solscan for:
- Token creation transaction
- AI agent trades
- Fee accumulation
- Bonding curve state

## Expected Behavior

### First 24 Hours
- 🤖 AI agent actively trading
- 📈 Volume increasing
- 💰 Fees accumulating in creator vault
- 📊 Price fluctuating (normal)

### After 24 Hours
- 🔥 AI agent burns remaining tokens
- ✅ Creator vault contains collected fees
- 🔄 DAT can begin buyback-and-burn cycles
- 📊 Token available for public trading

## Troubleshooting

### Validation Script Fails

**"TESTING_MODE: Set to TRUE"**
- Edit `programs/asdf-dat/src/lib.rs` line 59
- Change to `pub const TESTING_MODE: bool = false;`
- Recompile: `anchor build`

**"Wallet File: Not found"**
- Create wallet: `solana-keygen new -o mainnet-wallet.json`
- Fund wallet: `solana transfer <ADDRESS> 0.5 --url mainnet-beta`

**"DAT Config: Not found"**
- Initialize DAT: `NETWORK=mainnet npm run init`

**"NFT_STORAGE_API_KEY: Not set"**
- Get API key from https://nft.storage
- Set: `export NFT_STORAGE_API_KEY="your-key"`

**"Token Image: Not found"**
- Create image: 512x512 or 1024x1024 PNG/JPG
- Save as `./token-image.png`

### Launch Fails

**"Insufficient balance"**
- Add more SOL: Minimum 0.5 SOL recommended

**"Transaction failed"**
- Check Solscan for error details
- Verify all accounts are correct
- Ensure program is deployed

**"Invalid PDA"**
- Verify network (mainnet vs devnet)
- Check PDA derivation in script

## Safety Tips

1. **Never commit sensitive files**
   - `mainnet-wallet.json`
   - `.env` files
   - Private keys

2. **Always backup**
   - Wallet JSON
   - Token info JSON
   - Config files

3. **Start small**
   - Test on devnet first (normal mode)
   - Use minimal SOL for first launch
   - Verify everything works before scaling

4. **Monitor closely**
   - Watch first few hours
   - Check AI agent activity
   - Verify fees accumulating

## Additional Resources

- [Mayhem Mode Launch Guide (English)](../MAYHEM-MODE-LAUNCH-GUIDE-EN.md)
- [Mayhem Mode Launch Guide (Français)](../MAYHEM-MODE-LAUNCH-GUIDE.md)
- [Metadata Upload Guide](./METADATA-UPLOAD-GUIDE.md)
- [Mayhem Mode Implementation](../MAYHEM-MODE-IMPLEMENTATION.md)

## Support

If you encounter issues:
1. Run `npm run validate-mayhem` to identify problems
2. Check error logs in console
3. Verify transaction on Solscan
4. Review documentation
5. Check configuration files

---

**Remember**: Mayhem Mode is a high-risk, high-reward feature. The AI agent creates guaranteed volume, but also significant volatility. Plan accordingly!
