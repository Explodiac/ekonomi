-- Faiz takibi + Esnek hesap (KMH) türü.
--
-- Hepsi additive: yeni kolonlar (nullable/DEFAULT'lu) ve genişletilen bir CHECK
-- (izin verilen değer EKLEME — mevcut satırları reddetmez). Veri kaybı yok.

-- 0) Esnek hesap (KMH) türü — type CHECK'ini genişlet.
--    Negatif bakiye = kullanılan kredi (normaldir). Kesim/ödeme günü yok; faiz
--    oranı ve limit önemli. Grup/networth davranışı ekran katmanında.
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_type_check
    CHECK (type IN ('bank', 'credit_card', 'investment', 'cash', 'esnek_hesap'));

-- 2) Hesap seviyesinde yıllık faiz oranı (%). Kart nakit avans/gecikme faizi,
--    KMH faizi. Opsiyonel — girilmezse asgari ödeme senaryosu hesaplanmaz.
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(6, 2);

-- 1) "Faiz & ücretler" kategorisini işaretleyen bayrak. Bu kategori:
--    breathing-room'da alışkanlık DEĞİL zorunlu çıkış sayılır; bütçe konulamaz.
--    (Kategori satırı household başına uygulama katmanında oluşturulur/işaretlenir.)
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_interest BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Asgari ödeme oranı (%) — Türkiye'de limite göre %20-40; varsayılan %20.
--    interest.ts bunu parametre alır; kalıcı tercih burada.
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS min_payment_pct NUMERIC(5, 2) NOT NULL DEFAULT 20;
