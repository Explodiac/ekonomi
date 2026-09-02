-- Serbest not alanı. description işlem ADIDIR ("Migros", "BEDAŞ"); note ise
-- kullanıcının o harekete iliştirdiği serbest metindir ("hediye için", "iade bekleniyor").
-- İkisi ayrı: description listede başlık, note yalnız detay panelinde.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS note text;
