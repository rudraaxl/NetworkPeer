#!/usr/bin/env bash
# Stop everything started by scripts/start-demo.sh.
# Note: PostGIS + Redis containers are left running (your data stays intact).
set -u

info()  { printf "\033[1;34m[networkpeer]\033[0m %s\n" "$*"; }

pkill -f "cloudflared tunnel" >/dev/null 2>&1 && info "Stopped cloudflared tunnels" || info "No tunnels running"
pkill -f "node dist/index.js" >/dev/null 2>&1 && info "Stopped API" || info "No API process"
pkill -f "vite dev" >/dev/null 2>&1 && info "Stopped frontend dev server" || info "No frontend process"

info "Done. Containers (PostGIS/Redis) are still running on purpose."
