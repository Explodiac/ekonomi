#!/usr/bin/env bash
# Bir SQL yedeğini geri yükler. MEVCUT public verisini EZER — onay ister.
# Kullanım: npm run restore -- backups/backup_YYYYMMDD_HHMMSS.sql
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "HATA: Geri yüklenecek dosyayı verin:"
  echo "  npm run restore -- backups/backup_YYYYMMDD_HHMMSS.sql"
  echo "  Mevcut yedekler:"; ls -1t backups/*.sql 2>/dev/null | head -8 | sed 's/^/    /'
  exit 1
fi
if [ ! -f "$FILE" ]; then echo "HATA: Dosya yok: $FILE"; exit 1; fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  for f in .env .env.local; do
    if [ -f "$f" ]; then
      line=$(grep -E '^SUPABASE_DB_URL=' "$f" | head -1 || true)
      if [ -n "$line" ]; then SUPABASE_DB_URL="${line#SUPABASE_DB_URL=}"; break; fi
    fi
  done
fi
if [ -z "${SUPABASE_DB_URL:-}" ]; then echo "HATA: SUPABASE_DB_URL tanımlı değil (.env)."; exit 1; fi
if ! command -v psql >/dev/null 2>&1; then
  echo "HATA: psql bulunamadı. brew install libpq && brew link --force libpq"; exit 1
fi

# Hedef host'u göster (şifreyi maskele) ki yanlış DB'ye yazma.
HOST=$(echo "$SUPABASE_DB_URL" | sed -E 's#.*@([^:/]+).*#\1#')
echo "⚠️  GERİ YÜKLEME — mevcut public verisi EZİLECEK."
echo "    Kaynak : $FILE"
echo "    Hedef  : $HOST"
printf "    Onaylıyorsan 'evet' yaz: "
read -r ANS
if [ "$ANS" != "evet" ]; then echo "İptal edildi."; exit 1; fi

echo "Geri yükleniyor…"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$FILE"
echo "✓ Geri yükleme tamam: $FILE"
