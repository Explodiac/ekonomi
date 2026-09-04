/**
 * Taban (düzenli) gelir — nefes payı ve taksit kararlarının TEK gelir kaynağı.
 *
 * Yalnız is_base_income=true gelir kategorilerindeki gelir sayılır; prim, ek
 * gelir, freelance (değişken) HESABA KATILMAZ — garantisi olmayan parayla
 * taahhüt altına girilmesin. projection.ts'in incomeKnown/incomeEstimated
 * ayrımı (gerçekleşmiş vs tahmini) BAŞKA bir eksendir; bu taban/değişken eksenidir.
 *
 * Aylık ortalama son `months` TAM aydan (bu ay hariç) alınır ve SABİT böleme
 * (months) uygulanır — breathing-room'un alışkanlık penceresiyle aynı, genç
 * hesapta olduğundan DÜŞÜK çıkar (ihtiyatlı). Saf fonksiyon.
 */

export type BaseIncomeTransaction = {
    amount: number | string
    type: string
    cash_date: string
    category_id?: string | null
    transfer_direction?: string | null
}

export type BaseIncomeResult = {
    /** Aylık ortalama düzenli gelir. */
    monthly: number
    /** Household'ta 'düzenli' işaretli en az bir gelir kategorisi var mı. */
    hasBaseCategory: boolean
    /** Pencerede düzenli gelir görülen ay sayısı (0 → hiç veri yok). */
    monthsWithData: number
}

function toNumber(v: number | string | null | undefined): number {
    const n = typeof v === 'string' ? parseFloat(v) : v
    return Number.isFinite(n as number) ? (n as number) : 0
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function computeBaseIncome(input: {
    transactions: BaseIncomeTransaction[]
    baseCategoryIds: string[]
    currentMonth: string
    months?: number
}): BaseIncomeResult {
    const months = input.months ?? 3
    const baseSet = new Set(input.baseCategoryIds)
    const hasBaseCategory = baseSet.size > 0
    const window = new Set(Array.from({ length: months }, (_, i) => shiftMonth(input.currentMonth, -(i + 1))))

    let sum = 0
    const monthsSeen = new Set<string>()
    for (const t of input.transactions) {
        if (t.type !== 'income' || t.transfer_direction) continue
        if (!t.category_id || !baseSet.has(t.category_id)) continue
        if (!t.cash_date) continue
        const mk = t.cash_date.slice(0, 7)
        if (!window.has(mk)) continue
        sum += Math.abs(toNumber(t.amount))
        monthsSeen.add(mk)
    }

    return {
        monthly: round2(sum / months),
        hasBaseCategory,
        monthsWithData: monthsSeen.size,
    }
}
