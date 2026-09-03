/**
 * buildPurchasePlan testleri. Derleme adımı yok: `npm test` → node --test,
 * .ts tipleri Node tarafından soyulur (bkz. package.json).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPurchasePlan, type PurchasePlanItem } from './purchase-plan.ts'

const FROM = '2026-09'

function plan(over: Partial<PurchasePlanItem> & { id: string; amount: number }): PurchasePlanItem {
    return { name: over.id, priority: 0, paymentPlan: 'pesin', status: 'planli', ...over }
}

test('boş plan: takvim ufku kadar ay, özet sıfır', () => {
    const r = buildPurchasePlan({ from: FROM, monthlyRoom: 10000, plans: [] })
    assert.equal(r.scheduled.length, 0)
    assert.equal(r.timeline.length, 24)
    assert.equal(r.timeline[0].month, '2026-09')
    assert.equal(r.summary.count, 0)
    assert.equal(r.summary.allPlaced, true)
    assert.equal(r.summary.completionMonth, null)
})

test('peşin, nefes payı ilk ay yeter → yeterli', () => {
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 30000,
        plans: [plan({ id: 'Buzdolabı', amount: 25000, priority: 1 })],
    })
    const s = r.scheduled[0]
    assert.equal(s.recommendedMonth, '2026-09')
    assert.equal(s.completionMonth, '2026-09')
    assert.equal(s.reasonCode, 'yeterli')
    assert.equal(r.summary.completionInMonths, 1)
})

test('peşin, para birikene kadar bekler → birikim', () => {
    // 25.000 / 6.000 aylık = 5. ayda (index 4) birikir.
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 6000,
        plans: [plan({ id: 'Telefon', amount: 25000, priority: 1 })],
    })
    const s = r.scheduled[0]
    assert.equal(s.recommendedMonth, '2027-01') // Eylül + 4 ay
    assert.equal(s.reasonCode, 'birikim')
})

test('taksit, taksit bitişi pencere açıyor → relief ayına yerleşir', () => {
    // Aylık akış 5.000; taksit aylık payı 6.000 → tek başına yetmiyor.
    // Aralık 2026'da bir taksit bitiyor (+10.000) → o aydan sonra 15.000.
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 5000,
        reliefs: [{ month: '2026-12', amount: 10000, label: 'Koltuk' }],
        plans: [plan({ id: 'Araba', amount: 72000, priority: 1, paymentPlan: 'taksit', installmentCount: 12 })],
    })
    const s = r.scheduled[0]
    assert.equal(s.monthlyAmount, 6000)
    assert.equal(s.installmentCount, 12)
    assert.equal(s.recommendedMonth, '2026-12')
    assert.equal(s.completionMonth, '2027-11') // 12 taksit
    assert.equal(s.reasonCode, 'relief')
    assert.match(s.reason, /Koltuk/)
})

test('havuz sızıntısı yok: düşük öncelikli taksit, yüksek öncelikli peşinin bitişini KAYDIRMAZ', () => {
    // Yalnız A (peşin 40.000, aylık 10.000) → 4. ayda (Aralık) tamamlanır.
    const solo = buildPurchasePlan({
        from: FROM, monthlyRoom: 10000,
        plans: [plan({ id: 'A', amount: 40000, priority: 1 })],
    })
    const aSolo = solo.scheduled.find(s => s.id === 'A')!
    assert.equal(aSolo.completionMonth, '2026-12')

    // Aynı A + düşük öncelikli bir taksit (aylık 10.000). A'nın rezervi korunmalı:
    // taksit ancak A birikimi bittikten SONRAKİ aya (index 4) girebilir.
    const withTaksit = buildPurchasePlan({
        from: FROM, monthlyRoom: 10000,
        plans: [
            plan({ id: 'A', amount: 40000, priority: 1 }),
            plan({ id: 'B', amount: 30000, priority: 2, paymentPlan: 'taksit', installmentCount: 3 }),
        ],
    })
    const aWith = withTaksit.scheduled.find(s => s.id === 'A')!
    const bWith = withTaksit.scheduled.find(s => s.id === 'B')!
    assert.equal(aWith.completionMonth, aSolo.completionMonth, 'A bitişi değişmemeli')
    assert.equal(aWith.completionMonth, '2026-12')
    assert.equal(bWith.recommendedMonth, '2027-01') // A rezervinin arkasından
    // İlk 4 ay A'nın birikim rezervi; taksit taahhüdü yok.
    assert.equal(withTaksit.timeline[0].reservedSavings, 10000)
    assert.equal(withTaksit.timeline[0].committedInstallments, 0)
    assert.equal(withTaksit.timeline[0].freeFlow, 0)
})

test('peşin öncelik sırası: yüksek öncelik parayı önce alır', () => {
    // A(40.000) önce fonlanır, B(10.000) arkasında bekler; aylık 10.000.
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 10000,
        plans: [
            plan({ id: 'A', amount: 40000, priority: 1 }),
            plan({ id: 'B', amount: 10000, priority: 2 }),
        ],
    })
    const a = r.scheduled.find(s => s.id === 'A')!
    const b = r.scheduled.find(s => s.id === 'B')!
    assert.equal(a.recommendedMonth, '2026-12') // 40.000 / 10.000 = 4. ay (index 3)
    assert.equal(b.recommendedMonth, '2027-01') // A'nın ARKASINDA, index 4
    assert.equal(r.warnings.length, 0)         // sıra bozulmadı, uyarı yok
})

test('öncelik inversiyonu uyarısı: önde olan alım geç kalıyor', () => {
    // A öncelik 1 ama akış yetmediği için relief'e (Mart 2027) kadar bekliyor;
    // ucuz B öncelik 2 hemen (ay 0) fonlanabiliyor → sıra tersine döndü.
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 5000,
        reliefs: [{ month: '2027-03', amount: 8000, label: 'Kredi' }],
        plans: [
            plan({ id: 'Araba', amount: 72000, priority: 1, paymentPlan: 'taksit', installmentCount: 12 }),
            plan({ id: 'Kulaklık', amount: 5000, priority: 2 }),
        ],
    })
    const araba = r.scheduled.find(s => s.id === 'Araba')!
    const kulaklik = r.scheduled.find(s => s.id === 'Kulaklık')!
    assert.equal(araba.recommendedMonth, '2027-03')
    assert.equal(kulaklik.recommendedMonth, '2026-09')
    assert.ok(r.warnings.some(w => w.includes('Araba')), 'inversiyon uyarısı Araba için gelmeli')
})

test('istenen tarih kaçınca → gec_kaldi + uyarı', () => {
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 6000,
        plans: [plan({ id: 'Laptop', amount: 25000, priority: 1, desiredBy: '2026-11' })],
    })
    const s = r.scheduled[0]
    assert.equal(s.recommendedMonth, '2027-01') // birikim 5. ay, Kasım'ı kaçırdı
    assert.equal(s.reasonCode, 'gec_kaldi')
    assert.equal(s.conflicts[0].kind, 'gec_kaldi')
    assert.ok(r.warnings.some(w => w.includes('Laptop')))
})

test('dar ay (kasko/MTV) atlanır → yuk_atlandi', () => {
    // Aylık 8.000; Eylül'de 5.000 kasko → o ay kapasite 3.000.
    // Taksit aylık payı 8.000: Eylül'e sığmaz, Ekim'e ötelenir.
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 8000,
        loads: [{ month: '2026-09', amount: 5000, reason: 'Kasko' }],
        plans: [plan({ id: 'Beyaz eşya', amount: 16000, priority: 1, paymentPlan: 'taksit', installmentCount: 2 })],
    })
    const s = r.scheduled[0]
    assert.equal(s.recommendedMonth, '2026-10')
    assert.equal(s.reasonCode, 'yuk_atlandi')
})

test('yalnız planlı olanlar zamanlanır', () => {
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 30000,
        plans: [
            plan({ id: 'planli', amount: 5000, priority: 1, status: 'planli' }),
            plan({ id: 'alindi', amount: 5000, priority: 2, status: 'alindi' }),
            plan({ id: 'vazgecildi', amount: 5000, priority: 3, status: 'vazgecildi' }),
        ],
    })
    assert.equal(r.summary.count, 1)
    assert.equal(r.scheduled.length, 1)
    assert.equal(r.scheduled[0].id, 'planli')
})

test('takvim kapasitesi lumpy yükü yansıtır', () => {
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 10000,
        loads: [{ month: '2026-10', amount: 4000, reason: 'MTV' }],
        plans: [],
    })
    assert.equal(r.timeline[0].capacity, 10000)
    assert.equal(r.timeline[0].isTight, false)
    assert.equal(r.timeline[1].load, 4000)
    assert.equal(r.timeline[1].capacity, 6000)
    assert.equal(r.timeline[1].isTight, true)
})

test('ufka sığmayan alım → ufukta_yok + uyarı', () => {
    // Aylık payı 10.000 olan taksit, 5.000 akışa hiç sığmaz (relief yok).
    const r = buildPurchasePlan({
        from: FROM, monthlyRoom: 5000, months: 12,
        plans: [plan({ id: 'Tekne', amount: 120000, priority: 1, paymentPlan: 'taksit', installmentCount: 12 })],
    })
    const s = r.scheduled[0]
    assert.equal(s.recommendedMonth, null)
    assert.equal(s.reasonCode, 'ufukta_yok')
    assert.equal(r.summary.allPlaced, false)
    assert.ok(r.warnings.some(w => w.includes('Tekne')))
})
