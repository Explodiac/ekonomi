-- installments tablosu banka kredilerini de kapsayacak şekilde genelleştiriliyor.
--
-- Kredi kartı taksidi ile banka kredisi projeksiyon açısından aynı şeydir:
-- sabit aylık ödeme, belirli adet, belirli başlangıç. Bu yüzden ayrı tablo açmak
-- yerine mevcut tabloya tür bilgisi ekleniyor.
--
-- kind = 'kart_taksidi' -> ödeme account_id'deki kredi kartından çıkar (mevcut davranış)
-- kind = 'kredi'        -> ödeme source_account_id'deki banka hesabından çıkar
--
-- Faiz oranı ve kalan anapara bilinçli olarak eklenmiyor: projeksiyon için aylık
-- ödeme tutarı ve kalan taksit adedi yeterli. Erken kapatma hesabı gerektiğinde
-- ayrıca eklenebilir.

alter table public.installments
    add column kind text not null default 'kart_taksidi'
        check (kind in ('kart_taksidi', 'kredi')),
    add column source_account_id uuid references public.accounts(id);

-- Kredide ödemenin çıkacağı hesap zorunlu; kart taksidinde account_id zaten var.
alter table public.installments
    add constraint installments_kredi_needs_source_check check (
        kind <> 'kredi' or source_account_id is not null
    );

create index installments_kind_idx on public.installments (kind);
