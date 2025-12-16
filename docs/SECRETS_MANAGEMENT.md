# Secrets Management Guide

## Overview

ASDF Burn Engine uses environment variables for all sensitive configuration.
**Never commit secrets to git.**

## Setup

### 1. Copy Template
```bash
cp .env.template .env
```

### 2. Fill in Your Values
Edit `.env` with your actual credentials:

```bash
# Required for devnet
HELIUS_API_KEY=your_actual_helius_key_here
CREATOR=your_creator_pubkey_here

# Required for mainnet
HELIUS_API_KEY=your_helius_key
QUICKNODE_RPC=your_quicknode_url
MAINNET_WALLET=path/to/mainnet-wallet.json
CREATOR=your_creator_pubkey
```

### 3. Verify
```bash
# Check that secrets are not in git
git status .env
# Should show: "nothing to commit" or not appear

# Verify API key works
curl "https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

## Required Secrets

### Devnet Development
- `HELIUS_API_KEY` - Free tier OK for testing
- `CREATOR` - Your test wallet pubkey

### Mainnet Production
- `HELIUS_API_KEY` - Premium tier recommended
- `QUICKNODE_RPC` - Secondary RPC (fallback)
- `MAINNET_WALLET` - Secured wallet file
- `CREATOR` - Production creator pubkey
- `GRAFANA_METRICS_URL` - For monitoring (optional)
- `PAGERDUTY_KEY` - For alerting (optional)

## Security Best Practices

### ✅ DO
- Use `.env` for local development
- Use environment variables in production
- Rotate keys regularly (every 90 days)
- Use different keys for dev/prod
- Store wallet files encrypted
- Use hardware wallets for mainnet

### ❌ DON'T
- Commit `.env` to git
- Share API keys in chat/email
- Use production keys in development
- Hardcode secrets in code
- Store unencrypted wallets in cloud

## Rotation Procedure

When rotating secrets:

1. **Generate New Credentials**
   ```bash
   # Helius: Generate new API key in dashboard
   # QuickNode: Generate new endpoint
   ```

2. **Update `.env`**
   ```bash
   # Update .env with new values
   HELIUS_API_KEY=new_key_here
   ```

3. **Test**
   ```bash
   # Verify new keys work
   npm run check-state -- --network devnet
   ```

4. **Deploy**
   ```bash
   # Update production environment
   # PM2 will auto-reload on config change
   pm2 restart all
   ```

5. **Revoke Old**
   - Revoke old Helius API key
   - Delete old QuickNode endpoint
   - Archive old wallet (if rotated)

## Emergency: Key Compromised

If a secret is exposed:

1. **Immediate Actions**
   ```bash
   # Revoke compromised key immediately
   # Generate new key
   # Update .env
   # Restart services
   pm2 restart all
   ```

2. **Audit**
   - Check git history for commits
   - Review access logs
   - Verify no unauthorized transactions

3. **Rotate All**
   - If one key compromised, rotate all
   - Update monitoring alerts
   - Document incident

4. **Prevention**
   - Review team access
   - Enable 2FA everywhere
   - Audit `.gitignore`

## CI/CD Secrets

For GitHub Actions:

1. **Add Secrets**
   - Go to repo Settings > Secrets
   - Add `HELIUS_API_KEY`
   - Add `DEVNET_WALLET_SECRET` (base64 encoded)

2. **Use in Workflows**
   ```yaml
   env:
     HELIUS_API_KEY: ${{ secrets.HELIUS_API_KEY }}
   ```

## Production Deployment

### AWS/Cloud Environment Variables
```bash
# AWS Systems Manager Parameter Store
aws ssm put-parameter \
  --name /asdf-dat/prod/helius-api-key \
  --value "your_key" \
  --type SecureString

# Retrieve in application
HELIUS_API_KEY=$(aws ssm get-parameter \
  --name /asdf-dat/prod/helius-api-key \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text)
```

### Docker Secrets
```bash
# Create secret
echo "your_key" | docker secret create helius_api_key -

# Use in service
docker service create \
  --secret helius_api_key \
  asdf-dat-daemon
```

## Audit Checklist

Weekly security audit:
- [ ] No secrets in git history
- [ ] `.env` in `.gitignore`
- [ ] All keys rotated within 90 days
- [ ] Production keys different from dev
- [ ] Unused keys revoked
- [ ] Team access reviewed
- [ ] Monitoring alerts active

## Common Issues

### Issue: `HELIUS_API_KEY` not found
**Solution:** Copy `.env.template` to `.env` and fill in values

### Issue: Rate limiting on devnet
**Solution:** Check API key is valid and has quota remaining

### Issue: Wallet not found
**Solution:** Verify `DEVNET_WALLET` path is correct relative to project root

## Support

Questions? Check:
1. [RUNBOOK.md](./RUNBOOK.md) for operational issues
2. [ARCHITECTURE.md](./ARCHITECTURE.md) for system design
3. GitHub issues for known problems

---

*Security is not a feature. It's a requirement.* 🔒
