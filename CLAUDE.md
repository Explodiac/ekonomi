# Aile Bütçesi — proje notları

## ⚠️ VERİ UYARISI (en önemli kural)

Bu uygulama **gerçek finansal veri** tutuyor. Veri kaybı kabul edilemez.

- **`supabase db reset` KULLANMA** — bu komut TÜM VERİYİ SİLER. Ne lokalde ne hosted'da.
- **Şema değişikliği** yalnızca: yeni migration dosyası (`supabase/migrations/`) yaz →
  **`npm run db:migrate`** (önce otomatik yedek alır, sonra `supabase db push`).
- Doğrudan `supabase db push` yerine `npm run db:migrate` tercih et (yedeksiz push yok).
- Mock seed (`supabase/seed-mock-cift.sql`) **hosted'a ASLA** yüklenmez; production boş başlar.

## Destructive migration kontrolü

Her yeni migration için "bu veri kaybettirir mi?" sorusunu cevapla. Riskli işlemler:
`DROP COLUMN`, `DROP TABLE`, mevcut null'lar varken `NOT NULL` ekleme, tip daraltma.
Gerekirse **iki aşamalı** yap: önce yeni kolonu ekle → veriyi taşı → sonra eskisini kaldır
(ayrı migration'da, yedek aldıktan sonra).

## Yedekleme

- `npm run backup` → `backups/backup_<tarih>.sql` (public şeması: tablo + veri + RLS).
- `npm run restore -- <dosya>` → onay isteyerek geri yükler (mevcut veriyi ezer).
- `npm run db:migrate` → migration'dan önce otomatik yedek.
- `backups/` ve `.env*` git'e girmez (`.gitignore`). Bağlantı: `SUPABASE_DB_URL` (`.env.local`).
- Hosted Supabase'in günlük otomatik yedeği + bu script'ler + uygulama içi dışa aktarma
  (Ayarlar > Veri) = üç savunma hattı.

## Auth

- `/login`: e-posta + şifre (Supabase Auth). Oturum yoksa middleware `/login`'e yönlendirir.
- `/api/dev-login`: **yalnız** `NODE_ENV=development`. Production'da 404. Vercel'e dev env
  değişkenleri (`SUPABASE_DEV_USER_*`) GİTMEZ.
- İki kullanıcı (ben + eşim) aynı household; erişim RLS ile household bazlı — RLS'e dokunma.

## Yığın

Next 16 (App Router) · React 19 · Supabase (hosted) · Tailwind 4 · Vercel.
Docker/lokal Supabase kaldırıldı — geliştirme hosted projeye bağlanır.
