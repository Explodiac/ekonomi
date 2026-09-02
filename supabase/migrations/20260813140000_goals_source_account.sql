-- Hedefin varsayılan kaynak hesabı: ayrılan para hangi hesapta duruyor / katkı
-- hangi hesaptan yapılıyor. Copilot'un "Contributions" bloğu bunu gösterir
-- (ör. "Adv Plus Banking 9242 — 3.000 ₺"). goal_contributions.account_id ise
-- her katkının kendi hesabıdır; bu kolon yeni katkı için varsayılanı verir.
--
-- ON DELETE SET NULL: hesap silinirse hedef kaybolmaz, yalnız bağlantı kopar.
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS source_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;
