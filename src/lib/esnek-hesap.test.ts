/**
 * Esnek hesap (KMH) — networth ve runway davranışı. Negatif bakiye = kullanılan
 * kredi → borç / likit değil; pozitif = varlık / likit.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildNetWorth } from './networth.ts'
import { computeRunway } from './runway.ts'

const ASOF = '2026-09-15'

test('networth: esnek hesap negatif bakiye BORÇ tarafına yazılır', () => {
    const r = buildNetWorth({
        accounts: [{ id: 'kmh', type: 'esnek_hesap', opening_balance: -5000 }],
        transactions: [], installments: [], investmentValue: null,
    }, { asOf: ASOF })
    assert.equal(r.debts, 5000)
    assert.equal(r.assets, 0)
    assert.equal(r.netWorth, -5000)
})

test('networth: esnek hesap pozitif bakiye VARLIK sayılır', () => {
    const r = buildNetWorth({
        accounts: [{ id: 'kmh', type: 'esnek_hesap', opening_balance: 3000 }],
        transactions: [], installments: [], investmentValue: null,
    }, { asOf: ASOF })
    assert.equal(r.assets, 3000)
    assert.equal(r.debts, 0)
})

test('runway: esnek hesap pozitif bakiye likide girer, negatif girmez', () => {
    const pos = computeRunway({
        accounts: [{ id: 'kmh', type: 'esnek_hesap' }],
        balances: new Map([['kmh', 4000]]),
        transactions: [], asOf: ASOF,
    })
    assert.equal(pos.liquidFree, 4000)

    const neg = computeRunway({
        accounts: [{ id: 'kmh', type: 'esnek_hesap' }],
        balances: new Map([['kmh', -4000]]),
        transactions: [], asOf: ASOF,
    })
    assert.equal(neg.liquidFree, 0)
})
