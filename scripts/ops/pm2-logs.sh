#!/bin/bash
# View ASDF Daemon logs
#
# Usage:
#   ./scripts/ops/pm2-logs.sh           # Stream live logs
#   ./scripts/ops/pm2-logs.sh --lines 100  # Show last 100 lines

pm2 logs asdf-daemon "$@"
