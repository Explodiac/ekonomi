-- Tercihler deposu: household başına tek satır. Rezerv ay sayısı ve uyarı
-- eşikleri burada saklanır. negative_carry households'ta kalır (budget-rollover
-- onu okuyor); Tercihler ekranı oradan yazar/okur, burada aynalanmaz.
CREATE TABLE IF NOT EXISTS settings (
    household_id UUID PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
    reserve_months NUMERIC(4,1) NOT NULL DEFAULT 3,
    alert_budget_pct INTEGER NOT NULL DEFAULT 90,       -- bütçe kullanım uyarı eşiği %
    alert_card_pct INTEGER NOT NULL DEFAULT 70,         -- kart limit kullanım uyarı eşiği %
    alert_debt_service_pct INTEGER NOT NULL DEFAULT 40, -- borç servis oranı uyarı eşiği %
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_rw ON settings;
CREATE POLICY settings_rw ON settings
    USING (household_id IN (SELECT current_user_household_ids()))
    WITH CHECK (household_id IN (SELECT current_user_household_ids()));

GRANT ALL ON settings TO authenticated, anon, service_role;
