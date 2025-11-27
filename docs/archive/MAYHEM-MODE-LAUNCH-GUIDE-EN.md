# 🔥 Mayhem Mode Launch Guide

## ✅ What's Ready

- [x] Rust program compiled with Mayhem Mode support
- [x] `create_pumpfun_token_mayhem` function implemented
- [x] `CreatePumpfunTokenMayhem` struct with all accounts
- [x] TypeScript script `launch-mayhem-token.ts`
- [x] Constants and discriminator `create_v2`
- [x] IPFS metadata upload via NFT.Storage

## 🚀 How to Launch Your Mayhem Token

### Step 1: Preparation

**1.1 Create your token image**
```bash
# Place your image in the root folder
cp /path/to/your/image.png token-image.png
```

Recommended: 512x512 or 1024x1024 PNG/JPG

**1.2 Get NFT.Storage API Key (Free)**

1. Visit [https://nft.storage](https://nft.storage)
2. Sign up for free account
3. Go to "API Keys" → "New Key"
4. Copy your API key

```bash
# Set environment variable
export NFT_STORAGE_API_KEY="your-api-key-here"

# Or add to ~/.bashrc for persistence
echo 'export NFT_STORAGE_API_KEY="your-key"' >> ~/.bashrc
source ~/.bashrc
```

**1.3 Customize the launch script**

Edit `scripts/launch-mayhem-token.ts` lines 38-46:
```typescript
const TOKEN_METADATA = {
  name: "Your Token Name",           // ← CHANGE
  symbol: "SYMBOL",                  // ← CHANGE
  description: "Your description",   // ← CHANGE
  twitter: "https://twitter.com/...", // ← CHANGE
  telegram: "https://t.me/...",      // ← CHANGE
  website: "https://...",            // ← CHANGE
  image: "./token-image.png",        // Path to your image
};
```

The script will automatically:
- Upload your image to IPFS
- Create metadata JSON with proper format
- Upload metadata to IPFS
- Use the IPFS URI when creating the token

### Step 2: Wallet Setup

**Mainnet (REAL SOL!):**
```bash
# Create mainnet wallet
solana-keygen new -o mainnet-wallet.json

# Transfer SOL
solana transfer <ADDRESS> 0.5 --url mainnet-beta

# Check balance
solana balance mainnet-wallet.json --url mainnet-beta
```

**Required:** At least **0.2-0.5 SOL** for:
- Token creation fees
- Rent exemption for accounts
- Transaction fees

### Step 3: DAT Configuration

**3.1 Verify DAT is initialized on mainnet**

Check if `config/mainnet-dat-deployment.json` exists.

If not:
```bash
# Initialize DAT on mainnet
NETWORK=mainnet npm run init
```

**3.2 Verify addresses**
```json
{
  "datState": "...",
  "datAuthority": "...",
  "admin": "...",
  ...
}
```

### Step 4: Launch! 🚀

**⚠️ CRITICAL: Disable TESTING_MODE for mainnet**

Before compiling, edit `programs/asdf-dat/src/lib.rs` line 59:
```rust
// Change from true to false!
pub const TESTING_MODE: bool = false;  // ← MUST BE FALSE FOR MAINNET
```

Why? TESTING_MODE disables security constraints (intervals, AM/PM limits, fee thresholds).

```bash
# Compile the program (if not already done)
anchor build

# Install dependencies
npm install

# LAUNCH MAYHEM TOKEN!
npx ts-node scripts/launch-mayhem-token.ts
```

### Step 5: Post-Launch

**Immediately after:**
1. ✅ Save `mainnet-mayhem-token-info.json` file
2. ✅ Note the mint address
3. ✅ Verify transaction on Solscan
4. ✅ Verify AI agent starts trading

**Within 24 hours:**
- 🤖 AI agent will trade automatically
- 📊 Volume and liquidity will increase
- 💰 Fees will accumulate in creator vault

**After 24 hours:**
- 🔥 Agent burns remaining tokens
- ✅ Creator vault has collected fees
- 🔄 DAT can start buyback-and-burn cycles

## 📊 Mayhem vs Normal Comparison

| Aspect | Normal | Mayhem |
|--------|--------|--------|
| Supply | 1B tokens | **2B tokens** |
| AI Trading | ❌ | ✅ **24h auto** |
| Initial Volume | Depends on traders | **Guaranteed by AI** |
| Creator Vault | Created on 1st trade | **Created immediately** |
| Token Program | Token | **Token2022** |
| Risk | Standard | **More volatile** |

## ⚠️ Important Points

### Security
- ✅ **CRITICAL: Set `TESTING_MODE = false` in lib.rs before mainnet build**
- ✅ Keep `mainnet-wallet.json` secure (NEVER commit!)
- ✅ Backup all important files
- ✅ Test on devnet first if possible (normal mode only)

### Costs
- 💰 Token creation: ~0.02-0.05 SOL
- 💰 Rent exemption: ~0.01 SOL
- 💰 Transaction fees: ~0.00002 SOL
- 💰 **Total estimated: ~0.1 SOL**

### Mayhem Specific
- ⚠️ AI agent will buy/sell for 24 hours
- ⚠️ Volume can be very variable
- ⚠️ Price will fluctuate (this is normal!)
- ✅ Fees guaranteed through AI trading

## 🔍 Monitoring

**During 24h Mayhem period:**

```bash
# Check creator vault
npx ts-node scripts/init-creator-vault.ts

# View transactions
# https://solscan.io/token/YOUR_MINT_ADDRESS

# Monitor on PumpFun
# https://pump.fun/YOUR_TOKEN_ADDRESS
```

## 🆘 Troubleshooting

### "NFT_STORAGE_API_KEY not set"
- Make sure you exported the environment variable
- Check: `echo $NFT_STORAGE_API_KEY`
- See: [Metadata Upload Guide](docs/METADATA-UPLOAD-GUIDE.md)

### "Image file not found"
- Verify the path in `TOKEN_METADATA.image`
- Check: `ls -la ./token-image.png`

### "Insufficient balance"
- Add more SOL to wallet (0.5 SOL recommended)

### "Account not initialized"
- Verify DAT is initialized on mainnet
- Run: `NETWORK=mainnet npm run init`

### "Invalid PDA"
- Verify all addresses are correct
- Verify network (mainnet vs devnet)

### "Transaction failed"
- Check logs in console
- Verify you have enough SOL
- Verify mint doesn't already exist

## 📞 Support

If you encounter issues:
1. Check error logs
2. Verify transaction on Solscan
3. Verify all accounts exist
4. Check SOL balance
5. See documentation in `docs/` folder

## 🎯 Pre-Launch Checklist

- [ ] **🔴 TESTING_MODE set to `false` in lib.rs (line 59)**
- [ ] Token image ready (512x512 or 1024x1024 PNG/JPG)
- [ ] NFT.Storage API key obtained and exported
- [ ] `NFT_STORAGE_API_KEY` environment variable set
- [ ] Token metadata customized in script
- [ ] Mainnet wallet created with 0.5+ SOL
- [ ] DAT initialized on mainnet
- [ ] Script modified with your info
- [ ] Program compiled (`anchor build`)
- [ ] Dependencies installed (`npm install`)
- [ ] All important files backed up
- [ ] Communication plan ready (Twitter, Telegram, etc.)

## 📚 Additional Resources

- [Metadata Upload Guide](docs/METADATA-UPLOAD-GUIDE.md) - Complete guide for IPFS uploads
- [Mayhem Mode Implementation](MAYHEM-MODE-IMPLEMENTATION.md) - Technical details
- [Testing Guide](docs/guides/E2E-TESTING.md) - How to test on devnet

## 🚀 Go Time!

When everything is ✅:

```bash
npx ts-node scripts/launch-mayhem-token.ts
```

**Good luck! 🔥🚀**

---

## 🌐 Language Versions

- 🇺🇸 English: `MAYHEM-MODE-LAUNCH-GUIDE-EN.md` (this file)
- 🇫🇷 Français: `MAYHEM-MODE-LAUNCH-GUIDE.md`
