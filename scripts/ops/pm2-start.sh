#!/bin/bash
# Start ASDF Daemon with PM2
#
# Usage:
#   ./scripts/ops/pm2-start.sh [devnet|mainnet]
#
# Requirements:
#   - PM2 installed globally (npm install -g pm2)
#   - Environment variables set (.env file)
#   - Wallet files present

set -e

NETWORK=${1:-devnet}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  ASDF Burn Engine - PM2 Startup       ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 not found. Install with:${NC}"
    echo -e "   npm install -g pm2"
    exit 1
fi

# Check environment
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found. Copy .env.template:${NC}"
    echo -e "   cp .env.template .env"
    exit 1
fi

# Load environment
source .env

# Validate required env vars
if [ -z "$CREATOR" ]; then
    echo -e "${RED}❌ CREATOR not set in .env${NC}"
    exit 1
fi

if [ "$NETWORK" = "mainnet" ] && [ -z "$HELIUS_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  Warning: HELIUS_API_KEY not set (using public RPC)${NC}"
fi

# Check wallet file
WALLET_FILE="${NETWORK}-wallet.json"
if [ ! -f "$WALLET_FILE" ]; then
    echo -e "${RED}❌ Wallet file not found: ${WALLET_FILE}${NC}"
    exit 1
fi

# Build TypeScript (optional but recommended)
echo -e "${CYAN}📦 Building TypeScript...${NC}"
npm run build 2>&1 | tail -5

# Start daemon with PM2
echo -e "${GREEN}🚀 Starting ASDF daemon on ${NETWORK}...${NC}"
pm2 start ecosystem.config.js --env "${NETWORK}"

# Save PM2 process list
pm2 save

# Display status
echo ""
pm2 status

# Show logs
echo ""
echo -e "${CYAN}📊 Recent logs:${NC}"
pm2 logs asdf-daemon --lines 10 --nostream

echo ""
echo -e "${GREEN}✅ Daemon started successfully${NC}"
echo -e "${CYAN}Monitoring:${NC}"
echo -e "  pm2 status              - View process status"
echo -e "  pm2 logs asdf-daemon    - Stream logs"
echo -e "  pm2 monit               - Real-time monitoring"
echo -e "  pm2 restart asdf-daemon - Restart daemon"
echo -e "  pm2 stop asdf-daemon    - Stop daemon"
echo ""
echo -e "${CYAN}Health check:${NC} curl http://localhost:3030/health"
echo ""
