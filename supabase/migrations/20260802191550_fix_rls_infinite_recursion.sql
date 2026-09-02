-- RLS sonsuz döngü düzeltmesi.
--
-- Sorun: household_members üzerindeki SELECT politikası kendi tablosunu sorguluyordu:
--     USING (user_id = auth.uid() OR household_id IN
--            (SELECT household_id FROM household_members WHERE user_id = auth.uid()))
-- Postgres bunu "infinite recursion detected in policy for relation household_members"
-- ile reddediyor. Diğer tüm tablolar da household_members'a subquery attığı için
-- onlar da veri döndüremiyordu — yani RLS açıkken uygulama hiç çalışmıyordu.
--
-- Çözüm: kullanıcının household'larını SECURITY DEFINER bir fonksiyondan okumak.
-- Fonksiyon sahibi olarak çalıştığı için household_members'ın RLS'ini tetiklemez,
-- döngü kırılır. Güvenlik anlamı DEĞİŞMEZ: fonksiyon yalnızca auth.uid()'ye ait
-- satırları döndürür, dolayısıyla politikalar eskisiyle aynı kümeyi görür.
-- Bu düzeltme lokale özel değildir, prod'a olduğu gibi taşınabilir.

create or replace function public.current_user_household_ids()
returns setof uuid
language sql
security definer
stable
-- search_path sabitlenmeli: sabitlenmemiş SECURITY DEFINER fonksiyonda çağıran,
-- kendi geçici şemasına sahte nesne koyup fonksiyonu kandırabilir. pg_temp'i
-- sona koymak bu gölgelemeyi engeller.
set search_path = public, pg_temp
as $$
    select household_id
    from public.household_members
    where user_id = auth.uid()
$$;

revoke all on function public.current_user_household_ids() from public;
grant execute on function public.current_user_household_ids() to authenticated, anon, service_role;

-- household_members: özyinelemeli olan tek politika buydu.
drop policy if exists "members_select_policy" on public.household_members;
create policy "members_select_policy" on public.household_members for select
using (
    user_id = auth.uid()
    or household_id in (select public.current_user_household_ids())
);

-- Aşağıdakiler kendi başlarına özyinelemeli değildi, ama household_members'ı
-- sorguladıkları için onun bozuk politikasını tetikliyorlardı. Fonksiyona çevriliyorlar.

drop policy if exists "households_select_policy" on public.households;
create policy "households_select_policy" on public.households for select
using (id in (select public.current_user_household_ids()));

drop policy if exists "categories_policy" on public.categories;
create policy "categories_policy" on public.categories for all
using (household_id in (select public.current_user_household_ids()));

drop policy if exists "accounts_policy" on public.accounts;
create policy "accounts_policy" on public.accounts for all
using (household_id in (select public.current_user_household_ids()));

drop policy if exists "transactions_policy" on public.transactions;
create policy "transactions_policy" on public.transactions for all
using (household_id in (select public.current_user_household_ids()));

drop policy if exists "investments_policy" on public.investments;
create policy "investments_policy" on public.investments for all
using (household_id in (select public.current_user_household_ids()));

drop policy if exists "goals_policy" on public.goals;
create policy "goals_policy" on public.goals for all
using (household_id in (select public.current_user_household_ids()));

drop policy if exists "subscriptions_policy" on public.subscriptions;
create policy "subscriptions_policy" on public.subscriptions for all
using (household_id in (select public.current_user_household_ids()));

drop policy if exists "contracts_policy" on public.contracts;
create policy "contracts_policy" on public.contracts for all
using (household_id in (select public.current_user_household_ids()));

drop policy if exists "installments_policy" on public.installments;
create policy "installments_policy" on public.installments for all
using (household_id in (select public.current_user_household_ids()));

drop policy if exists "notifications_policy" on public.notifications;
create policy "notifications_policy" on public.notifications for all
using (household_id in (select public.current_user_household_ids()));

-- contract_payments ve installment_payments politikaları üst tablolarına
-- (contracts / installments) subquery atıyor; onlar artık düzgün çalıştığı için
-- bu ikisine dokunmaya gerek yok.
