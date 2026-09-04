/**
 * computeBaseIncome — nefes payı YALNIZ düzenli (is_base_income) gelirden. Prim/
 * freelance (değişken) taban gelire karışmaz. Genç hesapta ihtiyatlı (düşük) çıkar.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeBaseIncome, type BaseIncomeTransaction } from './base-income.ts'

const CM = '2026-09' // pencere: 06, 07, 08

// Maaş (düzenli) 3 ay, prim (değişken) bir ay.
const txs: BaseIncomeTransaction[] = [
    { amount: 50000, type: 'income', cash_date: '2026-06-15', category_id: 'salary' },
    { amount: 50000, type: 'income', cash_date: '2026-07-15', category_id: 'salary' },
    { amount: 50000, type: 'income', cash_date: '2026-08-15', category_id: 'salary' },
    { amount: 20000, type: 'income', cash_date: '2026-08-20', category_id: 'bonus' },   // değişken
    { amount: 99999, type: 'transfer', cash_date: '2026-07-10', category_id: 'salary', transfer_direction: 'in' }, // transfer
]

test('değişken gelir taban gelire GİRMEZ — sadece düzenli sayılır', () => {
    const r = computeBaseIncome({ transactions: txs, baseCategoryIds: ['salary'], currentMonth: CM })
    assert.equal(r.monthly, 50000) // 150.000 / 3; prim (20.000) ve transfer hariç
    assert.equal(r.hasBaseCategory, true)
    assert.equal(r.monthsWithData, 3)
})

test('hiç düzenli kategori yoksa: monthly 0, hasBaseCategory false', () => {
    const r = computeBaseIncome({ transactions: txs, baseCategoryIds: [], currentMonth: CM })
    assert.equal(r.monthly, 0)
    assert.equal(r.hasBaseCategory, false)
})

test('genç hesap ihtiyatlı: tek aylık maaş sabit 3 böleme ile düşük çıkar', () => {
    const one: BaseIncomeTransaction[] = [{ amount: 60000, type: 'income', cash_date: '2026-08-15', category_id: 'salary' }]
    const r = computeBaseIncome({ transactions: one, baseCategoryIds: ['salary'], currentMonth: CM })
    assert.equal(r.monthly, 20000) // 60.000 / 3 — olduğundan düşük (ihtiyatlı)
    assert.equal(r.monthsWithData, 1)
})

test('yalnız değişken gelirli hane: taban 0 → nefes payı düzenliden hesaplanır (hiç)', () => {
    const varOnly: BaseIncomeTransaction[] = [
        { amount: 30000, type: 'income', cash_date: '2026-07-15', category_id: 'freelance' },
        { amount: 40000, type: 'income', cash_date: '2026-08-15', category_id: 'freelance' },
    ]
    const r = computeBaseIncome({ transactions: varOnly, baseCategoryIds: ['salary'], currentMonth: CM })
    assert.equal(r.monthly, 0) // freelance düzenli değil → taban 0
})
