/**
 * Akış — geçmişe bakan para hareketi özeti.
 *
 * Saf fonksiyon. Yalnızca GERÇEKLEŞEN hareketleri (cash_date <= bugün) toplar;
 * tahmin yoktur (ileriye bakan görünümler Yaklaşan ve Nakit'te). Transferler
 * net'e girmez — iki bacak birbirini götürdüğü için tamamen dışlanır.
 *
 * Bir dönemin çıktısı: giren / çıkan / net, gider kategorisi kırılımı ve gelir
 * kaynağı kırılımı. Dönem granülerliği aylık / 3 aylık / yıllık olabilir.
 */

export type FlowTransaction = {
    amount: number | string
    type: string
    /** Hareketin yapıldığı gün — gelir/gider akışında esas tarih. */
    transaction_date?: string | null
    /** Paranın çıkacağı gün — akış özetinde kullanılmaz (yalnız nakit-akışı ekranlarında). */
    cash_date: string
    category_id?: string | null
    categoryName?: string | null
    description?: string | null
    transfer_direction?: string | null
    /** Abonelik/taksit kaynağı; splitRecurring için. */
    source_type?: string | null
}

/**
 * Akış/özet hesaplarında esas alınan gün: transaction_date (hareketin yapıldığı
 * gün), yoksa cash_date. Kart harcaması yapıldığı ay gösterilir; son ödeme günü
 * (cash_date) gelecekte olsa bile. 'YYYY-MM-DD'.
 */
function flowDay(t: FlowTransaction): string {
    return (t.transaction_date || t.cash_date || '').slice(0, 10)
}

export type FlowBreakdown = {
    key: string
    label: string
    amount: number
}

export type FlowPeriod = {
    /** Makine anahtarı: '2026-08' (ay), '2026-Q3' (çeyrek), '2026' (yıl). */
    key: string
    inflow: number
    outflow: number
    net: number
    /** Gider kategorileri, tutara göre azalan. */
    byCategory: FlowBreakdown[]
    /** Gelir kaynakları, tutara göre azalan. */
    byIncomeSource: FlowBreakdown[]
    /** Bu dönem henüz bitmedi mi (içinde bulunulan ay/çeyrek/yıl). */
    isCurrent: boolean
}

export type Granularity = 'month' | 'quarter' | 'year'

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function todayISO(reference: Date = new Date()): string {
    const y = reference.getFullYear()
    const m = String(reference.getMonth() + 1).padStart(2, '0')
    const d = String(reference.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

/** Bir cash_date'in (YYYY-MM-DD) hangi döneme düştüğünün anahtarı. */
function periodKeyOf(date: string, granularity: Granularity): string {
    const [y, m] = date.split('-').map(Number)
    if (granularity === 'year') return String(y)
    if (granularity === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
    return `${y}-${String(m).padStart(2, '0')}`
}

/** asOf'un içinde bulunduğu dönemin anahtarı — isCurrent tespiti için. */
function currentPeriodKey(asOf: string, granularity: Granularity): string {
    return periodKeyOf(asOf, granularity)
}

/**
 * Geçmiş hareketleri döneme göre gruplar. Dönüş eskiden yeniye sıralı.
 * Yalnızca cash_date <= asOf olanlar; transferler dışlanır.
 */
export function buildFlow(
    transactions: FlowTransaction[],
    options: { granularity?: Granularity; asOf?: string } = {}
): FlowPeriod[] {
    const granularity = options.granularity ?? 'month'
    const asOf = options.asOf ?? todayISO()
    const currentKey = currentPeriodKey(asOf, granularity)

    type Acc = {
        inflow: number
        outflow: number
        categories: Map<string, FlowBreakdown>
        incomes: Map<string, FlowBreakdown>
    }
    const buckets = new Map<string, Acc>()

    for (const t of transactions) {
        const day = flowDay(t)
        if (!day || day > asOf) continue
        if (t.type === 'transfer' || t.transfer_direction) continue // net'e girmez
        if (t.type !== 'income' && t.type !== 'expense') continue

        const key = periodKeyOf(day, granularity)
        let acc = buckets.get(key)
        if (!acc) {
            acc = { inflow: 0, outflow: 0, categories: new Map(), incomes: new Map() }
            buckets.set(key, acc)
        }

        const amount = Math.abs(toNumber(t.amount))
        if (t.type === 'income') {
            acc.inflow += amount
            const label = t.categoryName || t.description || 'Diğer gelir'
            const bk = acc.incomes.get(label) ?? { key: label, label, amount: 0 }
            bk.amount += amount
            acc.incomes.set(label, bk)
        } else {
            acc.outflow += amount
            const label = t.categoryName || 'Kategorisiz'
            const bk = acc.categories.get(t.category_id || label) ?? { key: t.category_id || label, label, amount: 0 }
            bk.amount += amount
            acc.categories.set(t.category_id || label, bk)
        }
    }

    return [...buckets.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, acc]) => ({
            key,
            inflow: round2(acc.inflow),
            outflow: round2(acc.outflow),
            net: round2(acc.inflow - acc.outflow),
            byCategory: [...acc.categories.values()]
                .map(b => ({ ...b, amount: round2(b.amount) }))
                .sort((a, b) => b.amount - a.amount),
            byIncomeSource: [...acc.incomes.values()]
                .map(b => ({ ...b, amount: round2(b.amount) }))
                .sort((a, b) => b.amount - a.amount),
            isCurrent: key === currentKey,
        }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash flow — bir TARİH ARALIĞI için özet (Copilot Akış ekranı).
// Dönem karşılaştırması sayfada iki çağrıyla yapılır (mevcut + önceki/geçen yıl).
// ─────────────────────────────────────────────────────────────────────────────

export type CashflowMonth = {
    /** 'YYYY-MM' */
    month: string
    income: number
    expense: number
    net: number
    /** İçinde bulunulan ay (asOf'un ayı). */
    isCurrent: boolean
    /** asOf'tan sonraki ay — eksen kapsıyor ama bar yok (boş bırakılır). */
    isFuture: boolean
}

export type CashflowCategory = {
    key: string
    label: string
    /** Dönem toplamı. */
    amount: number
    /** months sırasına hizalı aylık toplam (yığılmış bar için). */
    monthly: number[]
}

export type CashflowResult = {
    from: string
    to: string
    totalIncome: number
    totalExpense: number
    net: number
    /** Dönemi kapsayan aylar (eskiden yeniye), gelecek dahil (boş). */
    months: CashflowMonth[]
    /** Gelir kaynakları kırılımı + aylık matris (azalan). */
    incomeSources: CashflowCategory[]
    /** Gider kategorileri kırılımı + aylık matris (azalan). */
    expenseCategories: CashflowCategory[]
    /** splitRecurring: source_type dolu (abonelik/taksit) gelir/gider toplamı. */
    recurringIncome: number
    recurringExpense: number
}

/** from..to ay anahtarları (dahil), eskiden yeniye. */
function monthsBetween(from: string, to: string): string[] {
    const out: string[] = []
    let [y, m] = from.slice(0, 7).split('-').map(Number)
    const end = to.slice(0, 7)
    for (let i = 0; i < 240; i++) {
        const mk = `${y}-${String(m).padStart(2, '0')}`
        out.push(mk)
        if (mk >= end) break
        m++; if (m > 12) { m = 1; y++ }
    }
    return out
}

const RECURRING_KEY = '__recurring__'

export function buildCashflowPeriod(input: {
    transactions: FlowTransaction[]
    /** 'YYYY-MM-DD' — dönem başı (dahil). */
    from: string
    /** 'YYYY-MM-DD' — dönem sonu (dahil). */
    to: string
    /** 'YYYY-MM-DD' — bugün. Bundan sonrası gerçekleşmemiş sayılır. */
    asOf?: string
    /** Açıksa source_type dolu hareketler ayrı "Düzenli" grubunda toplanır. */
    splitRecurring?: boolean
}): CashflowResult {
    const asOf = input.asOf ?? todayISO()
    const { from, to } = input
    const split = input.splitRecurring ?? false
    const asOfMonth = asOf.slice(0, 7)
    const monthKeys = monthsBetween(from, to)
    const monthIndex = new Map(monthKeys.map((mk, i) => [mk, i]))

    const monthAcc = monthKeys.map(() => ({ income: 0, expense: 0 }))
    let totalIncome = 0, totalExpense = 0, recurringIncome = 0, recurringExpense = 0
    const incomeMap = new Map<string, { label: string; amount: number; monthly: number[] }>()
    const catMap = new Map<string, { label: string; amount: number; monthly: number[] }>()

    for (const t of input.transactions) {
        const day = flowDay(t)
        if (!day || day < from || day > to) continue
        if (day > asOf) continue // gerçekleşmemiş → toplamlara girmez
        if (t.type === 'transfer' || t.transfer_direction) continue
        if (t.type !== 'income' && t.type !== 'expense') continue

        const mk = day.slice(0, 7)
        const mi = monthIndex.get(mk)
        if (mi === undefined) continue
        const amount = Math.abs(toNumber(t.amount))
        const isRecurring = split && !!t.source_type

        if (t.type === 'income') {
            totalIncome += amount
            monthAcc[mi].income += amount
            if (isRecurring) recurringIncome += amount
            const label = isRecurring ? 'Düzenli gelir' : (t.categoryName || t.description || 'Diğer gelir')
            let bk = incomeMap.get(label)
            if (!bk) { bk = { label, amount: 0, monthly: monthKeys.map(() => 0) }; incomeMap.set(label, bk) }
            bk.amount += amount
            bk.monthly[mi] += amount
        } else {
            totalExpense += amount
            monthAcc[mi].expense += amount
            if (isRecurring) recurringExpense += amount
            const key = isRecurring ? RECURRING_KEY : (t.category_id || t.categoryName || 'Kategorisiz')
            const label = isRecurring ? 'Düzenli / taksitli' : (t.categoryName || 'Kategorisiz')
            let c = catMap.get(key)
            if (!c) { c = { label, amount: 0, monthly: monthKeys.map(() => 0) }; catMap.set(key, c) }
            c.amount += amount
            c.monthly[mi] += amount
        }
    }

    const months: CashflowMonth[] = monthKeys.map((mk, i) => ({
        month: mk,
        income: round2(monthAcc[i].income),
        expense: round2(monthAcc[i].expense),
        net: round2(monthAcc[i].income - monthAcc[i].expense),
        isCurrent: mk === asOfMonth,
        isFuture: mk > asOfMonth,
    }))

    return {
        from, to,
        totalIncome: round2(totalIncome),
        totalExpense: round2(totalExpense),
        net: round2(totalIncome - totalExpense),
        months,
        incomeSources: [...incomeMap.entries()]
            .map(([key, v]) => ({ key, label: v.label, amount: round2(v.amount), monthly: v.monthly.map(round2) }))
            .sort((a, b) => b.amount - a.amount),
        expenseCategories: [...catMap.entries()]
            .map(([key, v]) => ({ key, label: v.label, amount: round2(v.amount), monthly: v.monthly.map(round2) }))
            .sort((a, b) => b.amount - a.amount),
        recurringIncome: round2(recurringIncome),
        recurringExpense: round2(recurringExpense),
    }
}
