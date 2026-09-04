/**
 * ruleInterestIncrease — bu ay faiz ödemesi arttıysa yüksek öncelikli uyarı.
 * Faiz hareketleri source_type='faiz' ile tanınır (faiz onay akışı / elle işaret).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ruleInterestIncrease, type InsightTransaction } from './insights.ts'

function tx(amount: number, cash_date: string, source_type: string | null = 'faiz'): InsightTransaction {
    return { amount, type: 'expense', cash_date, source_type }
}

test('faiz artışı → 95 öncelikli, iki ayı karşılaştıran cümle', () => {
    const txs = [tx(2100, '2026-08-10'), tx(3200, '2026-09-05')]
    const r = ruleInterestIncrease(txs, '2026-09')
    assert.ok(r)
    assert.equal(r!.priority, 95)
    assert.match(r!.text, /3\.200/)
    assert.match(r!.text, /2\.100/)
})

test('ilk kez faiz (geçen ay 0) → 92 öncelikli', () => {
    const r = ruleInterestIncrease([tx(1500, '2026-09-05')], '2026-09')
    assert.ok(r)
    assert.equal(r!.priority, 92)
})

test('faiz düşmüş/sabit → uyarı yok', () => {
    const txs = [tx(3000, '2026-08-10'), tx(2000, '2026-09-05')]
    assert.equal(ruleInterestIncrease(txs, '2026-09'), null)
})

test('bu ay faiz yok → null', () => {
    assert.equal(ruleInterestIncrease([tx(2000, '2026-08-10')], '2026-09'), null)
})

test('faiz işareti olmayan hareket sayılmaz', () => {
    // Aynı tutarlar ama source_type faiz değil → uyarı yok.
    const txs = [tx(2100, '2026-08-10', null), tx(3200, '2026-09-05', null)]
    assert.equal(ruleInterestIncrease(txs, '2026-09'), null)
})
