-- Faiz kategorisi mekanizması kaldırıldı: faiz artık HESAPLANIYOR (hesap bakiyesi
-- + interest_rate), kategori/aramayla tanınmıyor. categories.is_interest bayrağı
-- kullanılmıyor — düşürülüyor.
--
-- IF EXISTS ile idempotent: interest_tracking migration'ı henüz uygulanmadıysa
-- kolon zaten yoktur, no-op. Uygulandıysa temizler. Faiz hareketleri bundan sonra
-- transactions.source_type='faiz' ile işaretlenir (kolon zaten var).
ALTER TABLE public.categories DROP COLUMN IF EXISTS is_interest;
