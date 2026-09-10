/**
 * cash_date motoru — madde 8.
 * 8a: transaction_date esas (bugün değil).
 * 8c: transfer bacağı kart mantığına girmez.
 * 8d: cut/due değişince gelecek cash_date'ler yeniden hesaplanır.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateCashDate, resolveCashDate, recomputeCardCashDates } from './cash-date.ts'

const paraf = { type: 'credit_card', cut_date: 3, due_date: 13 }

test('8a: kesimden ÖNCE yapılan harcama bu ayın son ödeme günü', () => {
    // 1 Eylül, kesim 3 → aynı ekstre, son ödeme 13 Eylül.
    assert.equal(calculateCashDate('2026-09-01', paraf), '2026-09-13')
})

test('8a: kesimde/sonra yapılan harcama gelecek ayın son ödeme günü', () => {
    // 3 Eylül (kesim günü) → sonraki ekstre, 13 Ekim.
    assert.equal(calculateCashDate('2026-09-03', paraf), '2026-10-13')
    assert.equal(calculateCashDate('2026-09-05', paraf), '2026-10-13')
})

test('8a: geçmiş tarihli giriş bugüne göre DEĞİL işlem tarihine göre', () => {
    // today parametresi resolveCashDate sonucunu değiştirmemeli (kart mantığı tx tarihinden).
    const r = resolveCashDate({ transactionDate: '2026-09-01', targetAccount: paraf, today: '2026-12-31' })
    assert.equal(r, '2026-09-13')
})

test('8c: karta yapılan ödeme (transfer) kart mantığına girmez → işlem günü', () => {
    // Hedef kart olsa bile transfer bacağı: para 10 Eylül çıkar, 10 Eylül düşer.
    const r = resolveCashDate({ transactionDate: '2026-09-10', targetAccount: paraf, isTransfer: true })
    assert.equal(r, '2026-09-10')
})

test('8c: transfer olmayan kart harcaması kart mantığına girer', () => {
    const r = resolveCashDate({ transactionDate: '2026-09-10', targetAccount: paraf })
    assert.equal(r, '2026-10-13') // 10 Eylül > kesim 3 → sonraki ekstre
})

test('8d: cut/due değişince yalnız GELECEK, transfer-olmayan kayıtlar güncellenir', () => {
    const today = '2026-09-11'
    const txs = [
        { id: 'a', transaction_date: '2026-09-01', cash_date: '2026-10-01', type: 'expense' },        // future stale → 2026-09-13
        { id: 'b', transaction_date: '2026-09-05', cash_date: '2026-10-01', type: 'expense' },        // future stale → 2026-10-13
        { id: 'c', transaction_date: '2026-08-01', cash_date: '2026-08-15', type: 'expense' },        // gerçekleşmiş (<=today) → dokunma
        { id: 'd', transaction_date: '2026-09-10', cash_date: '2026-10-01', type: 'transfer', transfer_direction: 'in' }, // transfer → dokunma
    ]
    const updates = recomputeCardCashDates(txs, paraf, today)
    const byId = new Map(updates.map(u => [u.id, u.cash_date]))
    assert.equal(byId.get('a'), '2026-09-13')
    assert.equal(byId.get('b'), '2026-10-13')
    assert.equal(byId.has('c'), false) // gerçekleşmiş
    assert.equal(byId.has('d'), false) // transfer
    assert.equal(updates.length, 2)
})
