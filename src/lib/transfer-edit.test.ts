/**
 * planTransferEdit — iki bacaklı transfer düzenlemesi. Tutar değişince her iki
 * bacağın tutarı ve her hesabın bakiyesi güncellenmeli; tarih değişince her
 * bacak KENDİ cash_date'ini korumalı (kaynak banka, hedef kart farkı).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTransferEdit, type TransferLeg, type LegAccount } from './transfer-edit.ts'

const bank: LegAccount = { id: 'acc-bank', type: 'bank', balance: 5000 }
const card: LegAccount = { id: 'acc-card', type: 'credit_card', cut_date: 1, due_date: 10, balance: -2000 }
const bank2: LegAccount = { id: 'acc-bank2', type: 'bank', balance: 2000 }

function legs(fromId: string, toId: string): TransferLeg[] {
    return [
        { id: 'leg-out', account_id: fromId, transfer_direction: 'out', cash_date: '2026-09-05' },
        { id: 'leg-in', account_id: toId, transfer_direction: 'in', cash_date: '2026-09-05' },
    ]
}

test('tutar değişimi: iki bacağın tutarı da yeni değere gider', () => {
    const plan = planTransferEdit({
        legs: legs('acc-bank', 'acc-bank2'), accounts: [bank, bank2],
        oldAmount: 1000, newAmount: 1500, newDate: '2026-09-05', today: '2026-09-05',
    })
    assert.equal(plan.legUpdates.length, 2)
    assert.ok(plan.legUpdates.every(l => l.amount === 1500), 'her iki bacak 1500 olmalı')
})

test('tutar değişimi: her iki hesabın bakiyesi doğru düzeltilir', () => {
    // out(bank 5000): eski −1000 geri al (+1000), yeni −1500 uygula → 4500
    // in(bank2 2000): eski +1000 geri al (−1000), yeni +1500 uygula → 2500
    const plan = planTransferEdit({
        legs: legs('acc-bank', 'acc-bank2'), accounts: [bank, bank2],
        oldAmount: 1000, newAmount: 1500, newDate: '2026-09-05', today: '2026-09-05',
    })
    const byAcc = new Map(plan.balanceUpdates.map(b => [b.accountId, b.balance]))
    assert.equal(byAcc.get('acc-bank'), 4500)
    assert.equal(byAcc.get('acc-bank2'), 2500)
})

test('tutar azaltma bakiyeleri simetrik geri alır', () => {
    // out(bank 5000): +1000 −500 → 5500 ; in(bank2 2000): −1000 +500 → 1500
    const plan = planTransferEdit({
        legs: legs('acc-bank', 'acc-bank2'), accounts: [bank, bank2],
        oldAmount: 1000, newAmount: 500, newDate: '2026-09-05', today: '2026-09-05',
    })
    const byAcc = new Map(plan.balanceUpdates.map(b => [b.accountId, b.balance]))
    assert.equal(byAcc.get('acc-bank'), 5500)
    assert.equal(byAcc.get('acc-bank2'), 1500)
})

test('tarih değişimi: kaynak banka bacağı = yeni tarih; hedef kart bacağı = kesim/ödemeden', () => {
    // Kaynak banka, hedef kart. Yeni tarih 15 Eylül. Kart kesim=1, ödeme=10:
    // 15 >= kesim(1) → sonraki ekstre → ödeme 10 Ekim. Banka bacağı = 15 Eylül.
    const l: TransferLeg[] = [
        { id: 'leg-out', account_id: 'acc-bank', transfer_direction: 'out', cash_date: '2026-10-05' },
        { id: 'leg-in', account_id: 'acc-card', transfer_direction: 'in', cash_date: '2026-10-05' },
    ]
    const plan = planTransferEdit({
        legs: l, accounts: [bank, card],
        oldAmount: 1000, newAmount: 1000, newDate: '2026-09-15', today: '2026-09-01',
    })
    const byLeg = new Map(plan.legUpdates.map(u => [u.id, u.cash_date]))
    assert.equal(byLeg.get('leg-out'), '2026-09-15')  // banka: transaction_date
    assert.equal(byLeg.get('leg-in'), '2026-10-10')   // kart: kesim/ödeme
})

test('gerçekleşmiş bacak ileri atılmaz (rule 3): geçmişte kalan kart bacağı tarihe sabitlenir', () => {
    // Kart bacağı zaten ödenmiş (cash_date geçmiş) ve yeni hesaplanan ileri düşerse
    // transaction_date'e sabitlenir — bakiyeyi/projeksiyonu bozmaz.
    const l: TransferLeg[] = [
        { id: 'leg-in', account_id: 'acc-card', transfer_direction: 'in', cash_date: '2026-08-10' },
    ]
    const plan = planTransferEdit({
        legs: l, accounts: [card],
        oldAmount: 1000, newAmount: 1000, newDate: '2026-09-15', today: '2026-09-20',
    })
    assert.equal(plan.legUpdates[0].cash_date, '2026-09-15') // ileri değil, transaction_date
})
