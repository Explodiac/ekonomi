/**
 * computeInterest — faiz ödemesi toplamları, asgari ödeme senaryosu, borç
 * kapatma tasarrufu ve kenar durumları.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeInterest, type InterestAccount, type InterestTransaction } from './interest.ts'

const TODAY = '2026-09-15'

function card(over: Partial<InterestAccount> & { id: string }): InterestAccount {
    return { type: 'credit_card', balance: 0, ...over }
}

test('paidThisMonth / paidThisYear cash_date ile doğru toplanır', () => {
    const txs: InterestTransaction[] = [
        { amount: 3200, type: 'expense', cash_date: '2026-09-05', account_id: 'c1' }, // bu ay
        { amount: 1000, type: 'expense', cash_date: '2026-03-10', account_id: 'c1' }, // bu yıl, başka ay
        { amount: 500, type: 'expense', cash_date: '2025-12-01', account_id: 'c1' },  // geçen yıl
        { amount: 999, type: 'expense', cash_date: '2026-10-01', account_id: 'c1' },  // gelecek → hariç
    ]
    const r = computeInterest({ accounts: [card({ id: 'c1', balance: -1000, interest_rate: 24 })], transactions: txs, today: TODAY })
    assert.equal(r.paidThisMonth, 3200)
    assert.equal(r.paidThisYear, 4200)
})

test('paidByAccount: faiz karta göre kırılır', () => {
    const txs: InterestTransaction[] = [
        { amount: 2000, type: 'expense', cash_date: '2026-09-02', account_id: 'A' },
        { amount: 800, type: 'expense', cash_date: '2026-09-03', account_id: 'B' },
    ]
    const r = computeInterest({
        accounts: [card({ id: 'A', balance: -25800, interest_rate: 42 }), card({ id: 'B', balance: -3000, interest_rate: 30 })],
        transactions: txs, today: TODAY,
    })
    const a = r.paidByAccount.find(p => p.accountId === 'A')!
    const b = r.paidByAccount.find(p => p.accountId === 'B')!
    assert.equal(a.paidThisMonth, 2000)
    assert.equal(b.paidThisMonth, 800)
    assert.equal(a.debt, 25800)
})

test('ifPaidOff.savedPerMonth = borç × aylık faiz (kesin)', () => {
    // 10.000 × %24/yıl → aylık %2 → 200 ₺/ay.
    const r = computeInterest({ accounts: [card({ id: 'c1', balance: -10000, interest_rate: 24 })], transactions: [], today: TODAY })
    const p = r.paidByAccount[0]
    assert.equal(p.ifPaidOff?.savedPerMonth, 200)
    assert.equal(p.ifPaidOff?.savedTotal, p.minimumPaymentScenario?.totalInterest)
})

test('asgari ödeme senaryosu convergent: months sonlu, totalInterest pozitif', () => {
    const r = computeInterest({ accounts: [card({ id: 'c1', balance: -10000, interest_rate: 24 })], transactions: [], today: TODAY, minPaymentPct: 20 })
    const s = r.paidByAccount[0].minimumPaymentScenario!
    assert.ok(s.months != null && s.months > 0 && s.months < 1200, 'kapanış sonlu olmalı')
    assert.ok((s.totalInterest ?? 0) > 0)
})

test('asgari oran aylık faizi geçmiyorsa borç kapanmaz → months null', () => {
    // %30/yıl → aylık %2.5; asgari %2 < %2.5 → kapanmaz.
    const r = computeInterest({ accounts: [card({ id: 'c1', balance: -10000, interest_rate: 30 })], transactions: [], today: TODAY, minPaymentPct: 2 })
    const s = r.paidByAccount[0].minimumPaymentScenario!
    assert.equal(s.months, null)
    assert.equal(s.totalInterest, null)
    // Aylık kurtulan faiz yine bellidir (nefes payı için).
    assert.equal(r.paidByAccount[0].ifPaidOff?.savedPerMonth, 250)
})

test('esnek hesap (KMH) negatif bakiye borç sayılır', () => {
    const r = computeInterest({
        accounts: [{ id: 'kmh', type: 'esnek_hesap', balance: -5000, interest_rate: 36 }],
        transactions: [], today: TODAY,
    })
    const p = r.paidByAccount[0]
    assert.equal(p.debt, 5000)
    assert.equal(p.ifPaidOff?.savedPerMonth, 150) // 5000 × %36/12 = %3 → 150
})

test('faiz oranı girilmemiş: borç raporlanır ama senaryo yok', () => {
    const r = computeInterest({ accounts: [card({ id: 'c1', balance: -3000, interest_rate: null })], transactions: [], today: TODAY })
    const p = r.paidByAccount[0]
    assert.equal(p.debt, 3000)
    assert.equal(p.minimumPaymentScenario, null)
    assert.equal(p.ifPaidOff, null)
})

test('borç sıfır + faiz kaydı yok → hesap listeye girmez', () => {
    const r = computeInterest({ accounts: [card({ id: 'c1', balance: 0, interest_rate: 24 }), card({ id: 'c2', balance: 500, interest_rate: 24 })], transactions: [], today: TODAY })
    assert.equal(r.paidByAccount.length, 0)
    assert.equal(r.paidThisMonth, 0)
    assert.equal(r.minimumPaymentScenario.months, 0)
})

test('birleşik ifPaidOff = hesapların toplamı', () => {
    const r = computeInterest({
        accounts: [card({ id: 'A', balance: -10000, interest_rate: 24 }), { id: 'kmh', type: 'esnek_hesap', balance: -5000, interest_rate: 36 }],
        transactions: [], today: TODAY,
    })
    assert.equal(r.ifPaidOff.savedPerMonth, 350) // 200 + 150
})

test('normal banka hesabında negatif bakiye borç sayılmaz (anomali)', () => {
    const r = computeInterest({ accounts: [{ id: 'b1', type: 'bank', balance: -1200, interest_rate: 24 }], transactions: [], today: TODAY })
    assert.equal(r.paidByAccount.length, 0)
})
