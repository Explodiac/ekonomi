/**
 * Fren mekanizması — kategori bütçe limiti kontrolü.
 *
 * Saf fonksiyon. Fren BİLGİLENDİRİR, engellemez; karar kullanıcıdadır. Renk değil
 * değer konuşur: aşım "dikkat" tonuyla bildirilir, kırmızı alarmla değil. Limiti
 * olmayan kategori sessizdir (null döner).
 */

export type BudgetCategory = {
    id: string
    name: string
    budget_limit?: number | string | null
}

export type BudgetTransaction = {
    amount: number | string
    type: string
    cash_date: string
    category_id?: string | null
    source_type?: string | null
}

export type BudgetStatus = {
    categoryId: string
    label: string
    spent: number
    limit: number
    ratio: number
    /** 'bilgi' %80'i aştı, 'dikkat' %100'ü aştı. */
    level: 'bilgi' | 'dikkat'
    /** Limit aşıldıysa aşım tutarı, aksi halde 0. */
    over: number
    text: string
}

const INFO_THRESHOLD = 0.80

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function monthKeyOf(iso: string): string {
    return iso.slice(0, 7)
}

function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(amount))} ₺`
}

/**
 * Bir harcama toplamını bir SINIRA karşı değerlendirir — eşik ve metin mantığının
 * tek kaynağı. Sınır tek-ay limiti (checkBudget) ya da devir dahil "available"
 * (budget-rollover) olabilir; ikisi de bunu çağırır.
 *
 * - limit <= 0 → null (sessiz)
 * - %80'in altında → null
 * - %80–%100 → 'bilgi': "Market: bu ay 3.400 / 4.000 ₺"
 * - %100+ → 'dikkat': "Market bütçesini 600 ₺ aştınız (4.600 / 4.000)"
 */
export function evaluateBudget(
    categoryId: string,
    label: string,
    spent: number,
    limit: number,
    /** 'bilgi' uyarısının eşiği (0-1). Tercihlerden gelmezse mevcut sabit %80. */
    infoThreshold: number = INFO_THRESHOLD
): BudgetStatus | null {
    if (limit <= 0) return null
    spent = round2(spent)

    const ratio = spent / limit
    if (ratio < infoThreshold) return null

    if (ratio >= 1) {
        const over = round2(spent - limit)
        return {
            categoryId, label, spent, limit, ratio,
            level: 'dikkat', over,
            text: `${label} bütçesini ${formatTL(over)} aştınız (${formatTL(spent)} / ${formatTL(limit)})`,
        }
    }

    return {
        categoryId, label, spent, limit, ratio,
        level: 'bilgi', over: 0,
        text: `${label}: bu ay ${formatTL(spent)} / ${formatTL(limit)}`,
    }
}

/**
 * Bir kategorinin belirtilen aydaki toplamını (tek-ay) limitine karşı kontrol eder.
 * Devir dahil gerçek sınır için budget-rollover kullanılır; bu, limit'in devirsiz
 * hâlidir ve geriye uyumluluk için korunur.
 */
export function checkBudget(
    categoryId: string,
    month: string,
    categories: BudgetCategory[],
    transactions: BudgetTransaction[],
    infoThreshold: number = INFO_THRESHOLD
): BudgetStatus | null {
    const category = categories.find(c => c.id === categoryId)
    if (!category) return null

    let spent = 0
    for (const t of transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        if (t.category_id !== categoryId) continue
        if (monthKeyOf(t.cash_date) !== month) continue
        spent += Math.abs(toNumber(t.amount))
    }

    return evaluateBudget(categoryId, category.name, spent, toNumber(category.budget_limit), infoThreshold)
}
