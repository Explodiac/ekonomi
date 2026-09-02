-- =====================================================================
--  MOCK SENARYO: İstanbul'da evli beyaz yakalı çift, kiracı, "dengeli"
--  (ayı çıkarır ama bazı aylar dar, insight'lar tetiklenir).
--
--  GERİ DÖNÜŞ:  Bu seed mevcut household verisini SİLİP yerine mock koyar.
--              Orijinal seed'e dönmek için:
--                  npx supabase db reset
--              (migrations + supabase/seed.sql yeniden çalışır)
--              Sadece bu mock'u tek komutla uygulamak için:
--                  docker exec -i supabase_db_ekonomi-temiz psql -U postgres \
--                    -d postgres < supabase/seed-mock-cift.sql
--
--  Bağlam: bugün = 2026-08-10. household/user KORUNUR (dev-login çalışsın).
--  Şema gerçek kolonlardan alındı; income_sources/receipts/debts/recurring_rules
--  yok → gelir=transactions/contracts, düzenli gider=subscriptions, kredi=
--  installments(kind='kredi'). Rakamlar takvimden bağlanır (Kasım = kasko+trafik).
-- =====================================================================

DO $$
DECLARE
  hh    uuid := '00000000-0000-0000-0000-0000000000b1';
  usr   uuid := '00000000-0000-0000-0000-0000000000a1';
  today date := DATE '2026-08-10';

  -- Hesaplar
  a_maas    uuid := gen_random_uuid();
  a_ortak   uuid := gen_random_uuid();
  a_nakit   uuid := gen_random_uuid();
  a_birikim uuid := gen_random_uuid();
  a_k1      uuid := gen_random_uuid();  -- Bonus  (limit 40K)
  a_k2      uuid := gen_random_uuid();  -- World  (limit 60K)
  a_k3      uuid := gen_random_uuid();  -- Axess  (limit 25K)

  -- Kategoriler
  c_maas    uuid := gen_random_uuid();
  c_market  uuid := gen_random_uuid();
  c_yemek   uuid := gen_random_uuid();
  c_ulasim  uuid := gen_random_uuid();
  c_giyim   uuid := gen_random_uuid();
  c_saglik  uuid := gen_random_uuid();
  c_eglence uuid := gen_random_uuid();
  c_fatura  uuid := gen_random_uuid();
  c_diger   uuid := gen_random_uuid();

  -- Ev grubu (parent) ve alt kategorileri — hiyerarşi örneği
  c_ev       uuid := gen_random_uuid();
  c_elektrik uuid := gen_random_uuid();
  c_su       uuid := gen_random_uuid();
  c_dogalgaz uuid := gen_random_uuid();
  c_internet uuid := gen_random_uuid();
  c_aidat    uuid := gen_random_uuid();

  -- Değişken harcamaya gerçekçi açıklama üretmek için (kategori bazlı liste, döngüsel)
  desc_arr  text[];

  -- Hedefler (katkı kayıtları için id yakalanır)
  g_yaz     uuid := gen_random_uuid();
  g_araba   uuid := gen_random_uuid();

  -- Yardımcı döngü değişkenleri
  mo       int;
  mstart   date;
  vcat     uuid;
  vtot     numeric;
  vcount   int;
  vacct    uuid;
  i        int;
  each_amt numeric;
  d        date;
  inst_id  uuid;
  pay_id   uuid;
  n        int;
  paid_n   int;
  per_amt  numeric;
  pdate    date;

  -- Değişken harcama tablosu: kategori, hesap, ve 4 ayın (May,Haz,Tem,Ağu) toplamları
  -- Ağustos kısmi (10 gün) ve bütçe hedefleriyle uyumlu.
  vrows record;
  grp uuid;
BEGIN
  -- 0) TEMİZLİK (household verisi) — household/member/auth KORUNUR
  DELETE FROM transactions        WHERE household_id = hh;
  DELETE FROM installment_payments WHERE installment_id IN (SELECT id FROM installments WHERE household_id = hh);
  DELETE FROM installments        WHERE household_id = hh;
  DELETE FROM contract_payments   WHERE contract_id IN (SELECT id FROM contracts WHERE household_id = hh);
  DELETE FROM contracts           WHERE household_id = hh;
  DELETE FROM subscriptions       WHERE household_id = hh;
  DELETE FROM budget_periods      WHERE household_id = hh;
  DELETE FROM goals               WHERE household_id = hh;
  DELETE FROM investments         WHERE household_id = hh;
  DELETE FROM dismissed_recurring WHERE household_id = hh;
  DELETE FROM notifications       WHERE household_id = hh;
  DELETE FROM accounts            WHERE household_id = hh;
  DELETE FROM categories          WHERE household_id = hh;

  -- 1) HESAPLAR (opening_balance sonda geri-hesaplanır)
  INSERT INTO accounts (id, household_id, name, type, currency, credit_limit, cut_date, due_date, opening_balance) VALUES
    (a_maas,    hh, 'Vadesiz (Maaş)',          'bank',        'TRY', 0,     NULL, NULL, 0),
    (a_ortak,   hh, 'Vadesiz (Ortak Harcama)', 'bank',        'TRY', 0,     NULL, NULL, 0),
    (a_nakit,   hh, 'Nakit',                   'cash',        'TRY', 0,     NULL, NULL, 0),
    (a_birikim, hh, 'Birikim (TL Vadeli)',     'bank',        'TRY', 0,     NULL, NULL, 0),
    (a_k1,      hh, 'Bonus Kart',              'credit_card', 'TRY', 40000, 5,    15,   0),
    (a_k2,      hh, 'World Kart',              'credit_card', 'TRY', 60000, 20,   30,   0),
    (a_k3,      hh, 'Axess Kart',              'credit_card', 'TRY', 25000, 12,   22,   0);

  -- 2) KATEGORİLER (parent_id ile hiyerarşi: Ev → Elektrik/Su/Doğalgaz/İnternet/Aidat)
  INSERT INTO categories (id, household_id, name, type, is_recurring, budget_limit, parent_id) VALUES
    (c_maas,    hh, 'Maaş',    'income',  true,  0, NULL),
    (c_market,  hh, 'Market',  'expense', false, 0, NULL),
    (c_yemek,   hh, 'Yemek',   'expense', false, 0, NULL),
    (c_ulasim,  hh, 'Ulaşım',  'expense', false, 0, NULL),
    (c_giyim,   hh, 'Giyim',   'expense', false, 0, NULL),
    (c_saglik,  hh, 'Sağlık',  'expense', false, 0, NULL),
    (c_eglence, hh, 'Eğlence', 'expense', false, 0, NULL),
    (c_fatura,  hh, 'Fatura',  'expense', true,  0, NULL),
    (c_diger,   hh, 'Diğer',   'expense', false, 0, NULL),
    -- Ev grubu: parent bütçesiz → çocuk toplamı gösterilir, alt kategoriler açılır
    (c_ev,       hh, 'Ev',       'expense', false, 0, NULL),
    (c_elektrik, hh, 'Elektrik', 'expense', true,  0, c_ev),
    (c_su,       hh, 'Su',       'expense', true,  0, c_ev),
    (c_dogalgaz, hh, 'Doğalgaz', 'expense', true,  0, c_ev),
    (c_internet, hh, 'İnternet', 'expense', true,  0, c_ev),
    (c_aidat,    hh, 'Aidat',    'expense', true,  0, c_ev);

  -- 3) BÜTÇE (bu ay 2026-08) — Yemek aşacak, Eğlence ~%90, gerisi yolunda.
  --    Ev alt kategorilerine bütçe → parent "Ev" grup toplamı olarak görünür (hiyerarşi).
  INSERT INTO budget_periods (household_id, category_id, period, budgeted) VALUES
    (hh, c_market,   DATE '2026-08-01', 12000),
    (hh, c_yemek,    DATE '2026-08-01', 6000),
    (hh, c_ulasim,   DATE '2026-08-01', 5000),
    (hh, c_giyim,    DATE '2026-08-01', 4000),
    (hh, c_eglence,  DATE '2026-08-01', 5000),
    (hh, c_elektrik, DATE '2026-08-01', 2000),
    (hh, c_su,       DATE '2026-08-01', 700),
    (hh, c_dogalgaz, DATE '2026-08-01', 1600),
    (hh, c_internet, DATE '2026-08-01', 900),
    (hh, c_aidat,    DATE '2026-08-01', 4500);
    -- Sağlık limitsiz (bütçe bloğunda görünmez)

  -- 4) GELİR (transactions, source_type NULL → gelir ortalamasına girer)
  --    Maaşlar May..Oct (geçmiş gerçekleşen + gelecek = projeksiyon known income)
  FOR mo IN 0..5 LOOP
    -- Eş1 maaş 110.000 her ayın 5'i
    INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description)
    VALUES (hh, a_maas, c_maas, usr, 110000, 'income',
            (DATE '2026-05-05' + (mo || ' months')::interval), (DATE '2026-05-05' + (mo || ' months')::interval), 'Eş 1 Maaş');
    -- Eş2 maaş 72.000 her ayın 15'i
    INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description)
    VALUES (hh, a_maas, c_maas, usr, 72000, 'income',
            (DATE '2026-05-15' + (mo || ' months')::interval), (DATE '2026-05-15' + (mo || ' months')::interval), 'Eş 2 Maaş');
  END LOOP;

  -- Eş1 prim (çeyreklik, dalgalı; en düşük 15.000). Haziran geçmiş, Eylül gelecek.
  INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description) VALUES
    (hh, a_maas, c_maas, usr, 18000, 'income', DATE '2026-03-20', DATE '2026-03-20', 'Eş 1 Prim'),
    (hh, a_maas, c_maas, usr, 25000, 'income', DATE '2026-06-20', DATE '2026-06-20', 'Eş 1 Prim'),
    (hh, a_maas, c_maas, usr, 15000, 'income', DATE '2026-09-20', DATE '2026-09-20', 'Eş 1 Prim');
  -- Eş2 ek gelir (düzensiz)
  INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description) VALUES
    (hh, a_maas, c_maas, usr, 10000, 'income', DATE '2026-06-24', DATE '2026-06-24', 'Eş 2 Ek Gelir'),
    (hh, a_maas, c_maas, usr,  8000, 'income', DATE '2026-07-22', DATE '2026-07-22', 'Eş 2 Ek Gelir');

  -- 5) DÜZENLİ GİDER — abonelikler (gelecek projeksiyon için) + geçmiş gerçekleşen
  --    Geçmiş kayıtlar source_type='subscription', source_id NULL (aboneliği dışlamaz).
  --    next_payment_date bu ayın günü → occurrence ileri yuvarlanır.
  INSERT INTO subscriptions (household_id, category_id, name, amount, frequency, next_payment_date, status) VALUES
    (hh, c_fatura,   'Kira',            35000, 'monthly', DATE '2026-08-01', 'active'),
    (hh, c_aidat,    'Aidat',            4500, 'monthly', DATE '2026-08-05', 'active'),
    (hh, c_elektrik, 'Elektrik',         1800, 'monthly', DATE '2026-08-08', 'active'),
    (hh, c_su,       'Su',                600, 'monthly', DATE '2026-08-08', 'active'),
    (hh, c_dogalgaz, 'Doğalgaz',         1500, 'monthly', DATE '2026-08-08', 'active'),
    (hh, c_internet, 'İnternet',          900, 'monthly', DATE '2026-08-06', 'active'),
    (hh, c_fatura,   'Telefon (x2)',     1400, 'monthly', DATE '2026-08-06', 'active'),
    (hh, c_eglence, 'Netflix',           200, 'monthly', DATE '2026-08-16', 'active'),
    (hh, c_eglence, 'Spotify Duo',       120, 'monthly', DATE '2026-08-18', 'active'),
    (hh, c_eglence, 'YouTube Premium',   130, 'monthly', DATE '2026-08-20', 'active'),
    (hh, c_eglence, 'iCloud',             90, 'monthly', DATE '2026-08-12', 'active'),
    (hh, c_saglik,  'Spor Salonu (x2)', 2400, 'monthly', DATE '2026-08-14', 'active'),
    -- Yıllık kalemler — DAĞILMIŞ (Kasım'ı dar yapar)
    (hh, c_fatura,  'Kasko',           28000, 'yearly',  DATE '2026-11-15', 'active'),
    (hh, c_fatura,  'Trafik Sigortası', 6500, 'yearly',  DATE '2026-11-20', 'active'),
    (hh, c_fatura,  'MTV 1. Taksit',    4200, 'yearly',  DATE '2027-01-15', 'active'),
    (hh, c_fatura,  'DASK',             1200, 'yearly',  DATE '2027-04-10', 'active'),
    (hh, c_fatura,  'Ev Sigortası',     3500, 'yearly',  DATE '2027-04-10', 'active');

  -- Geçmiş sabit gider hareketleri (May,Haz,Tem tam; Ağu sadece gün<=10 kalemler)
  -- source_type='subscription', source_id NULL. Hesap: Vadesiz(Maaş).
  FOR mo IN 0..3 LOOP  -- 0=May,1=Haz,2=Tem,3=Ağu
    mstart := DATE '2026-05-01' + (mo || ' months')::interval;
    -- Kira (gün 1)
    INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description, source_type)
      VALUES (hh, a_maas, c_fatura, usr, 35000, 'expense', mstart, mstart, 'Ev Kirası', 'subscription');
    -- Aidat (gün 5)
    INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description, source_type)
      VALUES (hh, a_maas, c_aidat, usr, 4500, 'expense', mstart + 4, mstart + 4, 'Site Aidatı', 'subscription');
    -- Elektrik/Su/Doğalgaz (gün 8) — yaz düşük doğalgaz. Açıklamalar dağıtıcı kurumları.
    INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description, source_type) VALUES
      (hh, a_maas, c_elektrik, usr, 1800, 'expense', mstart + 7, mstart + 7, 'BEDAŞ', 'subscription'),
      (hh, a_maas, c_su,       usr,  600, 'expense', mstart + 7, mstart + 7, 'İSKİ', 'subscription'),
      (hh, a_maas, c_dogalgaz, usr,  400, 'expense', mstart + 7, mstart + 7, 'İGDAŞ', 'subscription'),
      (hh, a_maas, c_internet, usr,  900, 'expense', mstart + 5, mstart + 5, 'Superonline', 'subscription'),
      (hh, a_maas, c_fatura,   usr, 1400, 'expense', mstart + 5, mstart + 5, 'Turkcell + Vodafone', 'subscription');
    -- Gün>10 aylık kalemler yalnız TAM geçmiş aylar için (May,Haz,Tem), Ağustos'ta henüz ödenmedi
    IF mo < 3 THEN
      INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description, source_type) VALUES
        (hh, a_k3, c_eglence, usr, 200, 'expense', mstart + 15, mstart + 15, 'Netflix', 'subscription'),
        (hh, a_k3, c_eglence, usr, 120, 'expense', mstart + 17, mstart + 17, 'Spotify Duo', 'subscription'),
        (hh, a_k3, c_eglence, usr, 130, 'expense', mstart + 19, mstart + 19, 'YouTube Premium', 'subscription'),
        (hh, a_k3, c_eglence, usr,  90, 'expense', mstart + 11, mstart + 11, 'iCloud', 'subscription'),
        (hh, a_ortak, c_saglik, usr, 2400, 'expense', mstart + 13, mstart + 13, 'Spor Salonu (x2)', 'subscription');
    END IF;
    -- MTV 2. taksit Temmuz (geçmiş, gerçekleşen)
    IF mo = 2 THEN
      INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description, source_type)
        VALUES (hh, a_maas, c_fatura, usr, 4200, 'expense', DATE '2026-07-15', DATE '2026-07-15', 'MTV 2. Taksit', 'subscription');
    END IF;
  END LOOP;

  -- 6) TAKSİTLER (kart_taksidi) — her ödeme için installment_payment + transaction
  --    Buzdolabı: 9 taksit 3200, 4 ay önce başladı (5 kaldı) → kart k1
  --    Telefon:   12 taksit 2800, 6 ay önce (6 kaldı) → kart k2
  --    Koltuk:    6 taksit 4100, 2 ay önce (4 kaldı, ~Aralık biter → relief) → kart k1
  --    Kredi:     İhtiyaç 6800, 14 taksit kaldı → Vadesiz(Maaş)

  -- Buzdolabı
  inst_id := gen_random_uuid();
  INSERT INTO installments (id, household_id, account_id, category_id, description, total_amount, installments_count, start_date, kind)
    VALUES (inst_id, hh, a_k1, c_diger, 'Buzdolabı', 3200*9, 9, DATE '2026-04-01', 'kart_taksidi');
  FOR n IN 1..9 LOOP
    pdate := DATE '2026-04-01' + ((n-1) || ' months')::interval;
    pay_id := gen_random_uuid();
    INSERT INTO installment_payments (id, installment_id, amount, installment_number, payment_date, status)
      VALUES (pay_id, inst_id, 3200, n, pdate, CASE WHEN pdate <= today THEN 'paid' ELSE 'pending' END);
    INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description, source_type, source_id)
      VALUES (hh, a_k1, c_diger, usr, 3200, 'expense', pdate, pdate, 'Buzdolabı Taksit '||n||'/9', 'installment', pay_id);
  END LOOP;

  -- Telefon
  inst_id := gen_random_uuid();
  INSERT INTO installments (id, household_id, account_id, category_id, description, total_amount, installments_count, start_date, kind)
    VALUES (inst_id, hh, a_k2, c_diger, 'Telefon', 2800*12, 12, DATE '2026-02-01', 'kart_taksidi');
  FOR n IN 1..12 LOOP
    pdate := DATE '2026-02-01' + ((n-1) || ' months')::interval;
    pay_id := gen_random_uuid();
    INSERT INTO installment_payments (id, installment_id, amount, installment_number, payment_date, status)
      VALUES (pay_id, inst_id, 2800, n, pdate, CASE WHEN pdate <= today THEN 'paid' ELSE 'pending' END);
    INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description, source_type, source_id)
      VALUES (hh, a_k2, c_diger, usr, 2800, 'expense', pdate, pdate, 'Telefon Taksit '||n||'/12', 'installment', pay_id);
  END LOOP;

  -- Koltuk (Aralık'ta biter → "taksit yükü kalkıyor")
  inst_id := gen_random_uuid();
  INSERT INTO installments (id, household_id, account_id, category_id, description, total_amount, installments_count, start_date, kind)
    VALUES (inst_id, hh, a_k1, c_diger, 'Koltuk Takımı', 4100*6, 6, DATE '2026-06-01', 'kart_taksidi');
  FOR n IN 1..6 LOOP
    pdate := DATE '2026-06-01' + ((n-1) || ' months')::interval;
    pay_id := gen_random_uuid();
    INSERT INTO installment_payments (id, installment_id, amount, installment_number, payment_date, status)
      VALUES (pay_id, inst_id, 4100, n, pdate, CASE WHEN pdate <= today THEN 'paid' ELSE 'pending' END);
    INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description, source_type, source_id)
      VALUES (hh, a_k1, c_diger, usr, 4100, 'expense', pdate, pdate, 'Koltuk Takımı '||n||'/6', 'installment', pay_id);
  END LOOP;

  -- İhtiyaç kredisi (kind='kredi') — 14 taksit kaldı, source Vadesiz(Maaş)
  inst_id := gen_random_uuid();
  INSERT INTO installments (id, household_id, account_id, category_id, description, total_amount, installments_count, start_date, kind, source_account_id)
    VALUES (inst_id, hh, a_maas, c_fatura, 'İhtiyaç Kredisi', 6800*18, 18, DATE '2026-03-05', 'kredi', a_maas);
  FOR n IN 1..18 LOOP
    pdate := DATE '2026-03-05' + ((n-1) || ' months')::interval;
    pay_id := gen_random_uuid();
    INSERT INTO installment_payments (id, installment_id, amount, installment_number, payment_date, status)
      VALUES (pay_id, inst_id, 6800, n, pdate, CASE WHEN pdate <= today THEN 'paid' ELSE 'pending' END);
    INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description, source_type, source_id)
      VALUES (hh, a_maas, c_fatura, usr, 6800, 'expense', pdate, pdate, 'İhtiyaç Kredisi '||n||'/18', 'installment', pay_id);
  END LOOP;

  -- 7) DEĞİŞKEN HARCAMA (transactions, source_type NULL) — May,Haz,Tem tam; Ağu kısmi
  --    (kategori, hesap, [May,Haz,Tem,Ağu] toplam, [May,Haz,Tem,Ağu] adet)
  FOR vrows IN
    SELECT * FROM (VALUES
      -- Hepsi Ortak Harcama hesabından; Ağustos bütçe hedefleriyle uyumlu.
      -- Market: Tem düşük, Ağu (kısmi) Tem'i geçer → fiyat artışı insight (adet sabit)
      (c_market,  a_ortak, ARRAY[10000,9500,8000,9500]::numeric[],  ARRAY[8,8,7,7]),
      (c_yemek,   a_ortak, ARRAY[17000,18000,17500,6400]::numeric[], ARRAY[10,10,9,7]),
      (c_ulasim,  a_ortak, ARRAY[7000,7500,7000,3500]::numeric[],   ARRAY[6,6,6,5]),
      (c_giyim,   a_ortak, ARRAY[9000,10000,8000,2500]::numeric[],  ARRAY[3,4,3,2]),
      (c_eglence, a_ortak, ARRAY[20000,21000,19000,4700]::numeric[], ARRAY[8,8,7,6]),
      (c_saglik,  a_ortak, ARRAY[2500,3000,3500,900]::numeric[],    ARRAY[2,2,3,1]),
      (c_diger,   a_ortak, ARRAY[13000,14000,13000,1200]::numeric[], ARRAY[5,5,5,2])
    ) AS t(cat, acct, totals, counts)
  LOOP
    FOR mo IN 0..3 LOOP
      mstart := DATE '2026-05-01' + (mo || ' months')::interval;
      vtot   := vrows.totals[mo+1];
      vcount := vrows.counts[mo+1];
      vcat   := vrows.cat;
      vacct  := vrows.acct;
      IF vcount > 0 AND vtot > 0 THEN
        each_amt := round(vtot / vcount);
        -- Gerçekçi açıklamalar (kategori bazlı, döngüsel) — kullanıcının yazacağı gibi.
        desc_arr := CASE vcat
          WHEN c_market  THEN ARRAY['Migros','Şok Market','BİM','A101','CarrefourSA','Macrocenter','Getir','Metro Market']
          WHEN c_yemek   THEN ARRAY['Yemeksepeti','Getir Yemek','Starbucks','Burger King','Domino''s','Kahve Dünyası','Öğle yemeği','Trendyol Yemek']
          WHEN c_ulasim  THEN ARRAY['İstanbulkart','Shell','Opet','Taksi','Uber','Otopark','BP Akaryakıt']
          WHEN c_giyim   THEN ARRAY['LC Waikiki','Zara','Mavi','H&M','Decathlon','Boyner']
          WHEN c_eglence THEN ARRAY['Cinemaximum','Konser bileti','Steam','Bowling','Tiyatro','Bar']
          WHEN c_saglik  THEN ARRAY['Eczane','Diş hekimi','Doktor muayene','Optik','Fizyoterapi']
          WHEN c_diger   THEN ARRAY['Kırtasiye','Berber','Kuru temizleme','Hediye','Çiçekçi','Nalbur']
          ELSE ARRAY['Harcama']
        END;
        FOR i IN 1..vcount LOOP
          -- Ağustos kısmi (bugün 13): değişken harcama ay ortasına kayar (base+4),
          -- kategori bazlı faz + yayma → gün 5..11. İlk günler hafif → tempo çizgisi
          -- beklenenin ALTINDA (yeşil) başlar, harcama hızlanınca sarı→kırmızıya döner.
          IF mo = 3 THEN d := mstart + 4
                            + (CASE vcat WHEN c_yemek THEN 1 WHEN c_ulasim THEN 2 WHEN c_giyim THEN 3
                                         WHEN c_eglence THEN 1 WHEN c_saglik THEN 3 WHEN c_diger THEN 2 ELSE 0 END)
                            + ((i-1) * 3 / GREATEST(vcount,1));
          ELSE            d := mstart + ((i-1) * 27 / GREATEST(vcount,1)); END IF;
          INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description)
          VALUES (hh, vacct, vcat, usr,
                  CASE WHEN i = vcount THEN vtot - each_amt*(vcount-1) ELSE each_amt END,
                  'expense', d, d, desc_arr[1 + ((i-1) % array_length(desc_arr,1))]);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- 8) BEKLENMEDİK TEK SEFERLİKLER
  INSERT INTO transactions (household_id, account_id, category_id, user_id, amount, type, transaction_date, cash_date, description) VALUES
    (hh, a_ortak, c_saglik,  usr, 8500, 'expense', DATE '2026-06-12', DATE '2026-06-12', 'Diş Tedavisi'),
    (hh, a_k2,    c_ulasim,  usr, 6200, 'expense', DATE '2026-07-18', DATE '2026-07-18', 'Araç Lastik Değişimi'),
    (hh, a_ortak, c_eglence, usr, 3500, 'expense', DATE '2026-06-28', DATE '2026-06-28', 'Doğum Günü Hediyesi'),
    (hh, a_ortak, c_diger,   usr, 2800, 'expense', DATE '2026-07-24', DATE '2026-07-24', 'Ev Tamiri (Tesisatçı)');

  -- 8b) AYLIK TRANSFERLER — gelir maaş hesabından harcama/birikime akar.
  --     Böylece hesaplar ay-ay stabil kalır (geçmiş net değer pozitif).
  --     Transferler flow/bütçe/runway'a girmez (transfer_direction).
  FOR mo IN 0..3 LOOP  -- May,Haz,Tem,Ağu
    mstart := DATE '2026-05-01' + (mo || ' months')::interval;
    -- Maaş → Ortak (değişken harcamayı fonlar). Ağustos kısmi.
    grp := gen_random_uuid();
    INSERT INTO transactions (household_id, account_id, user_id, amount, type, transaction_date, cash_date, description, transfer_group_id, transfer_direction) VALUES
      (hh, a_maas,  usr, CASE WHEN mo=3 THEN 25000 ELSE 88000 END, 'transfer', mstart+2, mstart+2, 'Ortak hesaba aktarım', grp, 'out'),
      (hh, a_ortak, usr, CASE WHEN mo=3 THEN 25000 ELSE 88000 END, 'transfer', mstart+2, mstart+2, 'Ortak hesaba aktarım', grp, 'in');
    -- Maaş → Birikim (tasarruf). Ağustos kısmi.
    grp := gen_random_uuid();
    INSERT INTO transactions (household_id, account_id, user_id, amount, type, transaction_date, cash_date, description, transfer_group_id, transfer_direction) VALUES
      (hh, a_maas,    usr, CASE WHEN mo=3 THEN 8000 ELSE 22000 END, 'transfer', mstart+6, mstart+6, 'Birikime aktarım', grp, 'out'),
      (hh, a_birikim, usr, CASE WHEN mo=3 THEN 8000 ELSE 22000 END, 'transfer', mstart+6, mstart+6, 'Birikime aktarım', grp, 'in');
  END LOOP;

  -- 9) YATIRIMLAR (değerleme networth'te kur ile: symbol USD/ALTIN)
  INSERT INTO investments (household_id, name, symbol, quantity, unit, average_cost, type) VALUES
    (hh, 'Gram Altın', 'ALTIN', 15,   'gr',  2700, 'commodity'),
    (hh, 'Dolar',      'USD',   2000, 'adet', 32,  'commodity');

  -- 10) HEDEFLER — saved_tl artık BAŞLANGIÇ bakiyesi (hedef sisteme girmeden önce
  --     birikmiş); gerçekleşen katkılar goal_contributions'ta. monthly_alloc PLANLANAN.
  INSERT INTO goals (id, household_id, name, target_amount, saved_tl, total_cost_tl, period, is_fiat, deadline, icon, created_at, monthly_alloc, source_account_id, status) VALUES
    (g_yaz,   hh, 'Yaz Tatili',      80000,  11000, 35000, 'yearly',  true, DATE '2027-06-15', '🏖️', DATE '2026-03-01', 8000,  a_birikim, 'aktif'),
    (g_araba, hh, 'Araba Peşinatı', 300000,  40000, 90000, 'yearly',  true, DATE '2028-01-01', '🚗', DATE '2025-11-01', 10000, a_birikim, 'aktif');

  -- Gerçekleşen katkılar (tik şeridi). Yaz Tatili Haziran'ı ATLADI → boş çember.
  INSERT INTO goal_contributions (household_id, goal_id, period, amount, account_id) VALUES
    (hh, g_yaz,   DATE '2026-04-01',  8000, a_birikim),
    (hh, g_yaz,   DATE '2026-05-01',  8000, a_birikim),
    (hh, g_yaz,   DATE '2026-07-01',  8000, a_birikim),
    (hh, g_yaz,   DATE '2026-08-01',  8000, a_birikim),
    (hh, g_araba, DATE '2026-03-01', 10000, a_birikim),
    (hh, g_araba, DATE '2026-04-01', 10000, a_birikim),
    (hh, g_araba, DATE '2026-05-01', 10000, a_birikim),
    (hh, g_araba, DATE '2026-06-01', 10000, a_birikim),
    (hh, g_araba, DATE '2026-07-01', 10000, a_birikim),
    (hh, g_araba, DATE '2026-08-01', 10000, a_birikim);

  -- 11) OPENING_BALANCE geri-hesaplama: bugünkü türetilmiş bakiye = hedef
  --     (kart hesapları 0 açılışta; borç taksitlerden gelir)
  UPDATE accounts a SET opening_balance = tgt - COALESCE((
      SELECT sum(CASE
              WHEN t.type='income' THEN t.amount
              WHEN t.type='expense' THEN -t.amount
              WHEN t.type='transfer' AND t.transfer_direction='in' THEN t.amount
              WHEN t.type='transfer' AND t.transfer_direction='out' THEN -t.amount
              ELSE 0 END)
      FROM transactions t WHERE t.account_id = a.id AND t.cash_date <= today
    ), 0)
  FROM (VALUES (a_maas, 85000::numeric), (a_ortak, 20000), (a_nakit, 5000), (a_birikim, 150000)) AS v(id, tgt)
  WHERE a.id = v.id;

END $$;
