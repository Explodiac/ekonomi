/**
 * ruleSubscriptionEnding — süreli abonelik bitişe 1 ay kala uyarır.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ruleSubscriptionEnding, type InsightSubscription } from './insights.ts'

const TODAY = '2026-09-04'
const s = (over: Partial<InsightSubscription>): InsightSubscription => ({ name: 'Spor salonu', status: 'active', ...over })

test('bitişe ~2 hafta kala uyarı (öncelik 55)', () => {
    const r = ruleSubscriptionEnding([s({ end_date: '2026-09-20' })], TODAY)
    assert.ok(r)
    assert.equal(r!.priority, 55)
    assert.match(r!.text, /Spor salonu/)
})

test('bitiş 3 ay sonra → uyarı yok', () => {
    assert.equal(ruleSubscriptionEnding([s({ end_date: '2026-12-15' })], TODAY), null)
})

test('bitiş tarihi yoksa (süresiz) → uyarı yok', () => {
    assert.equal(ruleSubscriptionEnding([s({ end_date: null })], TODAY), null)
})

test('pasif abonelik → uyarı yok', () => {
    assert.equal(ruleSubscriptionEnding([s({ end_date: '2026-09-20', status: 'cancelled' })], TODAY), null)
})
