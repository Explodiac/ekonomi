-- Hedeflere aylık ayrılan tutar (monthly allocation).
--
-- Üç eksik halkayı kapatır:
--   1) Goals bloğu — hedefe her ay ne kadar ayrıldığını gösterir/düzenler
--   2) Projeksiyon — hedef payı gerçek gider satırı olarak nakit görünümüne düşer
--   3) "Taksit bitiyor — hedefe yönlendir" önerisi — kalkan yükü bu kolona ekler
--
-- Boş (NULL) ya da 0 → hedefe otomatik pay ayrılmıyor demektir; projeksiyona girmez.
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS monthly_alloc NUMERIC(14, 2);
