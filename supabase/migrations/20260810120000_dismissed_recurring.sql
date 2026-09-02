-- Reddedilen tekrarlayan-harcama önerileri.
--
-- recurring-detect ile bulunan bir aday kullanıcı tarafından reddedilince buraya
-- yazılır ve bir daha ÖNERİLMEZ (kalıcı susma). fingerprint = adayın kararlı
-- kimliği: normalize(etiket)|kategori|ritim (candidateFingerprint ile aynı).
--
-- Onay tarafı ayrı: aday onaylanınca yeni bir subscriptions satırı açılır; geçmiş
-- hareketler o aboneliğe BAĞLANMAZ (source_type backfill yok) — Yaklaşan/projeksiyon
-- çift saymasın diye yeni abonelik yalnız bugünden ileriye çalışır.

CREATE TABLE IF NOT EXISTS public.dismissed_recurring (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(household_id, fingerprint)
);

ALTER TABLE public.dismissed_recurring ENABLE ROW LEVEL SECURITY;

-- Diğer tablolarla aynı desen: yalnız kendi household'ının satırları.
DROP POLICY IF EXISTS "dismissed_recurring_policy" ON public.dismissed_recurring;
CREATE POLICY "dismissed_recurring_policy" ON public.dismissed_recurring FOR ALL
USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

-- Data API erişimi (grant_data_api_access ile aynı gerekçe; anon bilerek hariç).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dismissed_recurring TO authenticated;
