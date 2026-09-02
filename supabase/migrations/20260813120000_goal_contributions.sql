-- Hedef katkıları — GERÇEKLEŞEN birikim kaydı (goals.monthly_alloc PLANLANANDIR).
--
-- Kategori×ay bütçesi gibi: hedef başına, ay başına bir katkı satırı. Copilot'un
-- tik işaretli ay şeridi bu veriden çıkar — hangi ay katkı yapıldı, hangi ay atlandı.
-- period ay başı tarihidir (örn 2026-08-01). account_id: katkının geldiği hesap.
--
-- Projeksiyon hedef payını monthly_alloc'tan almaya DEVAM eder; bu tablo ayrı bir
-- gerçekleşen kayıttır, projeksiyonu değiştirmez.
CREATE TABLE IF NOT EXISTS public.goal_contributions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    goal_id UUID REFERENCES public.goals(id) ON DELETE CASCADE,
    period DATE NOT NULL,                                   -- ay başı, örn 2026-08-01
    amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(goal_id, period)                                -- hedef başına ay başına tek satır
);

ALTER TABLE public.goal_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goal_contributions_policy" ON public.goal_contributions;
CREATE POLICY "goal_contributions_policy" ON public.goal_contributions FOR ALL
USING (household_id IN (SELECT current_user_household_ids() AS current_user_household_ids));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.goal_contributions TO authenticated;
