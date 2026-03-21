#!/bin/bash
# Start all dev processes for Claude Relay
# Usage: ./start-dev.sh

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "Starting Claude Relay dev environment..."

# 1. Daemon (backend)
echo "[1/3] Starting daemon on :2633..."
node lib/daemon.js &
DAEMON_PID=$!

# 2. Vite watch build (auto-rebuilds dist/ on file changes)
echo "[2/3] Starting Vite watch build..."
(cd svelte-frontend && npx vite build --watch 2>&1 | grep --line-buffered -E "built in|error|✓") &
WATCH_PID=$!

# Wait for first build
sleep 4

# 3. Chrome CDP dev browser (real Chrome, no Playwright)
echo "[3/3] Starting Chrome with CDP on :9222..."
node dev-browser.mjs &
BROWSER_PID=$!

echo ""
echo "Claude Relay dev running:"
echo "  Daemon:      PID $DAEMON_PID (https://localhost:2633 + http://localhost:2680)"
echo "  Watch build:  PID $WATCH_PID (rebuilds dist/ on changes)"
echo "  Chrome CDP:   PID $BROWSER_PID (http://localhost:2680, auto-reload, state → /tmp/relay-test/dev-state.json)"
echo ""
echo "Press Ctrl+C to stop all."

# Trap Ctrl+C to kill all processes
trap "echo 'Stopping...'; kill $DAEMON_PID $WATCH_PID $BROWSER_PID 2>/dev/null; exit 0" INT TERM

# Wait for any process to exit
wait
