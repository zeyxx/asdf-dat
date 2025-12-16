#!/bin/bash
# Check ASDF Daemon status
#
# Usage: ./scripts/ops/pm2-status.sh

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  ASDF Daemon Status                   ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# PM2 status
pm2 status asdf-daemon

echo ""
echo -e "${CYAN}Health Check:${NC}"

# HTTP health check
if curl -s http://localhost:3030/health > /dev/null 2>&1; then
    HEALTH=$(curl -s http://localhost:3030/health)
    echo -e "${GREEN}✅ HTTP API: Healthy${NC}"
    echo "$HEALTH" | jq '.' 2>/dev/null || echo "$HEALTH"
else
    echo -e "${RED}❌ HTTP API: Unreachable${NC}"
fi

echo ""
echo -e "${CYAN}Resource Usage:${NC}"
pm2 show asdf-daemon | grep -E "(cpu|memory|uptime|restarts)"

echo ""
