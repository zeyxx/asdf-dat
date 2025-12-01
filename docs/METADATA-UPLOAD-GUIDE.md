# Metadata Upload Guide

This guide explains how to upload token metadata to IPFS for Mayhem Mode token launches.

## Why Upload Metadata?

When creating a token on Solana (especially with PumpFun), you need to provide metadata including:
- Token name and symbol
- Description
- Token image
- Social links (Twitter, Telegram, website)

This metadata must be hosted permanently and accessible via a URI. IPFS is the standard solution.

## Using NFT.Storage (Free & Recommended)

NFT.Storage is a free service that uploads files to IPFS and pins them permanently.

### 1. Get an API Key

1. Visit [https://nft.storage](https://nft.storage)
2. Sign up for a free account (using GitHub or email)
3. Go to "API Keys" section
4. Click "New Key"
5. Copy your API key

### 2. Set the Environment Variable

```bash
# Linux/Mac
export NFT_STORAGE_API_KEY="your-api-key-here"

# Or add to your ~/.bashrc or ~/.zshrc for persistence
echo 'export NFT_STORAGE_API_KEY="your-api-key-here"' >> ~/.bashrc
source ~/.bashrc
```

```powershell
# Windows PowerShell
$env:NFT_STORAGE_API_KEY="your-api-key-here"
```

### 3. Prepare Your Token Image

1. Create a high-quality image for your token (recommended: 512x512 PNG or JPG)
2. Save it in the project root or scripts directory
3. Update `TOKEN_METADATA.image` in `launch-mayhem-token.ts`:

```typescript
const TOKEN_METADATA = {
  name: "My Awesome Token",
  symbol: "MAT",
  description: "The best token ever created!",
  twitter: "https://twitter.com/mytoken",
  telegram: "https://t.me/mytoken",
  website: "https://mytoken.com",
  image: "./my-token-image.png", // ← Update this path
};
```

### 4. Run the Launch Script

The script will automatically:
1. Upload your image to IPFS
2. Create metadata JSON with the image URI
3. Upload the metadata JSON to IPFS
4. Use the metadata URI when creating the token

```bash
ts-node scripts/launch-mayhem-token.ts
```

## Without NFT.Storage API Key

If you don't set the API key, the script will:
- Display a warning
- Use a placeholder URI: `https://placeholder.com/metadata.json`
- Still create the token, but with invalid metadata

**For mainnet deployment, you MUST upload real metadata!**

## Alternative Services

### Pinata

1. Sign up at [https://pinata.cloud](https://pinata.cloud)
2. Get your API key and secret
3. Modify the `uploadMetadata()` function to use Pinata's SDK

### Arweave

1. Get AR tokens from an exchange
2. Use the Arweave SDK to upload permanently
3. Modify the `uploadMetadata()` function accordingly

### Shadow Drive (Solana Native)

1. Use GenesysGo's Shadow Drive
2. Upload using the Shadow Drive SDK
3. Requires SOL for storage

## Metadata JSON Format

The uploaded metadata follows the Metaplex standard:

```json
{
  "name": "My Token",
  "symbol": "MTK",
  "description": "Token description",
  "image": "https://nftstorage.link/ipfs/bafybeiabc123...",
  "external_url": "https://mytoken.com",
  "attributes": [],
  "properties": {
    "files": [
      {
        "uri": "https://nftstorage.link/ipfs/bafybeiabc123...",
        "type": "image/png"
      }
    ],
    "category": "image",
    "creators": []
  },
  "social_links": {
    "twitter": "https://twitter.com/mytoken",
    "telegram": "https://t.me/mytoken",
    "website": "https://mytoken.com"
  }
}
```

## Troubleshooting

### "NFT_STORAGE_API_KEY not set"

Make sure you've exported the environment variable:
```bash
echo $NFT_STORAGE_API_KEY  # Should print your key
```

### "Image file not found"

Check that the image path in `TOKEN_METADATA.image` is correct:
```bash
ls -la ./token-image.png  # Should show the file
```

### "Error uploading metadata"

Common issues:
- Invalid API key
- Network connection problems
- File too large (max 100MB for NFT.Storage free tier)
- Rate limiting (wait a few minutes and try again)

## Best Practices

1. **Test on Devnet First**: Upload test metadata before mainnet
2. **Use High-Quality Images**: 512x512 or 1024x1024 PNG/JPG
3. **Verify URIs**: After upload, check that the IPFS URI loads correctly
4. **Keep API Keys Secret**: Never commit API keys to git
5. **Backup Metadata**: Save a local copy of your metadata JSON

## Next Steps

After configuring metadata upload:
1. Customize `TOKEN_METADATA` in the launch script
2. Prepare your token image
3. Test on devnet
4. Deploy on mainnet with real metadata

For more info, see the [Mayhem Mode Launch Guide](../MAYHEM-MODE-LAUNCH-GUIDE.md).
