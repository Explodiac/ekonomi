/**
 * Alım zamanlama motoru — ekranın kalbi.
 *
 * Alım SİMÜLASYONU tek alımı değerlendirir ("bunu alsam nefes payım yeter mi").
 * Bu motor BİRDEN FAZLA alımı sıraya dizer ve zamanlar: her alıma önerilen ayı
 * ve gerekçesini verir.
 *
 * YENİ HESAP MANTIĞI YOKTUR. Nefes payı (breathing-room.ts), yaklaşan yükler ve
 * taksit bitişleri (upcoming.ts) DIŞARIDA hesaplanır, buraya girdi olarak gelir.
 * Bu dosya yalnız ZAMANLAMA yapar: verili aylık akış kapasitesine alımları
 * yerleştirir. Saf fonksiyon, salt hesap, test edilebilir (node --test).
 *
 * HEDEFLERDEN HABERSİZDİR. Alımlar ve hedefler aynı nefes payından beslenir;
 * `monthlyRoom` çağıran tarafından hedef payı DÜŞÜLMÜŞ hâlde verilir (alımlara
 * kalan akış). Hedef/alım takası ekranda kaydırıcıyla monthlyRoom değiştirilip
 * motor yeniden çağrılarak gösterilir — motor bunu bilmez.
 *
 * MODEL — iki tür çekim, tek zaman çizelgesi:
 *   • capacity(ay) = monthlyRoom + o aya kadar biriken taksit-bitiş rahatlaması
 *                    − o ayın lumpy yükü (kasko/MTV gibi bilinen tek seferlikler)
 *   • TAKSİT: aylık taksit tutarı `installmentCount` ardışık ayın AKIŞINDAN
 *     çekilir; her ayın serbest akışı (capacity − o aya düşen taksitler) tutarı
 *     kaldırmalı. Kaldırmıyorsa başlangıç ayı ötelenir. Bir taksit bitince akış
 *     artar (relief) → o ay fırsat penceresidir.
 *   • PEŞİN: para BİRİKEREK ödenir. Her ayın artan akışı (leftover) bir havuzda
 *     toplanır; peşin alım, havuz tutara ulaştığı ilk aya yerleşir. Dar aylar
 *     (capacity ≤ 0) havuza katkı vermez — o ay birikim olmaz, borçlanma yok.
 *
 * Öncelik sırasına göre AÇGÖZLÜ yerleştirir: yüksek öncelik önce yerini kapar,
 * düşük öncelik kalan boşlukları doldurur. Bu yüzden düşük öncelikli bir alım
 * bazen daha erken aya düşebilir (boşluğu doldurur) — çakışma uyarısı bunu söyler.
 */

import { monthLabel } from './upcoming.ts'

export type PaymentPlan = 'pesin' | 'taksit'
export type PurchaseStatus = 'planli' | 'alindi' | 'vazgecildi'

export type PurchasePlanItem = {
    id: string
    name: string
    amount: number | string
    /** Kullanıcı el sıralaması (küçük = önce). */
    priority: number
    paymentPlan: PaymentPlan
    /** Taksitliyse taksit sayısı. Eksik/≤0 ise peşin gibi tek çekim sayılır. */
    installmentCount?: number | null
    /** İstenen son tarih: 'YYYY-MM' ya da 'YYYY-MM-DD'. Ay hassasiyetiyle bakılır. */
    desiredBy?: string | null
    categoryId?: string | null
    /** Yalnız 'planli' (ya da verilmemiş) zamanlanır; diğerleri atlanır. */
    status?: PurchaseStatus
}

/** upcoming.relievingMonths: bir taksit bittiğinde akışın arttığı ay. */
export type MonthRelief = { month: string; amount: number | string; label?: string }
/** Bilinen tek seferlik/lumpy yük (kasko, MTV): o ayı daraltan tutar. */
export type MonthLoad = { month: string; amount: number | string; reason?: string }

export type PurchasePlanInput = {
    /** Ufkun başladığı ay, 'YYYY-MM' (içinde bulunulan ay). */
    from: string
    /** Ufuk uzunluğu (ay). Varsayılan 24. */
    months?: number
    /** Alımlara kalan aylık nefes payı (hedef payı çağıran tarafından düşülmüş). */
    monthlyRoom: number | string
    /** Taksit bitişleri — o aydan itibaren akışı artırır. */
    reliefs?: MonthRelief[]
    /** Bilinen lumpy yükler — ilgili ayı daraltır. */
    loads?: MonthLoad[]
    plans: PurchasePlanItem[]
}

export type ReasonCode =
    | 'yeterli'         // ilk aya sığdı, beklemedi
    | 'relief'          // bir taksit bitince açılan pencereye yerleşti
    | 'birikim'         // peşin: para birikene kadar beklendi
    | 'taksit_bekledi'  // taksit: akış yetene kadar ötelendi
    | 'yuk_atlandi'     // aradaki dar ay(lar) atlandı (kasko/MTV)
    | 'gec_kaldi'       // istenen tarihe yetişemedi (yine de en erken aya kondu)
    | 'ufukta_yok'      // ufuk içinde yer bulunamadı

export type PurchaseConflict = {
    kind: 'oncelik' | 'gec_kaldi' | 'ufuk'
    message: string
}

export type ScheduledPurchase = {
    id: string
    name: string
    amount: number
    paymentPlan: PaymentPlan
    installmentCount: number | null
    /** Taksit: amount/count; peşin: amount (tek çekim). */
    monthlyAmount: number
    /** Başlangıç ayı ('YYYY-MM'). Alım o ay "sahiplenilir". null → ufukta yer yok. */
    recommendedMonth: string | null
    recommendedLabel: string | null
    /** Taksit: başlangıç+count−1; peşin: = recommendedMonth. */
    completionMonth: string | null
    reasonCode: ReasonCode
    reason: string
    conflicts: PurchaseConflict[]
    categoryId: string | null
}

export type TimelinePlacement = {
    id: string
    name: string
    type: PaymentPlan
    /** Bu aya düşen tutar (taksit: aylık pay; peşin: tam tutar, yalnız başlangıç ayı). */
    amount: number
    categoryId: string | null
    /** Alımın başladığı ay mı (peşinde her zaman true). */
    isStart: boolean
}

export type TimelineMonth = {
    month: string
    label: string
    /** monthlyRoom + o aya kadar biriken relief. */
    baseRoom: number
    /** O ayın lumpy yükü. */
    load: number
    /** baseRoom − load: alımlara ayrılabilir akış. */
    capacity: number
    /** Akışın üç parçası (capacity = committedInstallments + reservedSavings + freeFlow, capacity>0 iken). */
    /** Yerleşmiş taksitlerin bu aya düşen payı. */
    committedInstallments: number
    /** Aktif peşin birikim rezervi (öncelik sırasına göre bu ay tutulan). */
    reservedSavings: number
    /** Kalan serbest akış — yeni yerleşimler buradan. */
    freeFlow: number
    placements: TimelinePlacement[]
    reliefs: MonthRelief[]
    loads: MonthLoad[]
    /** capacity ≤ 0 ya da lumpy yük var. */
    isTight: boolean
}

export type PurchasePlanResult = {
    scheduled: ScheduledPurchase[]
    timeline: TimelineMonth[]
    summary: {
        count: number
        totalAmount: number
        /** Zamanlanan alımların hepsinin bittiği son ay. */
        completionMonth: string | null
        /** from'dan completionMonth'a kaç ay. */
        completionInMonths: number | null
        /** Tümü ufka sığdı mı. */
        allPlaced: boolean
        monthlyRoom: number
    }
    warnings: string[]
}

// ─── yardımcılar ───────────────────────────────────────────────────────────

const EPS = 0.005 // kuruş toleransı

function toNum(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}
function round2(n: number): number { return Math.round(n * 100) / 100 }

/** 'YYYY-MM' ya da 'YYYY-MM-DD' → 'YYYY-MM'. */
function toMonth(s: string): string { return s.slice(0, 7) }

/** 'YYYY-MM' + delta ay → 'YYYY-MM' (ay taşması Date ile emilir). */
function addMonths(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** b − a, ay cinsinden (negatif olabilir). */
function diffMonths(a: string, b: string): number {
    const [ay, am] = a.split('-').map(Number)
    const [by, bm] = b.split('-').map(Number)
    return (by - ay) * 12 + (bm - am)
}

// ─── ana fonksiyon ─────────────────────────────────────────────────────────

export function buildPurchasePlan(input: PurchasePlanInput): PurchasePlanResult {
    const from = toMonth(input.from)
    const horizon = Math.max(1, input.months ?? 24)
    const monthlyRoom = round2(toNum(input.monthlyRoom))

    // Ay anahtarları ve indeks tablosu.
    const months: string[] = Array.from({ length: horizon }, (_, i) => addMonths(from, i))
    const idxOf = new Map(months.map((m, i) => [m, i]))

    // Relief: o aydan İTİBAREN akışı artırır → her ay için biriken toplam.
    const reliefAt = new Array(horizon).fill(0)
    const reliefList: MonthRelief[][] = Array.from({ length: horizon }, () => [])
    for (const r of input.reliefs ?? []) {
        const i = idxOf.get(toMonth(r.month))
        if (i == null) continue
        reliefAt[i] += toNum(r.amount)
        reliefList[i].push(r)
    }
    // Lumpy yük: yalnız kendi ayını daraltır.
    const loadAt = new Array(horizon).fill(0)
    const loadList: MonthLoad[][] = Array.from({ length: horizon }, () => [])
    for (const l of input.loads ?? []) {
        const i = idxOf.get(toMonth(l.month))
        if (i == null) continue
        loadAt[i] += toNum(l.amount)
        loadList[i].push(l)
    }

    // baseRoom[i] = monthlyRoom + Σ relief (month ≤ i);  capacity[i] = baseRoom − load
    const baseRoom = new Array(horizon).fill(0)
    const capacity = new Array(horizon).fill(0)
    let reliefCum = 0
    for (let i = 0; i < horizon; i++) {
        reliefCum += reliefAt[i]
        baseRoom[i] = round2(monthlyRoom + reliefCum)
        capacity[i] = round2(baseRoom[i] - loadAt[i])
    }

    // Değişen durum — her ayın akışı öncelik sırasıyla REZERVE edilir. İki bileşen:
    //   committed[i] : yerleşmiş taksitlerin bu aya düşen payı
    //   savings[i]   : aktif peşin birikim rezervi (alım biriktiği her ay tuttuğu pay)
    // Serbest akış = capacity − committed − savings. Yeni bir alım yalnız serbest
    // akışa yerleşebilir; böylece düşük öncelikli hiçbir alım (taksit dahil) yüksek
    // öncelikli bir peşinin biriktirdiği payı yiyemez → havuz sızıntısı kapanır.
    const committed = new Array(horizon).fill(0)
    const savings = new Array(horizon).fill(0)
    const placements: TimelinePlacement[][] = Array.from({ length: horizon }, () => [])

    /** Bu ay yeni yerleşime açık akış (load dahil). */
    const freeFlow = (i: number) => round2(capacity[i] - committed[i] - savings[i])
    /** Aynısı ama lumpy yük hariç — 'yuk_atlandi' gerekçesini ayırmak için. */
    const freeFlowNoLoad = (i: number) => round2(baseRoom[i] - committed[i] - savings[i])

    // Yalnız planlıları, öncelik sırasında (kararlı) zamanla.
    const queue = input.plans
        .map((p, order) => ({ p, order }))
        .filter(({ p }) => (p.status ?? 'planli') === 'planli')
        .sort((a, b) => (a.p.priority - b.p.priority) || (a.order - b.order))

    const scheduled: ScheduledPurchase[] = []

    for (const { p } of queue) {
        const amount = round2(toNum(p.amount))
        const isTaksit = p.paymentPlan === 'taksit' && toNum(p.installmentCount) >= 1
        const count = isTaksit ? Math.round(toNum(p.installmentCount)) : 1
        const monthlyAmount = isTaksit ? round2(amount / count) : amount
        const desiredMonth = p.desiredBy ? toMonth(p.desiredBy) : null

        let startIdx: number | null = null
        let idealIdx: number | null = null // yük yokmuş gibi en erken sığdığı yer (gerekçe için)

        if (isTaksit) {
            // Aylık pay, count ardışık ayın SERBEST akışına sığmalı.
            const fits = (i: number, free: (j: number) => number) => {
                for (let k = 0; k < count; k++) {
                    const j = i + k
                    if (j >= horizon) return false
                    if (free(j) + EPS < monthlyAmount) return false
                }
                return true
            }
            for (let i = 0; i + count <= horizon; i++) {
                if (idealIdx == null && fits(i, freeFlowNoLoad)) idealIdx = i
                if (fits(i, freeFlow)) { startIdx = i; break }
            }
            if (startIdx != null) {
                for (let k = 0; k < count; k++) committed[startIdx + k] = round2(committed[startIdx + k] + monthlyAmount)
            }
        } else {
            // Peşin: ay 0'dan itibaren serbest akıştan biriktir; tükettiği payı
            // biriktiği HER AY rezerve et. Böylece bu birikim, daha düşük öncelikli
            // alımlardan korunur (öncelik sırası her ayda tutulur). Hedefe ulaşılan
            // ay = alımın ayı. Dar ay (serbest akış ≤ 0) katkı vermez → borçlanma yok.
            const take = new Array(horizon).fill(0)
            let acc = 0
            for (let i = 0; i < horizon; i++) {
                const free = Math.max(0, freeFlow(i))
                const t = Math.min(free, round2(amount - acc))
                take[i] = round2(t)
                acc = round2(acc + t)
                if (acc + EPS >= amount) { startIdx = i; break }
            }
            if (startIdx != null) {
                for (let i = 0; i <= startIdx; i++) savings[i] = round2(savings[i] + take[i])
            }
        }

        // Yerleştirme kaydı + gerekçe.
        let recommendedMonth: string | null = null
        let completionMonth: string | null = null
        let reasonCode: ReasonCode = 'ufukta_yok'
        const conflicts: PurchaseConflict[] = []

        if (startIdx == null) {
            reasonCode = 'ufukta_yok'
            conflicts.push({ kind: 'ufuk', message: `${horizon} aylık ufukta ${p.name} için yer açılmıyor.` })
        } else {
            recommendedMonth = months[startIdx]
            completionMonth = isTaksit ? months[startIdx + count - 1] : recommendedMonth

            // placements: taksit her aya pay; peşin yalnız başlangıç ayına tam tutar.
            if (isTaksit) {
                for (let k = 0; k < count; k++) {
                    placements[startIdx + k].push({ id: p.id, name: p.name, type: 'taksit', amount: monthlyAmount, categoryId: p.categoryId ?? null, isStart: k === 0 })
                }
            } else {
                placements[startIdx].push({ id: p.id, name: p.name, type: 'pesin', amount, categoryId: p.categoryId ?? null, isStart: true })
            }

            // Gerekçe seçimi.
            const onReliefMonth = reliefAt[startIdx] > 0
            const skippedLoad = isTaksit && idealIdx != null && startIdx > idealIdx &&
                loadAt.slice(idealIdx, startIdx + count).some(v => v > 0)
            if (startIdx === 0) reasonCode = 'yeterli'
            else if (onReliefMonth) reasonCode = 'relief'
            else if (skippedLoad) reasonCode = 'yuk_atlandi'
            else reasonCode = isTaksit ? 'taksit_bekledi' : 'birikim'

            // İstenen tarih kaçtı mı?
            if (desiredMonth && recommendedMonth > desiredMonth) {
                reasonCode = 'gec_kaldi'
                conflicts.push({ kind: 'gec_kaldi', message: `${p.name} ${monthLabel(desiredMonth)}'a isteniyordu; en erken ${monthLabel(recommendedMonth)}.` })
            }
        }

        scheduled.push({
            id: p.id,
            name: p.name,
            amount,
            paymentPlan: p.paymentPlan,
            installmentCount: isTaksit ? count : null,
            monthlyAmount,
            recommendedMonth,
            recommendedLabel: recommendedMonth ? monthLabel(recommendedMonth) : null,
            completionMonth,
            reasonCode,
            reason: describeReason(reasonCode, { name: p.name, count, isTaksit, month: recommendedMonth, reliefLabel: startIdx != null ? topReliefLabel(reliefList[startIdx]) : null }),
            conflicts,
            categoryId: p.categoryId ?? null,
        })
    }

    // Zaman çizelgesi — akışın üç parçası ay ay.
    const timeline: TimelineMonth[] = []
    for (let i = 0; i < horizon; i++) {
        timeline.push({
            month: months[i],
            label: monthLabel(months[i]),
            baseRoom: baseRoom[i],
            load: round2(loadAt[i]),
            capacity: capacity[i],
            committedInstallments: round2(committed[i]),
            reservedSavings: round2(savings[i]),
            freeFlow: Math.max(0, freeFlow(i)),
            placements: placements[i],
            reliefs: reliefList[i],
            loads: loadList[i],
            isTight: capacity[i] <= 0 || loadAt[i] > 0,
        })
    }

    // Özet.
    const placed = scheduled.filter(s => s.completionMonth != null)
    const completionMonth = placed.length
        ? placed.reduce((max, s) => (s.completionMonth! > max ? s.completionMonth! : max), placed[0].completionMonth!)
        : null
    const summary = {
        count: queue.length,
        totalAmount: round2(queue.reduce((s, { p }) => s + toNum(p.amount), 0)),
        completionMonth,
        completionInMonths: completionMonth ? diffMonths(from, completionMonth) + 1 : null,
        allPlaced: placed.length === queue.length,
        monthlyRoom,
    }

    return { scheduled, timeline, summary, warnings: buildWarnings(scheduled) }
}

// ─── gerekçe ve uyarı metinleri ─────────────────────────────────────────────

function topReliefLabel(reliefs: MonthRelief[]): string | null {
    if (!reliefs.length) return null
    return reliefs.reduce((a, b) => (toNum(a.amount) >= toNum(b.amount) ? a : b)).label ?? null
}

function describeReason(
    code: ReasonCode,
    ctx: { name: string; count: number; isTaksit: boolean; month: string | null; reliefLabel: string | null }
): string {
    switch (code) {
        case 'yeterli': return 'nefes payı yeterli'
        case 'relief': return ctx.reliefLabel ? `${ctx.reliefLabel} taksidi bitiyor, akış açılıyor` : 'bir taksit bitiyor, akış açılıyor'
        case 'birikim': return 'para birikene kadar bekliyor'
        case 'taksit_bekledi': return ctx.isTaksit ? `${ctx.count} taksit, ondan önce nefes payı yetmiyor` : 'nefes payı yetene kadar bekliyor'
        case 'yuk_atlandi': return 'aradaki dar ay (kasko/MTV) atlandı'
        case 'gec_kaldi': return 'istenen tarihe yetişmiyor, en erken aya kondu'
        case 'ufukta_yok': return 'ufukta yer yok'
    }
}

/** Ekran üstü çakışma uyarıları: öncelik tersine döndüyse ve yerleşmeyen varsa. */
function buildWarnings(scheduled: ScheduledPurchase[]): string[] {
    const warnings: string[] = []

    // Öncelik inversiyonu: sırada önde olan bir alım, arkasındakinden daha geç aya düştü.
    for (const s of scheduled) {
        if (!s.recommendedMonth) continue
        const later = scheduled.find(o =>
            o.recommendedMonth && o.id !== s.id &&
            o.recommendedMonth < s.recommendedMonth! &&
            scheduled.indexOf(o) > scheduled.indexOf(s)
        )
        if (later) {
            warnings.push(`${s.name} sıralamada önde ama nefes payın ${s.recommendedLabel}'dan önce yetmiyor; ${later.name} daha erken alınabiliyor.`)
            break // tek örnek yeter, tekrar etme
        }
    }

    const notPlaced = scheduled.filter(s => s.reasonCode === 'ufukta_yok')
    if (notPlaced.length) warnings.push(`${notPlaced.map(s => s.name).join(', ')} ufuk içinde yer bulamadı — nefes payı yetersiz.`)

    const late = scheduled.filter(s => s.reasonCode === 'gec_kaldi')
    for (const s of late) {
        if (s.conflicts[0]) warnings.push(s.conflicts[0].message)
    }

    return warnings
}
