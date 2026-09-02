#!/usr/bin/env bash
# Tam SQL yedeği alır (public şeması: tablolar + veri + RLS politikaları).
# Connection string'i SUPABASE_DB_URL'den okur (.env / .env.local / ortam).
# Kullanım: npm run backup
set -euo pipefail
cd "$(dirname "$0")/.."

# SUPABASE_DB_URL'i ortamdan al; yoksa .env / .env.local'den oku (ilk = sonrası hepsi).
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  for f in .env .env.local; do
    if [ -f "$f" ]; then
      line=$(grep -E '^SUPABASE_DB_URL=' "$f" | head -1 || true)
      if [ -n "$line" ]; then SUPABASE_DB_URL="${line#SUPABASE_DB_URL=}"; break; fi
    fi
  done
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "HATA: SUPABASE_DB_URL tanımlı değil. .env dosyasına ekleyin:"
  echo "  SUPABASE_DB_URL=postgresql://postgres:<ŞİFRE>@<HOST>:5432/postgres"
  echo "  (Supabase panel > Project Settings > Database > Connection string > URI)"
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "HATA: pg_dump bulunamadı. Postgres istemci araçlarını kurun:"
  echo "  brew install libpq && brew link --force libpq"
  exit 1
fi

mkdir -p backups
TS=$(date +%Y%m%d_%H%M%S)
FILE="backups/backup_${TS}.sql"

echo "Yedek alınıyor → $FILE"
# --clean --if-exists: yedek, geri yüklenirken mevcut nesneleri önce düşürür (temiz
# geri yükleme). --no-owner: Supabase rol sahipliğine dokunma. Yetkiler (GRANT/RLS)
# dahil — geri yüklemede erişim aynen dönsün. Yalnız public: auth/storage yönetilmez.
pg_dump "$SUPABASE_DB_URL" \
  --schema=public \
  --clean --if-exists \
  --no-owner \
  --quote-all-identifiers \
  > "$FILE"

SIZE=$(du -h "$FILE" | cut -f1)
echo "✓ Yedek tamam: $FILE ($SIZE)"
echo "  Son 5 yedek:"
ls -1t backups/*.sql 2>/dev/null | head -5 | sed 's/^/    /'
