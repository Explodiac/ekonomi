-- Veri tutarlılık denetimi — SALT OKUNUR, otomatik düzeltme YOK.
-- Her kontrol: 0 satır = geçti; satır varsa = sorunlu kayıtlar listelenir.
-- Kullanım: npm run db:audit
SET default_transaction_read_only = on;
\pset pager off
\timing off

\echo '════════════════════════════════════════════════════════'
\echo ' VERİ DENETİMİ (salt okunur)  ·  bugün = CURRENT_DATE'
\echo '════════════════════════════════════════════════════════'

-- Ortak: işaret kuralı (transactionEffect) ve türetilmiş bakiye.
-- Türetilmiş güncel bakiye = opening_balance + Σ(transaction_date <= bugün etkisi).

\echo ''
\echo '───── BAKİYE ─────'

\echo '• [B1] Kredi kartı limit aşımı (borç > limit):'
SELECT a.name, a.credit_limit,
  round(-(a.opening_balance + COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount WHEN t.type='transfer' THEN (CASE WHEN t.transfer_direction='in' THEN t.amount ELSE -t.amount END) ELSE -t.amount END) FILTER (WHERE t.transaction_date::date <= CURRENT_DATE), 0))) AS borc
FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
WHERE a.type = 'credit_card'
GROUP BY a.id, a.name, a.credit_limit, a.opening_balance
HAVING -(a.opening_balance + COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount WHEN t.type='transfer' THEN (CASE WHEN t.transfer_direction='in' THEN t.amount ELSE -t.amount END) ELSE -t.amount END) FILTER (WHERE t.transaction_date::date <= CURRENT_DATE), 0)) > a.credit_limit;

\echo '• [B2] Esnek hesap (KMH) limit aşımı (kullanılan kredi > limit):'
SELECT a.name, a.credit_limit,
  round(-(a.opening_balance + COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount WHEN t.type='transfer' THEN (CASE WHEN t.transfer_direction='in' THEN t.amount ELSE -t.amount END) ELSE -t.amount END) FILTER (WHERE t.transaction_date::date <= CURRENT_DATE), 0))) AS kullanilan
FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
WHERE a.type = 'esnek_hesap' AND a.credit_limit > 0
GROUP BY a.id, a.name, a.credit_limit, a.opening_balance
HAVING -(a.opening_balance + COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount WHEN t.type='transfer' THEN (CASE WHEN t.transfer_direction='in' THEN t.amount ELSE -t.amount END) ELSE -t.amount END) FILTER (WHERE t.transaction_date::date <= CURRENT_DATE), 0)) > a.credit_limit;

\echo ''
\echo '───── TARİHLER ─────'

\echo '• [T1] cash_date < transaction_date olan kayıtlar (mantıksız — para harcamadan önce çıkamaz):'
SELECT t.id, a.name AS hesap, t.transaction_date::date AS tx, t.cash_date, t.description
FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
WHERE t.cash_date < t.transaction_date::date
ORDER BY t.transaction_date DESC LIMIT 100;

\echo '• [T2] Kart harcamasının cash_date günü, kartın son ödeme (due) gününe denk gelmiyor (transfer hariç):'
SELECT t.id, a.name AS kart, a.due_date, t.cash_date, EXTRACT(DAY FROM t.cash_date)::int AS cash_gun
FROM transactions t JOIN accounts a ON a.id = t.account_id
WHERE a.type='credit_card' AND a.due_date IS NOT NULL
  AND t.type <> 'transfer' AND t.transfer_direction IS NULL
  AND EXTRACT(DAY FROM t.cash_date)::int <> LEAST(a.due_date, EXTRACT(DAY FROM (date_trunc('month', t.cash_date) + INTERVAL '1 month' - INTERVAL '1 day'))::int)
ORDER BY t.transaction_date DESC LIMIT 100;

\echo '• [T3] transaction_date, hesabın oluşturulma tarihinden ÖNCE olanlar:'
SELECT t.id, a.name AS hesap, t.transaction_date::date AS tx, a.created_at::date AS hesap_olusturma, t.description
FROM transactions t JOIN accounts a ON a.id = t.account_id
WHERE t.transaction_date::date < a.created_at::date
ORDER BY t.transaction_date LIMIT 100;

\echo '• [T4] Gelecek tarihli transaction — KAYNAĞI OLMAYAN (taksit/abonelik/kontrat değil; kasıtlı mı?):'
SELECT t.id, a.name AS hesap, t.transaction_date::date AS tx, t.type, t.source_type, t.description
FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
WHERE t.transaction_date::date > CURRENT_DATE AND t.source_type IS NULL
ORDER BY t.transaction_date LIMIT 100;

\echo ''
\echo '───── ABONELİK / KONTRAT / TAKSİT ─────'

\echo '• [S1] Aktif abonelik, next_payment_date bugünden ESKİ (gecikmiş):'
SELECT name, amount, next_payment_date, frequency FROM subscriptions
WHERE status='active' AND next_payment_date < CURRENT_DATE ORDER BY next_payment_date;

\echo '• [S2] Aktif kontrat, next_payment_date bugünden ESKİ (gecikmiş):'
SELECT name, amount, next_payment_date, frequency FROM contracts
WHERE status='active' AND next_payment_date < CURRENT_DATE ORDER BY next_payment_date;

\echo '• [S3] end_date GEÇMİŞ ama hâlâ active (abonelik / kontrat):'
SELECT 'abonelik' AS tur, name, end_date FROM subscriptions WHERE status='active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE
UNION ALL
SELECT 'kontrat', name, end_date FROM contracts WHERE status='active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE;

\echo '• [S4] paid işaretli kontrat ödemesi VAR ama karşılık transaction YOK:'
SELECT cp.id AS payment_id, c.name AS kontrat, cp.amount, cp.expected_date
FROM contract_payments cp JOIN contracts c ON c.id = cp.contract_id
WHERE cp.status='paid'
  AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.source_type='contract' AND t.source_id = cp.id)
ORDER BY cp.expected_date DESC LIMIT 100;

\echo '• [S5] transaction VAR (source_type=contract) ama karşılık contract_payment paid DEĞİL (veya yok):'
SELECT t.id AS tx_id, t.amount, t.transaction_date::date AS tx, t.description
FROM transactions t
WHERE t.source_type='contract' AND t.source_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contract_payments cp WHERE cp.id = t.source_id AND cp.status='paid')
ORDER BY t.transaction_date DESC LIMIT 100;

\echo '• [S6] Taksit ödemesi paid ama karşılık transaction yok (source_type=installment):'
SELECT ip.id AS payment_id, i.description AS taksit, ip.amount, ip.payment_date
FROM installment_payments ip JOIN installments i ON i.id = ip.installment_id
WHERE ip.status='paid'
  AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.source_type='installment' AND t.source_id = ip.id)
ORDER BY ip.payment_date DESC LIMIT 100;

\echo '• [S7] contract_payments: aynı kontrat için MÜKERRER expected_date:'
SELECT c.name AS kontrat, cp.expected_date, count(*) AS adet
FROM contract_payments cp JOIN contracts c ON c.id = cp.contract_id
GROUP BY c.name, cp.expected_date HAVING count(*) > 1 ORDER BY c.name, cp.expected_date;

\echo '• [S8] Aynı kalem hem ABONELİK hem MANUEL gider olabilir (isim+tutar benzerliği, aynı ay):'
SELECT s.name AS abonelik, s.amount, t.id AS tx_id, t.transaction_date::date AS tx, t.description
FROM subscriptions s JOIN transactions t
  ON t.type='expense' AND t.source_type IS NULL
  AND abs(t.amount - s.amount) < 0.01
  AND lower(t.description) LIKE '%' || lower(split_part(s.name,' ',1)) || '%'
ORDER BY t.transaction_date DESC LIMIT 100;

\echo ''
\echo '───── VERİ KALİTESİ ─────'

\echo '• [Q1] Kategorisiz gelir/gider (transfer hariç):'
SELECT t.id, a.name AS hesap, t.type, t.amount, t.transaction_date::date AS tx, t.description
FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
WHERE t.category_id IS NULL AND t.type IN ('income','expense')
ORDER BY t.transaction_date DESC LIMIT 100;

\echo '• [Q2] amount <= 0 olan kayıtlar:'
SELECT id, type, amount, transaction_date::date AS tx, description FROM transactions
WHERE amount <= 0 ORDER BY transaction_date DESC LIMIT 100;

\echo '• [Q3] Yetim transaction — hesabı silinmiş (account_id dolu ama accounts''ta yok):'
SELECT t.id, t.account_id, t.amount, t.transaction_date::date AS tx, t.description
FROM transactions t
WHERE t.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = t.account_id)
ORDER BY t.transaction_date DESC LIMIT 100;

\echo '• [Q4] Yetim transaction — kategorisi silinmiş (category_id dolu ama categories''ta yok):'
SELECT t.id, t.category_id, t.type, t.amount, t.transaction_date::date AS tx
FROM transactions t
WHERE t.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = t.category_id)
ORDER BY t.transaction_date DESC LIMIT 100;

\echo '• [Q5] household_id tutarsızlığı — transaction ile hesabı farklı household:'
SELECT t.id, t.household_id AS tx_hh, a.household_id AS acc_hh, a.name AS hesap
FROM transactions t JOIN accounts a ON a.id = t.account_id
WHERE t.household_id IS DISTINCT FROM a.household_id
LIMIT 100;

\echo '• [Q6] Transfer bütünlüğü — bacak sayısı 2 DEĞİL olan gruplar:'
SELECT transfer_group_id, count(*) AS bacak
FROM transactions WHERE transfer_group_id IS NOT NULL
GROUP BY transfer_group_id HAVING count(*) <> 2 LIMIT 100;

\echo '• [Q7] Transfer bütünlüğü — iki bacağın tutarı eşit değil, ya da yönler in/out değil:'
SELECT transfer_group_id,
  count(DISTINCT amount) AS farkli_tutar,
  bool_or(transfer_direction='in') AS in_var, bool_or(transfer_direction='out') AS out_var
FROM transactions WHERE transfer_group_id IS NOT NULL
GROUP BY transfer_group_id
HAVING count(DISTINCT amount) > 1 OR NOT (bool_or(transfer_direction='in') AND bool_or(transfer_direction='out'))
LIMIT 100;

\echo ''
\echo '════════════════════════════════════════════════════════'
\echo ' Denetim bitti. Her başlıkta 0 satır = geçti.'
\echo '════════════════════════════════════════════════════════'
