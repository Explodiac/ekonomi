-- transfer_group_id / transfer_direction tutarlılığı.
--
-- Bu iki alan yalnızca birlikte anlamlıdır: bir satır ya iki bacaklı bir
-- transferin parçasıdır (ikisi de dolu, tip 'transfer'), ya da hiç değildir
-- (ikisi de boş). Aradaki her durum sessiz bir bakiye hatasına yol açar:
--   - gider satırında yön dolu olursa işaret ters döner
--   - yön dolu ama grup boşsa karşı bacak bulunamaz, silme yarım kalır
--   - grup dolu ama yön boşsa iki bacak da çıkış sayılır, para kaybolur
--
-- NOT: "her type='transfer' satırının bir grubu olmalı" DEMİYORUZ. Hedefe
-- yapılan birikim aktarımı (GoalDepositModal) tek taraflı bir transferdir;
-- hedef bir hesap olmadığı için karşı bacağı yoktur ve transactionEffect
-- bunu doğru şekilde çıkış olarak sayar.

alter table public.transactions
    add constraint transactions_transfer_pair_check check (
        (transfer_group_id is null and transfer_direction is null)
        or (
            type = 'transfer'
            and transfer_group_id is not null
            and transfer_direction is not null
        )
    );
