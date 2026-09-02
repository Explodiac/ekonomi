-- Data API erişim izinleri.
--
-- Tablolar postgres rolüyle oluşturuldu ve `authenticated` rolüne DML izni verilmedi
-- (sadece REFERENCES/TRIGGER/TRUNCATE vardı). Bu yüzden RLS düzeltildikten sonra bile
-- her sorgu "permission denied for table ..." dönüyordu.
--
-- Eski Supabase projelerinde public şemadaki yeni tablolar Data API rollerine
-- otomatik açılıyordu; yeni davranışta açılmıyor (config.toml'daki
-- auto_expose_new_tables notuna bakınız — o ayar 2026-10-30'da kaldırılıyor).
-- Bu yüzden izinleri açıkça veriyoruz: hem lokalde hem yeni bir prod projesinde çalışır.
--
-- GRANT tabloyu role açar, RLS hangi satırların görüneceğine karar verir. İkisi ayrı
-- katman; buradaki izinler RLS'i zayıflatmaz.
--
-- anon rolüne bilerek izin verilmiyor: uygulama her zaman oturum açmış halde çalışıyor
-- ve households_insert_policy'nin WITH CHECK (true) olması nedeniyle anon'a yazma izni
-- vermek açık kapı bırakırdı.

grant select, insert, update, delete on table
    public.households,
    public.household_members,
    public.categories,
    public.accounts,
    public.transactions,
    public.investments,
    public.goals,
    public.subscriptions,
    public.contracts,
    public.contract_payments,
    public.installments,
    public.installment_payments,
    public.notifications
to authenticated;
