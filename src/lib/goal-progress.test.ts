/**
 * computeGoalProgress — para çekmenin (goal_contributions'a negatif/net tutar)
 * saved'ı doğru düşürdüğünü doğrular. Netleme yazma anında (tek satır/ay,
 * read-modify-write) yapılır; burada test edilen değişmez: fonksiyon işaretli
 * tutarları (negatif dahil) toplar, ayrı hesap mantığı yoktur.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeGoalProgress } from './goal-progress.ts'

const TODAY = '2026-09-15'

test('pozitif katkı saved artırır', () => {
    const r = computeGoalProgress({
        goal: { targetAmount: 100000, savedAmount: 0 },
        contributions: [{ period: '2026-08-01', amount: 5000 }],
        today: TODAY,
    })
    assert.equal(r.saved, 5000)
    assert.equal(r.remaining, 95000)
})

test('para çekme (negatif kayıt) saved düşürür', () => {
    // Ağustos +5000 katkı, Eylül −2000 çekim → net 3000.
    const r = computeGoalProgress({
        goal: { targetAmount: 100000, savedAmount: 0 },
        contributions: [
            { period: '2026-08-01', amount: 5000 },
            { period: '2026-09-01', amount: -2000 },
        ],
        today: TODAY,
    })
    assert.equal(r.saved, 3000)
    assert.equal(r.remaining, 97000)
})

test('aynı ay katkı+çekim tek satırda net → doğru saved', () => {
    // Aynı ayda 5000 katkı sonra 2000 çekim, UNIQUE(goal_id, period) yüzünden
    // tek satırda net 3000 olarak tutulur. Fonksiyon bunu aynen görür.
    const r = computeGoalProgress({
        goal: { targetAmount: 100000, savedAmount: 0 },
        contributions: [{ period: '2026-09-01', amount: 3000 }],
        today: TODAY,
    })
    assert.equal(r.saved, 3000)
    // Net pozitif ay tik şeridinde "yapıldı" görünür.
    const sep = r.monthlyHistory.find(m => m.period === '2026-09-01')!
    assert.equal(sep.amount, 3000)
    assert.equal(sep.done, true)
})

test('başlangıç bakiyesi + çekim: saved = base + Σ (negatif dahil)', () => {
    const r = computeGoalProgress({
        goal: { targetAmount: 100000, savedAmount: 20000 },
        contributions: [{ period: '2026-09-01', amount: -5000 }],
        today: TODAY,
    })
    assert.equal(r.saved, 15000)
})

test('ayı net sıfıra çekince o ay tik şeridinde yapılmadı görünür', () => {
    const r = computeGoalProgress({
        goal: { targetAmount: 100000, savedAmount: 0 },
        contributions: [{ period: '2026-09-01', amount: 0 }],
        today: TODAY,
    })
    const sep = r.monthlyHistory.find(m => m.period === '2026-09-01')!
    assert.equal(sep.done, false)
})
