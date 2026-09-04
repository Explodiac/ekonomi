/**
 * breathing-room — faiz kategorisi alışkanlıktan dışlanıp zorunlu çıkışa eklenince
 * NET nefes payı değişmemeli, ama "Faiz & ücretler" artık alışkanlık listesinde
 * (kısma imkânı) GÖRÜNMEMELİ.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeBreathingRoom, type BreathingRoomInput } from './breathing-room.ts'
import { avgMonthlyInterest } from './interest.ts'

// Son 3 tam ay (bu ay '2026-09' hariç): 06/07/08.
function expenses(catId: string, catName: string, monthly: number) {
    return ['2026-06', '2026-07', '2026-08'].map(m => ({
        amount: monthly, type: 'expense', cash_date: `${m}-15`,
        category_id: catId, categoryName: catName, spend_nature: 'aliskanlik' as const,
    }))
}

const txs = [...expenses('cat-market', 'Market', 3000), ...expenses('cat-faiz', 'Faiz & ücretler', 1000)]
const base: BreathingRoomInput = { baseIncome: 30000, mandatoryOutflow: 10000, transactions: txs as any, currentMonth: '2026-09' }

test('faiz dışlanınca NET nefes payı değişmez (kova değişir, sayı aynı)', () => {
    const before = computeBreathingRoom(base)
    const faizAvg = avgMonthlyInterest(txs.filter(t => t.category_id === 'cat-faiz') as any, '2026-09')
    assert.equal(faizAvg, 1000)
    const after = computeBreathingRoom({ ...base, excludeCategoryIds: ['cat-faiz'], extraMandatory: faizAvg })
    assert.equal(after.breathingRoom, before.breathingRoom)
})

test('faiz artık alışkanlık listesinde görünmez; zorunlu çıkışa eklenir', () => {
    const after = computeBreathingRoom({ ...base, excludeCategoryIds: ['cat-faiz'], extraMandatory: 1000 })
    assert.ok(!after.habitualByCategory.some(c => c.categoryId === 'cat-faiz'), 'faiz alışkanlıkta olmamalı')
    assert.ok(after.habitualByCategory.some(c => c.categoryId === 'cat-market'), 'market alışkanlıkta kalmalı')
    assert.equal(after.mandatoryOutflow, 11000) // 10000 + 1000 faiz
    assert.equal(after.habitualOutflow, 3000)   // yalnız market
})
