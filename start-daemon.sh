#!/bin/bash
NETWORK=${1:-devnet}
LOG_FILE="/tmp/asdf-daemon-${NETWORK}.log"
PID_FILE="/tmp/asdf-daemon-${NETWORK}.pid"

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Stopping existing daemon (PID: $OLD_PID)..."
        kill "$OLD_PID"
        sleep 2
    fi
    rm -f "$PID_FILE"
fi

echo "Starting ASDF DAT Fee Monitor Daemon..."
echo "Network: $NETWORK"
echo "Log file: $LOG_FILE"

nohup npx ts-node scripts/monitor-ecosystem-fees.ts --network "$NETWORK" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "Daemon started with PID: $(cat $PID_FILE)"
echo "Commands:"
echo "  tail -f $LOG_FILE"
echo "  kill \$(cat $PID_FILE)"
