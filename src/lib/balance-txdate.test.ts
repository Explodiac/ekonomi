/**
 * Bakiye, hareketin YAPILDIĞI güne (transaction_date) göre türetilir; paranın
 * çıkacağı güne (cash_date) göre değil. Kart harcamasının cash_date'i gelecek aya
 * düşse bile borç bugün vardır ve bakiyeye girer. (Madde 1+2 ortak kökü.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derivedBalance, deriveAccountBalances } from './balance.ts'

const asOf = '2026-09-10'

test('gelecek cash_date, geçmiş transaction_date olan kart harcaması bakiyeye girer', () => {
    // Kart harcaması: 1 Eylül yapıldı, son ödeme 13 Ekim (gelecek).
    const tx = [{ amount: 100, type: 'expense', transaction_date: '2026-09-01', cash_date: '2026-10-13' }]
    // transaction_date esas → borç bugün sayılır.
    assert.equal(derivedBalance(0, tx, asOf), -100)
})

test('gelecek transaction_date olan hareket bugünün bakiyesine girmez', () => {
    const tx = [{ amount: 100, type: 'expense', transaction_date: '2026-09-20', cash_date: '2026-10-13' }]
    assert.equal(derivedBalance(0, tx, asOf), 0)
})

test('transaction_date yoksa cash_date fallback (geriye uyum)', () => {
    const tx = [{ amount: 100, type: 'expense', cash_date: '2026-09-05' } as any]
    assert.equal(derivedBalance(0, tx, asOf), -100)
})

test('kart bakiyesi: açılış + gelecek-son-ödemeli harcamaların transaction_date etkisi', () => {
    // Halkbank Paraf senaryosunun küçültülmüş hali: açılış negatif, harcamalar
    // bu ay yapılmış ama cash_date'leri gelecek ayda.
    const accounts = [{ id: 'card1', name: 'Paraf', type: 'credit_card', opening_balance: -1000, balance: -1000 }]
    const txns = [
        { account_id: 'card1', amount: 300, type: 'expense', transaction_date: '2026-09-02', cash_date: '2026-10-13' },
        { account_id: 'card1', amount: 200, type: 'expense', transaction_date: '2026-09-05', cash_date: '2026-10-13' },
    ]
    const balances = deriveAccountBalances(accounts, txns, { asOf, warn: false })
    // -1000 - 300 - 200 = -1500 (borç arttı). cash_date'le süzülseydi -1000 kalırdı.
    assert.equal(balances.get('card1'), -1500)
})
