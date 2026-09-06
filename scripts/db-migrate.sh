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
# Bu proje hosted'a bağlanır; lokal Docker yok. Yeni CLI, katalog önbelleği için
# Docker imajı yoklamayı deniyor ve bulamayınca zararsız bir uyarı basıyor. O
# uyarıyı (yalnız Docker satırlarını) süzüyoruz; gerçek hatalar görünmeye devam
# eder ve push'un çıkış kodu korunur (process substitution).
npx supabase db push 2> >(grep -vE 'failed to cache migrations catalog|Docker Desktop is a prerequisite|docs\.docker\.com/desktop' >&2)

echo "✓ Migration tamam. Sorun olursa: npm run restore -- <yukarıdaki yedek>"
