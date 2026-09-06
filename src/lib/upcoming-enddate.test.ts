/**
 * Süreli abonelik — end_date'ten sonra upcoming kalem üretmemeli; boşsa süresiz.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUpcoming, type UpcomingSubscription } from './upcoming.ts'

const sub = (over: Partial<UpcomingSubscription>): UpcomingSubscription => ({
    id: 's1', name: 'Spor salonu', amount: 1000, frequency: 'monthly', next_payment_date: '2026-09-15', status: 'active', ...over,
})

function countFor(subs: UpcomingSubscription[]) {
    const r = buildUpcoming({ transactions: [], subscriptions: subs, installments: [] }, { from: '2026-09-01', months: 12 })
    return r.months.flatMap(m => m.items).filter(i => i.kind === 'abonelik').length
}

test('bitiş tarihi olan abonelik o tarihten sonra üretmez', () => {
    // Eylül, Ekim, Kasım (3 kalem); Aralık ve sonrası yok (end 30 Kasım).
    assert.equal(countFor([sub({ end_date: '2026-11-30' })]), 3)
})

test('bitiş tarihi boşsa süresiz (12 ay boyunca üretir)', () => {
    assert.equal(countFor([sub({ end_date: null })]), 12)
})
