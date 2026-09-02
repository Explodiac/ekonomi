-- 1. HouseHolds (Aile Yönetimi için) Tablosu
CREATE TABLE public.households (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Household_Members (Aileye Kime Kayıtlı)
CREATE TABLE public.household_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(household_id, user_id)
);

-- 3. Categories (Kategoriler)
CREATE TABLE public.categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) CHECK (type IN ('income', 'expense')),
    icon VARCHAR(255),
    color VARCHAR(50),
    budget_limit NUMERIC(15, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Accounts (Cüzdan/Kasa ve Kartlar)
CREATE TABLE public.accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) CHECK (type IN ('bank', 'credit_card', 'investment', 'cash')),
    balance NUMERIC(15, 2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'TRY',
    credit_limit NUMERIC(15, 2) DEFAULT 0, -- Kredi kartları için limit
    cut_date INTEGER, -- Hesap Kesim Günü (1-31)
    due_date INTEGER, -- Son Ödeme Günü (1-31)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Transactions (İşlemler - Gelir/Gider)
CREATE TABLE public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- İşlemi kim ekledi?
    amount NUMERIC(15, 2) NOT NULL,
    type VARCHAR(20) CHECK (type IN ('income', 'expense', 'transfer')),
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Investments (Yatırım Portföyü Özel Alanı)
CREATE TABLE public.investments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL, -- "Fiziki Altın"
    symbol VARCHAR(50), -- "ALTIN", "AAPL"
    quantity NUMERIC(15, 4) NOT NULL DEFAULT 0, -- 15.5 Gram
    unit VARCHAR(50) NOT NULL, -- 'gr', 'adet', 'lot'
    average_cost NUMERIC(15, 4) NOT NULL DEFAULT 0,
    type VARCHAR(50) CHECK (type IN ('commodity', 'stock', 'crypto', 'fund')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Goals (Birikim Hedefleri)
CREATE TABLE public.goals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    current_amount NUMERIC(15, 2) DEFAULT 0, -- Sadece uyumluluk için (eski veri)
    target_amount NUMERIC(15, 2) NOT NULL,
    saved_tl NUMERIC(15, 2) DEFAULT 0,
    saved_usd NUMERIC(15, 2) DEFAULT 0,
    saved_eur NUMERIC(15, 2) DEFAULT 0,
    saved_gold NUMERIC(15, 2) DEFAULT 0,
    total_cost_tl NUMERIC(15, 2) DEFAULT 0, -- Toplam Maliyet (Maliyet/Kar hesaplamak için)
    period VARCHAR(20) DEFAULT 'monthly' CHECK (period IN ('monthly', 'yearly')), -- Hedef tipi
    is_fiat BOOLEAN DEFAULT TRUE, -- TL mi yoksa birim bazlı mı (gr altın)
    asset_unit VARCHAR(50), -- 'gr', 'adet' vb. (Eğer is_fiat false ise)
    asset_name VARCHAR(100), -- 'Altın', 'Dolar'
    deadline DATE,
    color VARCHAR(50),
    icon VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Subscriptions (Sabit Abonelikler)
CREATE TABLE public.subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    frequency VARCHAR(50) CHECK (frequency IN ('monthly', 'yearly', 'weekly')),
    next_payment_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);


-- Güvenlik (RLS - Row Level Security) İlkeleri
-- Her aile sadece kendine ait olan Household_id satırlarını görebilmeli.

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- 1. Önce mevcut tüm hatalı politikaları temizleyelim
DROP POLICY IF EXISTS "Users can view their own household" ON public.households;
DROP POLICY IF EXISTS "Users can view their own membership" ON public.household_members;
DROP POLICY IF EXISTS "Users can view household peers" ON public.household_members;
DROP POLICY IF EXISTS "Users can view members of their household" ON public.household_members;
DROP POLICY IF EXISTS "Users can manage categories in their household" ON public.categories;
DROP POLICY IF EXISTS "Users can manage accounts in their household" ON public.accounts;
DROP POLICY IF EXISTS "Users can manage transactions in their household" ON public.transactions;
DROP POLICY IF EXISTS "Users can manage investments in their household" ON public.investments;
DROP POLICY IF EXISTS "Users can manage goals in their household" ON public.goals;
DROP POLICY IF EXISTS "Users can manage subscriptions in their household" ON public.subscriptions;

-- 2. Güvenli, Sonsuz Döngü (Infinite Recursion) Yaratmayan RLS Politikaları
-- Önceki yardımcı fonksiyon yöntemi bazen auth context kopmalarında boş döndürüyor. Doğrudan subquery kullanacağız.

-- Household Members (Ailenin Üyeleri)
CREATE POLICY "members_select_policy" ON public.household_members FOR SELECT 
USING (user_id = auth.uid() OR household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

CREATE POLICY "members_insert_policy" ON public.household_members FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "members_update_policy" ON public.household_members FOR UPDATE 
USING (user_id = auth.uid());

-- Households (Aileler)
CREATE POLICY "households_select_policy" ON public.households FOR SELECT 
USING (id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

CREATE POLICY "households_insert_policy" ON public.households FOR INSERT 
WITH CHECK (true);

-- Kategoriler (Categories)
CREATE POLICY "categories_policy" ON public.categories FOR ALL 
USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

-- Hesaplar (Accounts)
CREATE POLICY "accounts_policy" ON public.accounts FOR ALL 
USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

-- İşlemler (Transactions)
CREATE POLICY "transactions_policy" ON public.transactions FOR ALL 
USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

-- Yatırımlar (Investments)
CREATE POLICY "investments_policy" ON public.investments FOR ALL 
USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

-- Hedefler (Goals)
CREATE POLICY "goals_policy" ON public.goals FOR ALL 
USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

-- Abonelikler (Subscriptions)
CREATE POLICY "subscriptions_policy" ON public.subscriptions FOR ALL 
USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));

-- Kategorilere tekrarlayan bayrağı ekle
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;

-- Gelirler için Kontratlar tablosu
CREATE TABLE IF NOT EXISTS public.contracts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    client_name VARCHAR(255),
    amount NUMERIC(15, 2) NOT NULL,
    frequency VARCHAR(50) CHECK (frequency IN ('monthly', 'yearly', 'weekly', 'once')),
    next_payment_date DATE NOT NULL,
    end_date DATE, 
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Güvenlik ayarları
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'contracts_policy' AND tablename = 'contracts') THEN
        CREATE POLICY "contracts_policy" ON public.contracts FOR ALL 
        USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));
    END IF;
END
$$;

-- Ödeme Planı / Taksitler (Contract Milestones)
CREATE TABLE IF NOT EXISTS public.contract_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    expected_date DATE NOT NULL,
    account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.contract_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'contract_payments_policy' AND tablename = 'contract_payments') THEN
        CREATE POLICY "contract_payments_policy" ON public.contract_payments FOR ALL 
        USING (contract_id IN (SELECT id FROM public.contracts));
    END IF;
END
$$;
-- 10. Taksitli Harcamalar (Installments)
CREATE TABLE IF NOT EXISTS public.installments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    description TEXT,
    total_amount NUMERIC(15, 2) NOT NULL,
    installments_count INTEGER NOT NULL,
    start_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'installments_policy' AND tablename = 'installments') THEN
        CREATE POLICY "installments_policy" ON public.installments FOR ALL 
        USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.installment_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    installment_id UUID REFERENCES public.installments(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    installment_number INTEGER NOT NULL,
    payment_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.installment_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'installment_payments_policy' AND tablename = 'installment_payments') THEN
        CREATE POLICY "installment_payments_policy" ON public.installment_payments FOR ALL 
        USING (installment_id IN (SELECT id FROM public.installments));
    END IF;
END
$$;
-- 11. Bildirimler (Notifications)
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    household_id UUID REFERENCES public.households(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- Hedef kullanıcı (null ise tüm aile)
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'error', 'transaction')),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notifications_policy' AND tablename = 'notifications') THEN
        CREATE POLICY "notifications_policy" ON public.notifications FOR ALL 
        USING (household_id IN (SELECT household_id FROM public.household_members WHERE user_id = auth.uid()));
    END IF;
END
$$;
