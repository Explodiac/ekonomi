-- Bakiyeyi türetilebilir hale getir.
--
-- accounts.balance 20 ayrı yerden artımlı yazılıyor ve hiçbir zaman yeniden
-- hesaplanmıyor; doğrulanabilir bir sayı değil. opening_balance eklendikten sonra
-- gerçekleşen bakiye şöyle türetilebilir:
--     opening_balance + Σ(cash_date <= bugün olan hareketlerin etkisi)
--
-- Backfill, bugünkü rakamları DEĞİŞTİRMEZ: opening_balance her hesap için
-- "mevcut balance eksi tüm hareketlerin net etkisi" olarak hesaplanıyor, böylece
-- türetilmiş değer bugün itibarıyla saklanan balance ile birebir aynı çıkıyor.
-- Değişen tek şey, sayının nereden geldiğinin açıklanabilir olması.
--
-- İşaret kuralı (lib/balance.ts ile aynı olmak zorunda):
--     income   -> +amount
--     expense  -> -amount
--     transfer -> -amount  (transfer satırı her zaman parayı gönderen hesaba yazılıyor)

alter table public.accounts
    add column opening_balance numeric(14,2) not null default 0;

update public.accounts a
set opening_balance = a.balance - coalesce((
    select sum(
        case when t.type = 'income' then t.amount else -t.amount end
    )
    from public.transactions t
    where t.account_id = a.id
), 0);
