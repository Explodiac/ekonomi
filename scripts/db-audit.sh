#!/usr/bin/env bash
# Veri tutarlılık denetimi — SALT OKUNUR. Otomatik düzeltme YAPMAZ, sadece raporlar.
# Kullanım: npm run db:audit
set -euo pipefail
cd "$(dirname "$0")/.."

# .env.local'dan SUPABASE_DB_URL yükle.
set -a; [ -f .env.local ] && . ./.env.local 2>/dev/null; set +a
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL tanımlı değil (.env.local)}"

# Docker uyarısı yok — doğrudan psql. Salt okunur (script içinde de set edildi).
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/db-audit.sql
