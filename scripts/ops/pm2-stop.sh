#!/bin/bash
# Stop ASDF Daemon
#
# Usage: ./scripts/ops/pm2-stop.sh

set -e

echo "Stopping ASDF daemon..."
pm2 stop asdf-daemon

echo "✅ Daemon stopped"
echo ""
echo "To remove completely: pm2 delete asdf-daemon"
echo "To restart: pm2 restart asdf-daemon"
