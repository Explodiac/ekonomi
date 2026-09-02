-- Harcama doğası: alışkanlık mı, tek seferlik mi? Kural ayırt edemez (4 ay süren
-- diş tedavisi "alışkanlık" gibi görünür); yalnız kullanıcı bilir. Sistem şüphede
-- sorar, cevabı KALICI hatırlar.
--
--   'aliskanlik'   → alışkanlık ortalamasına girer
--   'tek_seferlik' → hiç girmez
--   null           → sınıflanmamış; GİRER (mevcut davranış korunur) ama işaretlenir
--
-- Geriye uyum: null varsayılanı eski hesapları bozmaz.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS spend_nature TEXT
    CHECK (spend_nature IS NULL OR spend_nature IN ('aliskanlik', 'tek_seferlik'));

-- Kategori varsayılanı: yeni harcama bu değeri alır, sorulmaz.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS default_nature TEXT
    CHECK (default_nature IS NULL OR default_nature IN ('aliskanlik', 'tek_seferlik'));
