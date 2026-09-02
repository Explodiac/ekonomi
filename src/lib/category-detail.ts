/**
 * Kategori detayı — tek bir kategorinin geçmişi ve bu ayki durumu.
 *
 * Saf fonksiyon, salt okuma. YENİ hesap modeli yazmaz; mevcut motorları çağırır:
 *   - aylık toplamlar  → flow.ts (buildFlow, aylık granülerlik)
 *   - 3 ay ortalaması + ay içi izdüşüm → estimate.ts (projectMonthEnd)
 *   - limit durumu     → budget.ts (checkBudget)
 *
 * Bu dosyanın kendi işi yalnızca veri şekillendirme: 12 aylık pencere kurmak,
 * ortalamaları birer sayı diziden ortalamak ve hareketleri sıralamak.
 */

import { buildFlow, type FlowTransaction } from './flow.ts'
import { projectMonthEnd, MIN_BASIS_MONTHS, type MonthEndProjection } from './estimate.ts'
import { checkBudget, evaluateBudget, type BudgetCategory, type BudgetStatus } from './budget.ts'
import { getBudgetPeriod, safeParent, type BudgetPeriodInput, type BudgetPeriodResult, type BudgetCategoryMeta } from './budget-rollover.ts'

/** Grafik penceresi: içinde bulunulan ay dahil geriye doğru ay sayısı. */
export const DETAIL_MONTHS = 24
/** 3 tam aydan az veri → ortalama/tahmin gösterme. */
const MIN_YEAR_MONTHS = 3

export type CategoryDetailTransaction = {
    id?: string | number
    amount: number | string
    type: string
    cash_date: string
    transaction_date?: string | null
    description?: string | null
    category_id?: string | null
    categoryName?: string | null
    account_id?: string | null
    source_type?: string | null
    transfer_direction?: string | null
}

export type MonthTotal = {
    /** 'YYYY-MM' */
    month: string
    total: number
    /** İçinde bulunulan (henüz bitmemiş) ay. */
    isCurrent: boolean
    /** 12 ay ortalamasının üstünde mi (yeterli veri yoksa daima false). */
    aboveAverage: boolean
}

/** Hiyerarşi çözümü + lejant adı için kategori üst-verisi. */
export type CategoryNodeMeta = BudgetCategoryMeta & { name?: string | null }

/** Parent grafiğinde bir alt kategorinin aylık serisi (yığılmış bar segmenti). */
export type ChildSeries = {
    categoryId: string
    label: string
    /** Pencere sırasıyla (eskiden yeniye) aylık toplam. */
    byMonth: number[]
    /** Pencere boyu toplam (lejant sıralaması için). */
    total: number
}

/** Yıllık özet (Key metrics). */
export type YearMetric = {
    year: number
    total: number
    /** Aylık ortalama — bu yıl için geçen ay sayısına göre (yıl bitmediyse kısmi). */
    monthlyAvg: number
    /** Ortalamada kullanılan ay sayısı. */
    months: number
    /** Yıl henüz sürüyor mu (içinde bulunulan yıl). */
    isCurrent: boolean
}

export type CategoryDetailInput = {
    categoryId: string
    /** Ad ve limit için kategori kaydı; yoksa etiket hareketlerden alınır. */
    category?: BudgetCategory | null
    transactions: CategoryDetailTransaction[]
    /** 'YYYY-MM' — içinde bulunulan ay. */
    currentMonth: string
    /** 'YYYY-MM-DD' — bugüne kadar (soFar ve izdüşüm için). */
    asOf: string
    /** Listedeki son hareket sayısı (varsayılan 40). */
    recentLimit?: number
    /** Verilirse bütçe durumu devir DAHİL available'a göre hesaplanır. */
    budgetPeriods?: BudgetPeriodInput[]
    negativeCarry?: boolean
    /** Bütçe 'bilgi' uyarı eşiği (0-1). Tercihlerden gelmezse mevcut sabit %80. */
    budgetInfoThreshold?: number
    /** Hiyerarşi için tüm kategoriler (parent_id + ad). Verilirse parent kırılımı hesaplanır. */
    categories?: CategoryNodeMeta[]
}

export type CategoryDetail = {
    categoryId: string
    label: string
    /** Bu kategori bir üst kategori mi (alt kategorileri var). */
    isParent: boolean
    /** Parent ise alt kategori serileri (yığılmış bar + lejant); değilse boş. */
    children: ChildSeries[]
    /** Parent'ın KENDİ doğrudan harcaması (pencere sırası) — yığılmış barda ek segment. */
    ownByMonth: number[]
    /** Yıllık özet (Key metrics), yeniden eskiye. */
    yearly: YearMetric[]
    /** DETAIL_MONTHS ay, eskiden yeniye; içinde bulunulan ay dahil. Boş aylar total 0.
     *  Parent'ta total = kendi + alt kategoriler. */
    byMonth: MonthTotal[]
    /** Son 3 tam ay ortalaması (estimate.ts). Yeterli veri yoksa null. */
    avg3: number | null
    /** Penceredeki tamamlanmış, harcama olan ayların ortalaması. Yetersizse null. */
    avg12: number | null
    /** Bu ay şimdiye kadar harcanan (izdüşüm penceresinden bağımsız, hep var). */
    soFar: number
    /** Ay içi izdüşüm (estimate.ts). Yeterli veri yoksa null. */
    projection: MonthEndProjection | null
    /** Limit durumu. Devir verisi varsa available'a, yoksa tek-ay limitine göre. */
    budget: BudgetStatus | null
    /** Bu ayki bütçe kovası (devir dahil). Kategori bütçelenmemişse null. */
    rollover: BudgetPeriodResult | null
    /** Bu ayki bütçe (available). Parent'ta grup toplamı; bütçe yoksa null.
     *  Grafikteki bütçe çizgisi ve "X kaldı" bunu kullanır. */
    budgetThisMonth: number | null
    /** 3 tam aydan az veri varsa false → ortalama ve izdüşüm gösterilmez. */
    hasEnoughData: boolean
    /** Bu kategorinin son hareketleri, yeniden eskiye. */
    recentTransactions: CategoryDetailTransaction[]
}

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

/** month'tan delta ay kaydırır ('YYYY-MM'). delta negatif = geçmiş. */
function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** currentMonth dahil, geriye doğru DETAIL_MONTHS ayın anahtarları (eskiden yeniye). */
function monthWindow(currentMonth: string): string[] {
    return Array.from({ length: DETAIL_MONTHS }, (_, i) => shiftMonth(currentMonth, -(DETAIL_MONTHS - 1 - i)))
}

export function buildCategoryDetail(input: CategoryDetailInput): CategoryDetail {
    const { categoryId, category, transactions, currentMonth, asOf } = input
    const recentLimit = input.recentLimit ?? 40

    // 1) Aylık toplamlar — flow.ts motoru. buildFlow cash_date <= asOf olanları alır,
    //    transferleri dışlar; gider kategorisi toplamı byCategory[categoryId]'de.
    const periods = buildFlow(transactions as FlowTransaction[], { granularity: 'month', asOf })
    const seriesOf = (catId: string) => {
        const m = new Map<string, number>()
        for (const p of periods) {
            const hit = p.byCategory.find(c => c.key === catId)
            if (hit) m.set(p.key, hit.amount)
        }
        return m
    }

    // Hiyerarşi: bu kategorinin GÜVENLİ alt kategorileri (computeBudgetTree mantığı).
    const cats = input.categories ?? []
    const byId = new Map<string, CategoryNodeMeta>(cats.map(c => [c.id, c]))
    const childCats = cats.filter(c => safeParent(c, byId) === categoryId)
    const isParent = childCats.length > 0

    const ownMap = seriesOf(categoryId)
    const childMaps = childCats.map(c => ({ meta: c, map: seriesOf(c.id) }))

    // Toplam aylık — parent'ta kendi + tüm alt kategoriler (tüm ayları kapsayan birleşik map).
    const totalMap = new Map<string, number>()
    const addMap = (m: Map<string, number>) => { for (const [k, v] of m) totalMap.set(k, round2((totalMap.get(k) ?? 0) + v)) }
    addMap(ownMap)
    for (const c of childMaps) addMap(c.map)

    const window = monthWindow(currentMonth)

    // 2) Ortalama tabanı: penceredeki TAMAMLANMIŞ (bu ay hariç), harcama olan aylar.
    const completedWithSpend = window
        .filter(m => m !== currentMonth)
        .map(m => totalMap.get(m) ?? 0)
        .filter(v => v > 0)

    // 3) İzdüşüm — yalnız yaprak kategoride anlamlı (estimate own harcamayı sayar).
    const projection = isParent ? null : projectMonthEnd(transactions, categoryId, currentMonth, asOf)
    // Yeterlilik: yaprakta estimate; parent'ta toplam seride ≥3 harcama ayı.
    const hasEnoughData = isParent ? completedWithSpend.length >= MIN_YEAR_MONTHS : projection !== null

    const avg3 = projection ? projection.average : null
    const avg12 = hasEnoughData && completedWithSpend.length > 0
        ? round2(completedWithSpend.reduce((s, v) => s + v, 0) / completedWithSpend.length)
        : null

    const byMonth: MonthTotal[] = window.map(month => {
        const total = round2(totalMap.get(month) ?? 0)
        return {
            month,
            total,
            isCurrent: month === currentMonth,
            // Vurgu değerle: pencere ortalamasının üstündeki aylar (renk değil).
            aboveAverage: avg12 !== null && total > avg12,
        }
    })

    const ownByMonth = window.map(m => round2(ownMap.get(m) ?? 0))
    const children: ChildSeries[] = childMaps
        .map(c => ({
            categoryId: c.meta.id,
            label: c.meta.name ?? 'Alt kategori',
            byMonth: window.map(m => round2(c.map.get(m) ?? 0)),
            total: round2(window.reduce((s, m) => s + (c.map.get(m) ?? 0), 0)),
        }))
        .filter(c => c.total > 0)
        .sort((a, b) => b.total - a.total)

    // 4) Yıllık metrikler — tüm veri, yıla göre gruplu. Bu yıl geçen kısma göre ortalanır.
    const curYear = Number(currentMonth.slice(0, 4))
    const curMonthNum = Number(currentMonth.slice(5, 7))
    const yearTotals = new Map<number, number>()
    for (const [mk, v] of totalMap) {
        const yr = Number(mk.slice(0, 4))
        yearTotals.set(yr, round2((yearTotals.get(yr) ?? 0) + v))
    }
    const yearly: YearMetric[] = [...yearTotals.entries()]
        .filter(([, total]) => total > 0)
        .map(([year, total]) => {
            const months = year === curYear ? curMonthNum : 12
            return { year, total, months, monthlyAvg: round2(total / Math.max(1, months)), isCurrent: year === curYear }
        })
        .sort((a, b) => b.year - a.year)

    const soFar = round2(totalMap.get(currentMonth) ?? 0)

    // 4) Bütçe durumu. Devir verisi varsa gerçek sınır = available (budget-rollover);
    //    yoksa budget.ts tek-ay limitine düşer (geriye uyum).
    let rollover: BudgetPeriodResult | null = null
    let budget: BudgetStatus | null = null
    let budgetThisMonth: number | null = null
    if (input.budgetPeriods) {
        const opts = { currentMonth, asOf, negativeCarry: input.negativeCarry ?? true }
        rollover = getBudgetPeriod(categoryId, currentMonth, input.budgetPeriods, transactions, opts)
        budget = rollover
            ? evaluateBudget(categoryId, category?.name ?? projection?.label ?? 'Kategori', rollover.spent, rollover.available, input.budgetInfoThreshold)
            : null
        // Bütçe çizgisi (grafik) + "X kaldı". Parent grup bütçesi computeBudgetTree kuralıyla:
        // parent'ın kendi bütçesi varsa o kazanır, yoksa alt kategorilerin toplamı.
        const ownAvail = rollover && rollover.available > 0 ? rollover.available : null
        if (isParent) {
            if (ownAvail != null) {
                budgetThisMonth = ownAvail
            } else {
                const kidAvails = childCats
                    .map(c => getBudgetPeriod(c.id, currentMonth, input.budgetPeriods!, transactions, opts))
                    .filter((b): b is BudgetPeriodResult => !!b && b.available > 0)
                budgetThisMonth = kidAvails.length ? round2(kidAvails.reduce((s, k) => s + k.available, 0)) : null
            }
        } else {
            budgetThisMonth = ownAvail
        }
    } else if (category) {
        budget = checkBudget(categoryId, currentMonth, [category], transactions, input.budgetInfoThreshold)
        budgetThisMonth = budget ? budget.limit : null
    }

    // Etiket: kategori kaydından, yoksa hareketlerden, yoksa projeksiyondan.
    let label = category?.name ?? ''
    if (!label) {
        const named = transactions.find(t => t.category_id === categoryId && t.categoryName)
        label = named?.categoryName ?? projection?.label ?? 'Kategori'
    }

    // Parent'ta grup hareketleri (kendi + alt kategoriler); yaprakta yalnız kendi.
    // Gelecek (asOf sonrası, planlı taksit) satırları listede gösterilmez.
    const catSet = new Set<string>([categoryId, ...childCats.map(c => c.id)])
    const recentTransactions = transactions
        .filter(t => t.category_id && catSet.has(t.category_id) && t.cash_date && t.cash_date <= asOf)
        .sort((a, b) =>
            b.cash_date.localeCompare(a.cash_date) ||
            String(b.transaction_date ?? '').localeCompare(String(a.transaction_date ?? '')))
        .slice(0, recentLimit)

    return {
        categoryId,
        label,
        isParent,
        children,
        ownByMonth,
        yearly,
        byMonth,
        avg3,
        avg12,
        soFar,
        projection,
        budget,
        rollover,
        budgetThisMonth,
        hasEnoughData,
        recentTransactions,
    }
}

export { MIN_BASIS_MONTHS }
