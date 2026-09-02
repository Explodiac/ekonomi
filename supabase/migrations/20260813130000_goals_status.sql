-- Hedef durumu.
--   aktif: birikiyor; monthly_alloc'u projeksiyona ÇIKIŞ olarak girer.
--   hazir: hedefe ulaşıldı, harcanmayı bekliyor (Copilot: Ready to spend).
--          Pay artık ayrılmaz → monthly_alloc'u projeksiyona GİRMEZ.
--   arsiv: tamamlandı/vazgeçildi. Projeksiyona girmez, listede soluk.
--
-- Mevcut kayıtlar 'aktif' başlar. 'hazir' geçişi UI'da ÖNERİDİR (otomatik değil):
-- saved >= target olan aktif hedef için kullanıcı onaylar — projeksiyonu etkileyen
-- değişiklik sessizce yapılmaz.
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'aktif'
  CHECK (status IN ('aktif', 'hazir', 'arsiv'));
