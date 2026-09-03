-- Alım listesi — birden fazla planlı alımı sıraya dizip zamanlar.
--
-- Alım SİMÜLASYONU (simulations/asset-purchase) tek bir alımı değerlendirir;
-- bu tablo o alımların KALICI kuyruğudur. Zamanlama motoru (lib/purchase-plan.ts)
-- her satıra önerilen ayı hesaplar; burada yalnız kullanıcının girdisi durur,
-- türetilmiş alan tutulmaz (öneri her açılışta yeniden hesaplanır).
--
-- priority: kullanıcının el sıralaması (küçük = önce). Sürükle-bırak bunu günceller.
-- payment_plan 'taksit' ise installment_count zorunlu (uygulama katmanı doğrular).
-- monthly_extra: sahip olma maliyeti (opsiyonel) — alındıktan sonra aylık yük.
CREATE TABLE IF NOT EXISTS public.purchase_plans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    priority SMALLINT NOT NULL DEFAULT 0,           -- kullanıcı sıralaması (1 en önemli)
    desired_by DATE,                                -- ne zamana kadar isteniyor (ops.)
    monthly_extra NUMERIC(15, 2) DEFAULT 0,         -- sahip olma maliyeti (ops.)
    payment_plan TEXT NOT NULL DEFAULT 'pesin'
        CHECK (payment_plan IN ('pesin', 'taksit')),
    installment_count SMALLINT,                     -- taksitliyse taksit sayısı
    status TEXT NOT NULL DEFAULT 'planli'
        CHECK (status IN ('planli', 'alindi', 'vazgecildi')),
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ekran planlıları öncelik sırasına çeker; en sık sorgu bu.
CREATE INDEX IF NOT EXISTS purchase_plans_household_status_priority_idx
    ON public.purchase_plans (household_id, status, priority);

ALTER TABLE public.purchase_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_plans_policy" ON public.purchase_plans;
CREATE POLICY "purchase_plans_policy" ON public.purchase_plans FOR ALL
USING (household_id IN (SELECT current_user_household_ids() AS current_user_household_ids));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_plans TO authenticated;
