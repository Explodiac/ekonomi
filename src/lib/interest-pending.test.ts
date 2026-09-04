/**
 * computePendingInterest — dönem sonu faiz onayı. Dönem hesabı (kart kesim /
 * esnek ay sonu), bir kez sorma garantisi, oran yoksa/borç yoksa sormama,
 * aylık↔yıllık dönüşüm (basit bölme).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePendingInterest, type PendingInterestAccount } from './interest.ts'

const TODAY = '2026-09-04'
const bonus: PendingInterestAccount = { id: 'bonus', name: 'Bonus Kart', type: 'credit_card', balance: -28300, interest_rate: 51, cut_date: 28 }

test('kart: en son kesim tarihi + aylık orandan faiz (yıllık/12 basit bölme)', () => {
    const [p] = computePendingInterest({ accounts: [bonus], answeredFingerprints: [], today: TODAY })
    assert.equal(p.periodEnd, '2026-08-28')       // 28 Ağustos, son kapanan kesim
    assert.equal(p.monthlyRatePct, 4.25)          // 51 / 12
    assert.equal(p.amount, 1202.75)               // 28.300 × %4,25
    assert.equal(p.fingerprint, 'faiz:bonus:2026-08-28')
})

test('bir kez sor: cevaplanmış dönem tekrar sorulmaz', () => {
    const r = computePendingInterest({ accounts: [bonus], answeredFingerprints: ['faiz:bonus:2026-08-28'], today: TODAY })
    assert.equal(r.length, 0)
})

test('faiz oranı yoksa sorulmaz', () => {
    const r = computePendingInterest({ accounts: [{ ...bonus, interest_rate: null }], answeredFingerprints: [], today: TODAY })
    assert.equal(r.length, 0)
})

test('borç sıfır / pozitif bakiye → sorulmaz', () => {
    const zero = computePendingInterest({ accounts: [{ ...bonus, balance: 0 }], answeredFingerprints: [], today: TODAY })
    const pos = computePendingInterest({ accounts: [{ ...bonus, balance: 1500 }], answeredFingerprints: [], today: TODAY })
    assert.equal(zero.length, 0)
    assert.equal(pos.length, 0)
})

test('esnek hesap: dönem = son tamamlanmış ay sonu', () => {
    const [p] = computePendingInterest({
        accounts: [{ id: 'kmh', name: 'Esnek', type: 'esnek_hesap', balance: -5000, interest_rate: 36 }],
        answeredFingerprints: [], today: TODAY,
    })
    assert.equal(p.periodEnd, '2026-08-31')
    assert.equal(p.amount, 150) // 5000 × %3 (36/12)
})

test('kesim günü bu ay geçtiyse bu ayın kesimi kullanılır', () => {
    const [p] = computePendingInterest({ accounts: [{ ...bonus, cut_date: 3 }], answeredFingerprints: [], today: TODAY })
    assert.equal(p.periodEnd, '2026-09-03') // 3 Eylül <= 4 Eylül
})

test('kesim günü ay uzunluğuna kırpılır (31 → 30/28) ve gelecekse önceki aya düşer', () => {
    // Eylül 30 gün: kesim 31 → 30 Eylül, bu > bugün(4 Eylül) → Ağustos 31.
    const [p] = computePendingInterest({ accounts: [{ ...bonus, cut_date: 31 }], answeredFingerprints: [], today: TODAY })
    assert.equal(p.periodEnd, '2026-08-31')
})

test('normal banka hesabı faiz sorusuna girmez', () => {
    const r = computePendingInterest({ accounts: [{ id: 'b', type: 'bank', balance: -1000, interest_rate: 40 }], answeredFingerprints: [], today: TODAY })
    assert.equal(r.length, 0)
})
