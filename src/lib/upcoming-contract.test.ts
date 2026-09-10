/**
 * Yaklaşan kontrat gelirleri: contract_payments (pending) takvime GELİR olarak
 * dizilir; ay giderine karışmaz (total gider, incomeTotal gelir, net fark).
 * Gerçek hareketi olan (source_type='contract') kalem çift sayılmaz. (Madde 10.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUpcoming, type UpcomingContractPayment, type UpcomingTransaction } from './upcoming.ts'

const from = '2026-09-01'

test('kontrat ödemesi GELİR olarak üretilir (kind=kontrat, direction=income)', () => {
    const cps: UpcomingContractPayment[] = [
        { id: 'cp1', amount: 85000, expected_date: '2026-10-10', status: 'pending', contractName: 'Ömer Maaş' },
    ]
    const r = buildUpcoming({ transactions: [], subscriptions: [], installments: [], contractPayments: cps }, { from, months: 12 })
    const oct = r.months.find(m => m.month === '2026-10')!
    const item = oct.items.find(i => i.sourceId === 'cp1')!
    assert.equal(item.kind, 'kontrat')
    assert.equal(item.direction, 'income')
    assert.equal(item.amount, 85000)
    assert.equal(oct.incomeTotal, 85000)
    assert.equal(oct.total, 0)        // gider yok
    assert.equal(oct.net, 85000)      // net = gelir - gider
})

test('gider + gelir aynı ay: total gider, incomeTotal gelir, net fark', () => {
    const cps: UpcomingContractPayment[] = [
        { id: 'cp2', amount: 10000, expected_date: '2026-09-21', status: 'pending', contractName: 'Global HSE' },
    ]
    // Bir abonelik gideri (net'i etkilesin)
    const r = buildUpcoming({
        transactions: [], installments: [], contractPayments: cps,
        subscriptions: [{ id: 's1', name: 'Netflix', amount: 200, frequency: 'monthly', next_payment_date: '2026-09-15' }],
    }, { from, months: 3 })
    const sep = r.months.find(m => m.month === '2026-09')!
    assert.equal(sep.incomeTotal, 10000)
    assert.equal(sep.total, 200)
    assert.equal(sep.net, 9800)
    // "en ağır ay" gideri kullanır — gelir onu şişirmemeli (total yalnız gider)
    assert.equal(sep.total, 200)
})

test('gerçek hareketi olan kontrat ödemesi çift sayılmaz', () => {
    const cps: UpcomingContractPayment[] = [
        { id: 'cp3', amount: 13000, expected_date: '2026-09-21', status: 'pending', contractName: 'Kebapçı Mustafa' },
    ]
    const txs: UpcomingTransaction[] = [
        { amount: 13000, type: 'income', cash_date: '2026-09-21', source_type: 'contract', source_id: 'cp3' },
    ]
    const r = buildUpcoming({ transactions: txs, subscriptions: [], installments: [], contractPayments: cps }, { from, months: 3 })
    const sep = r.months.find(m => m.month === '2026-09')!
    const generated = sep.items.filter(i => i.sourceId === 'cp3')
    assert.equal(generated.length, 0) // gerçek hareket var → üretilmez
})

test('pending olmayan kontrat ödemesi üretilmez', () => {
    const cps: UpcomingContractPayment[] = [
        { id: 'cp4', amount: 5000, expected_date: '2026-10-01', status: 'paid', contractName: 'X' },
    ]
    const r = buildUpcoming({ transactions: [], subscriptions: [], installments: [], contractPayments: cps }, { from, months: 3 })
    assert.equal(r.months.every(m => m.incomeTotal === 0), true)
})
