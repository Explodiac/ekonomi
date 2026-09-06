/**
 * Elden taksit — diğer taksitlerle aynı davranış: upcoming'de görünür (kind='elden')
 * ve bitişinde relief yaratır (findRelievingMonths kind-agnostik).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUpcoming, type UpcomingInstallment, type UpcomingTransaction } from './upcoming.ts'

// 3 aylık elden ödeme (anneme). Her taksit gelecek tarihli bir transaction + payment.
const payments = [
    { id: 'p1', payment_date: '2026-09-20', amount: 5000 },
    { id: 'p2', payment_date: '2026-10-20', amount: 5000 },
    { id: 'p3', payment_date: '2026-11-20', amount: 5000 },
]
const inst: UpcomingInstallment = { id: 'i1', description: 'Anneme', kind: 'elden', payments }
const txs: UpcomingTransaction[] = payments.map(p => ({
    amount: p.amount, type: 'expense', cash_date: p.payment_date, source_type: 'installment', source_id: p.id,
}))

test('elden taksit upcoming\'de kind=elden olarak görünür', () => {
    const r = buildUpcoming({ transactions: txs, subscriptions: [], installments: [inst] }, { from: '2026-09-01', months: 12 })
    const items = r.months.flatMap(m => m.items).filter(i => i.sourceId.startsWith('p'))
    assert.equal(items.length, 3)
    assert.ok(items.every(i => i.kind === 'elden'))
})

test('elden taksit bitişinde relief yaratır (son ödemeden sonraki ay)', () => {
    const r = buildUpcoming({ transactions: txs, subscriptions: [], installments: [inst] }, { from: '2026-09-01', months: 12 })
    const rel = r.relievingMonths.find(x => x.label === 'Anneme')
    assert.ok(rel, 'elden taksit relief üretmeli')
    assert.equal(rel!.month, '2026-12') // Kasım son ödeme → Aralık rahatlama
})
