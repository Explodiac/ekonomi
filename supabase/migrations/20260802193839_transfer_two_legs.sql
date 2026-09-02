-- Transferler iki bacak olarak yazılıyor.
--
-- Önceki durum: uygulama transfer işlemlerinde şemada olmayan to_account_id
-- kolonunu yazmaya çalışıyordu, bu yüzden HER transfer PGRST204 ile başarısız
-- oluyordu (hesaplar arası transfer ve kredi kartı ödemesi hiç çalışmıyordu).
--
-- Yeni yapı: bir transfer iki satırdır.
--     çıkış bacağı  -> kaynak hesapta,  transfer_direction = 'out'
--     giriş bacağı  -> hedef hesapta,   transfer_direction = 'in'
-- İkisi aynı transfer_group_id ile bağlanır.
--
-- Böylece her hesap yalnızca kendi satırlarını toplar; bakiye türetmek için
-- JOIN gerekmez ve karşı bacağı görünmeyen hesap sorunu ortadan kalkar.
--
-- YÖN KONVANSİYONU: amount her zaman POZİTİF kalır (kod tabanındaki mevcut
-- kural; örn. AccountModal Math.abs kullanıyor). Yön ayrı bir kolonda tutulur.
-- Alternatif olan "giriş bacağını negatif amount ile yaz" yaklaşımı
-- lib/balance.ts'i hiç değiştirmezdi, ama amount'a negatif değer sokup
-- para biçimlendirmesini ve sum(amount) alan raporlamaları bozardı.

alter table public.transactions
    add column transfer_group_id uuid,
    add column transfer_direction text check (transfer_direction in ('out', 'in'));

create index transactions_transfer_group_idx on public.transactions (transfer_group_id);

-- Bir bacak silindiğinde diğeri de silinsin. Uygulama tarafında da siliniyor,
-- ama yarım transfer en kötü senaryo olduğu için veritabanı seviyesinde de
-- garanti altına alınıyor (doğrudan SQL ile silme, farklı bir istemci vb.).
create or replace function public.delete_transfer_sibling()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if old.transfer_group_id is not null then
        delete from public.transactions
        where transfer_group_id = old.transfer_group_id
          and id <> old.id;
    end if;
    return old;
end;
$$;

create trigger transactions_delete_transfer_sibling
    after delete on public.transactions
    for each row
    execute function public.delete_transfer_sibling();
