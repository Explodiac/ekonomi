-- Aylık bütçe + devir (rollover) modeli.
--
-- Her kategori, her ay için bir bütçe kovası. Ay sonunda kalan = bütçe − harcanan;
-- bu kalan (artı/eksi) sonraki ayın bütçesine EKLENİR (carried_in). budget.ts'in
-- tek-ay limiti bunun özel hâli; rollover onu genişletir, silmez.
--
-- carried_in: önceki dönemin (budgeted + carried_in − spent) değeri. İlk dönem için 0
-- (geriye dönük hesap yok). Değer chain'den türetilir; bu kolon materyalize snapshot.
CREATE TABLE IF NOT EXISTS public.budget_periods (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
    period DATE NOT NULL,                                  -- ay başı, örn 2026-08-01
    budgeted NUMERIC(15, 2) NOT NULL DEFAULT 0,
    carried_in NUMERIC(15, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(household_id, category_id, period)              -- kategori başına ay başına tek satır
);

ALTER TABLE public.budget_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budget_periods_policy" ON public.budget_periods;
CREATE POLICY "budget_periods_policy" ON public.budget_periods FOR ALL
USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.budget_periods TO authenticated;

-- Negatif devir seçmeli. Açık: aşım sonraki aya borç olarak taşınır (gerçekçi, varsayılan).
-- Kapalı: her ay temiz başlar, remaining<0 olan ay carried_in=0 devreder; pozitif devir çalışır.
ALTER TABLE public.households ADD COLUMN IF NOT EXISTS negative_carry BOOLEAN DEFAULT true;
