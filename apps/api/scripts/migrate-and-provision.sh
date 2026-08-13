#!/bin/sh
set -eu

: "${DATABASE_MIGRATION_URL:?DATABASE_MIGRATION_URL must be set}"
: "${NETWORKPEER_APP_DB_PASSWORD:?NETWORKPEER_APP_DB_PASSWORD must be set}"
: "${NETWORKPEER_ADMIN_DB_PASSWORD:?NETWORKPEER_ADMIN_DB_PASSWORD must be set}"
: "${NETWORKPEER_MEDIA_DB_PASSWORD:?NETWORKPEER_MEDIA_DB_PASSWORD must be set}"
: "${NETWORKPEER_FINANCIAL_DB_PASSWORD:?NETWORKPEER_FINANCIAL_DB_PASSWORD must be set}"

# Migrations run as the isolated migration owner. The serving containers use
# the four least-privilege roles provisioned immediately afterward.
export DATABASE_URL="$DATABASE_MIGRATION_URL"
npm run migrate
exec psql "$DATABASE_MIGRATION_URL" \
  -v ON_ERROR_STOP=1 \
  -v NETWORKPEER_SKIP_PASSWORD_PROMPTS=1 \
  -f scripts/provision-app-role.sql
