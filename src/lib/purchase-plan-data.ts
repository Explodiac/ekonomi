/**
 * Alım zamanlama motorunun (purchase-plan.ts) GİRDİLERİNİ mevcut verilerden
 * hazırlayan tek yardımcı. Nefes payı, taksit-bitiş pencereleri (relief) ve
 * lumpy yükler (load) burada TEK yerde türetilir; alım-listesi ve dashboard
 * aynı reçeteyi kullanır (üçüncü kopya yazılmaz).
 *
 * Yeni hesap mantığı YOKTUR: projeksiyon, upcoming ve breathing-room dışarıda
 * hesaplanmış olarak gelir; burada yalnızca motorun beklediği şekle sokulur.
 */

import { computeBreathingRoom } from './breathing-room.ts'
import { computeBaseIncome } from './base-income.ts'
import type { EstimateTransaction } from './estimate.ts'
import type { ProjectionResult } from './projection.ts'
import type { UpcomingResult } from './upcoming.ts'
import type { MonthRelief, MonthLoad } from './purchase-plan.ts'

export type PurchasePlanContext = {
    /** Mevcut aylık nefes payı — hedef payı DÜŞÜLMÜŞ (alımlara kalan varsayılan). */
    monthlyRoomBase: number
    /** Aktif hedeflere aylık ayrılan toplam (takas kaydırıcısı için). */
    goalAllocTotal: number
    reliefs: MonthRelief[]
    loads: MonthLoad[]
    /** Nefes payının dayandığı aylık düzenli (taban) gelir — ekranda gösterilir. */
    baseIncome: number
    /** 'düzenli' işaretli en az bir gelir kategorisi var mı (yoksa uyarı gösterilir). */
    hasBaseIncome: boolean
}

export type GoalAllocRow = { monthly_alloc: number | string | null; status?: string | null }

function median(values: number[]): number {
    if (!values.length) return 0
    const s = [...values].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function avg(arr: number[]): number { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }

export function computePurchasePlanContext(args: {
    projection: ProjectionResult
    upcoming: UpcomingResult
    transactions: EstimateTransaction[]
    goals: GoalAllocRow[]
    currentMonth: string
    /** is_base_income=true gelir kategorileri — taban gelir yalnız bunlardan. */
    baseIncomeCategoryIds: string[]
}): PurchasePlanContext {
    const { projection, upcoming, transactions, goals, currentMonth, baseIncomeCategoryIds } = args

    // Taban gelir: TEK kaynak — yalnız 'düzenli' işaretli kategoriler (base-income.ts).
    const base = computeBaseIncome({ transactions, baseCategoryIds: baseIncomeCategoryIds, currentMonth })
    const baseIncome = base.monthly
    const mandatory = Math.round(avg(projection.months.map(m => m.outflowKnown))) // hedef payı DAHİL
    const br = computeBreathingRoom({ baseIncome, mandatoryOutflow: mandatory, transactions, currentMonth })

    const goalAllocTotal = goals
        .filter(g => (g.status ?? 'aktif') === 'aktif')
        .reduce((s, g) => s + Number(g.monthly_alloc || 0), 0)

    // Fırsat pencereleri + lumpy yükler upcoming'den (yeniden hesaplama yok).
    const reliefs: MonthRelief[] = upcoming.relievingMonths.map(r => ({ month: r.month, amount: r.monthlyRelief, label: r.label }))
    const med = median(upcoming.months.map(m => m.total))
    const loads: MonthLoad[] = upcoming.months
        .filter(m => m.isHeavy && m.total > med)
        .map(m => ({ month: m.month, amount: Math.round(m.total - med), reason: m.heavyReason }))

    return { monthlyRoomBase: br.breathingRoom, goalAllocTotal, reliefs, loads, baseIncome, hasBaseIncome: base.hasBaseCategory }
}
