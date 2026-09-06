-- Son kullanılan hesap: gider eklerken varsayılan hesabı hatırla.
-- settings household başına tek satır olduğu için bu değer household düzeyinde
-- paylaşılır (son gideri kim eklediyse onun hesabı). Hesap silinirse NULL'a
-- düşer, form o zaman eski varsayılana (bank/cash) geri döner. Additive.
ALTER TABLE public.settings
    ADD COLUMN IF NOT EXISTS last_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;
