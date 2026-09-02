-- Nakit çıkış tarihi: harcamanın yapıldığı gün (transaction_date) ile paranın
-- hesaptan fiilen çıktığı gün (cash_date) ayrışıyor. Kredi kartı harcamalarında
-- bu ikisi farklı olabilir (ekstre kesim/son ödeme gününe göre); diğer tüm
-- hesap tiplerinde ikisi aynı kalır.

alter table public.transactions add column cash_date date;

update public.transactions
set cash_date = transaction_date::date
where cash_date is null;

alter table public.transactions alter column cash_date set not null;

create index transactions_cash_date_idx on public.transactions (cash_date);
