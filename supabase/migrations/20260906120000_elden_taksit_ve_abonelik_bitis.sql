-- 1a) Elden/kartsız taksit türü + 1b) aboneliğe bitiş tarihi.
--
-- Additive. Genişletilen CHECK'ler mevcut satırları reddetmez (yeni değer/kural
-- ekleme). Veri kaybı yok.

-- 1a) installments.kind: 'elden' eklendi. Kart ve kredi dışında — arkadaşa borç,
--     senetli/elden alım, süreli düzenli ödeme ("anneme 7 ay 5.000 ₺"). Ödeme
--     source_account_id'deki banka hesabından çıkar; kart yok.
ALTER TABLE public.installments DROP CONSTRAINT IF EXISTS installments_kind_check;
ALTER TABLE public.installments ADD CONSTRAINT installments_kind_check
    CHECK (kind IN ('kart_taksidi', 'kredi', 'elden'));

-- Kart DIŞI türlerde (kredi, elden) kaynak hesap zorunlu; kart taksidinde
-- account_id zaten kartın kendisi.
ALTER TABLE public.installments DROP CONSTRAINT IF EXISTS installments_kredi_needs_source_check;
ALTER TABLE public.installments ADD CONSTRAINT installments_kredi_needs_source_check
    CHECK (kind = 'kart_taksidi' OR source_account_id IS NOT NULL);

-- 1b) subscriptions.end_date: süreli abonelikler (yıllık spor salonu, süreli dergi).
--     Boşsa süresiz (mevcut davranış). Doluysa upcoming o tarihten sonra üretmez.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS end_date DATE;
