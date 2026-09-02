-- Tekilleştirme: bir yükümlülüğün (abonelik/sözleşme/taksit) gerçek transactions
-- satırı varsa, upcoming/projection motorları onu tekrar üretmemeli. Bu artık
-- next_payment_date'in ileri atılmış olmasına ya da status='paid' alanına değil,
-- doğrudan bu FK'ye bakarak karar verilecek.

alter table public.transactions
  add column source_type text check (source_type in ('subscription', 'contract', 'installment')),
  add column source_id uuid;

create index transactions_source_idx on public.transactions (source_type, source_id);

-- Backfill: sadece installment_payments üzerinden geriye dönük eşleme mümkün
-- (subscriptions/contracts için transactions'a geri referans hiç tutulmamış,
-- geçmiş kayıtlar bu yüzden boş kalacak; bundan sonraki satırlar için
-- uygulama kodu source_type/source_id'yi insert sırasında dolduracak).
update public.transactions t
set source_type = 'installment',
    source_id = ip.id
from public.installment_payments ip
where ip.transaction_id = t.id;
