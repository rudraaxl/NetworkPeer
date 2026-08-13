#!/bin/bash
# NetworkPeers dev-network helper
# Detects the Mac's current LAN IP, points the app + server at it,
# restarts the backend, and starts Expo with the correct host.
#
# Usage:
#   ./dev-network.sh          # full restart (backend + expo, interactive QR)
#   ./dev-network.sh --dry-run  # show what would change, change nothing
#   ./dev-network.sh --api-only  # restart backend only, leave Expo running

set -euo pipefail

APP_DIR="/Users/rudraaxlakra/Documents/Networkpeer"
SERVER_DIR="/Users/rudraaxlakra/Downloads/NetworkPeer-main/server"
API_PORT=8787
EXPO_PORT=8081

MODE="${1:-full}"

# --- detect the Mac's LAN IP (Wi-Fi or phone hotspot) ----------------------
pick_ip() {
  local def_if ip
  def_if=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' | head -1)
  if [ -n "$def_if" ]; then
    ip=$(ipconfig getifaddr "$def_if" 2>/dev/null || true)
    case "$ip" in ""|169.254.*) ;; *) echo "$ip"; return 0 ;; esac
  fi
  for iface in en0 en1 en2 bridge100; do
    ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    case "$ip" in ""|169.254.*) continue ;; *) echo "$ip"; return 0 ;; esac
  done
  return 1
}

IP=$(pick_ip || true)
if [ -z "$IP" ]; then
  echo "Could not detect a LAN IP. Check your network connection." >&2
  exit 1
fi

update_env() {
  local file="$1" key="$2" value="$3"
  if grep -q "$key" "$file" 2>/dev/null; then
    sed -i '' "s|^$key=.*|$key=$value|" "$file"
  else
    echo "$key=$value" >> "$file"
  fi
}

if [ "$MODE" = "--dry-run" ]; then
  echo "Detected IP:      $IP"
  echo "Would update:"
  echo "  $APP_DIR/.env          EXPO_PUBLIC_API_URL=http://$IP:$API_PORT"
  echo "  $SERVER_DIR/.env       BASE_URL=http://$IP:$API_PORT"
  echo "  Restart backend on :$API_PORT, start Expo on :$EXPO_PORT"
  exit 0
fi

echo "==> Detected IP: $IP"

echo "==> Updating env files..."
update_env "$APP_DIR/.env" "EXPO_PUBLIC_API_URL" "http://$IP:$API_PORT"
update_env "$SERVER_DIR/.env" "BASE_URL" "http://$IP:$API_PORT"

restart_backend() {
  echo "==> Restarting backend..."
  pkill -f "tsx watch" 2>/dev/null || true
  lsof -ti:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
  (cd "$SERVER_DIR" && NODE_ENV=development nohup npm run dev > /tmp/np-server.log 2>&1 &)
  for _ in $(seq 1 20); do
    if curl -sf -m 2 "http://localhost:$API_PORT/api/health" >/dev/null 2>&1; then
      echo "    Backend healthy on :$API_PORT"
      return 0
    fi
    sleep 1
  done
  echo "    WARNING: backend did not become healthy. Check /tmp/np-server.log" >&2
}

stop_expo() {
  lsof -ti:$EXPO_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
}

if [ "$MODE" = "--api-only" ]; then
  restart_backend
  echo "Done. Expo still running — reload the app on your phone (press 'r' in the Expo terminal)."
  exit 0
fi

restart_backend
stop_expo
sleep 1

echo "==> Starting Expo on http://$IP:$EXPO_PORT (press 'c' in Expo to show QR)..."
(cd "$APP_DIR" && REACT_NATIVE_PACKAGER_HOSTNAME="$IP" npx expo start --host lan)
