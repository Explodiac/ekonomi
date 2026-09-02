#!/usr/bin/env bash
# Migration'ı ÖNCE yedek alarak uygular. Bozulursa restore ile geri dönülür.
# Kullanım: npm run db:migrate
# NOT: `supabase db reset` ASLA — gerçek veriyi siler. Şema değişikliği yalnız
# migration dosyası + `supabase db push` ile yapılır.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "1/2 · Migration öncesi yedek…"
bash scripts/backup.sh

echo
echo "2/2 · Migration uygulanıyor (supabase db push)…"
npx supabase db push

echo "✓ Migration tamam. Sorun olursa: npm run restore -- <yukarıdaki yedek>"
