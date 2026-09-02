-- Kategori hiyerarşisi: alt kategoriler bir üst kategoriye bağlanır.
--
-- Tek seviye kullanılır (parent → child). parent_id NULL → üst seviye kategori
-- (mevcut düz davranış). ON DELETE SET NULL: parent silinirse çocuk üst seviyeye çıkar.
-- Kendine işaret / döngü uygulama katmanında güvenli ele alınır (budget-rollover.ts).
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL;
