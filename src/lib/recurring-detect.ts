/**
 * Tekrarlayan harcama tanıma — abonelik ÖNERİR, otomatik eklemez.
 *
 * Saf fonksiyon, salt okuma. Yanlış tanıma kullanıcıyı bezdirir; bu yüzden eşik
 * yüksek ve tüm kurallar birlikte sağlanmalı. Az öneri, doğru öneri.
 *
 * Girdi: source_type'ı boş (abonelik/kural kaynaklı olmayan) harcamalar. Zaten bir
 * aboneliğe/taksite bağlı hareketler desen aramasına girmez — çift saymayı önler.
 *
 * Bir grup (aynı açıklama + kategori) aday sayılır ANCAK:
 *   - en az 3 kez tekrarlamışsa,
 *   - ardışık aralıklar net aylık (25-35 gün) VEYA net yıllık (350-380 gün) ritimdeyse,
 *   - tutarlar ortalamanın ±%10'u içindeyse,
 *   - son 4 ay içinde en az bir örnek varsa (ölü abonelik önerilmez).
 * Biri bile tutmuyorsa aday DEĞİL.
 */

export type RecurringTransaction = {
    id: string
    amount: number | string
    type: string
    cash_date: string
    description?: string | null
    category_id?: string | null
    categoryName?: string | null
    source_type?: string | null
}

export type Cadence = 'aylik' | 'yillik'

export type RecurringCandidate = {
    label: string
    categoryId: string | null
    avgAmount: number
    cadence: Cadence
    dayOfMonth: number
    occurrenceCount: number
    /** 'YYYY-MM-DD' — en son görülen örnek. */
    lastSeen: string
    sampleTransactionIds: string[]
}

export const MIN_OCCURRENCES = 3
export const AMOUNT_TOLERANCE = 0.10
export const RECENCY_MONTHS = 4

const MONTH_MIN = 25, MONTH_MAX = 35
const YEAR_MIN = 350, YEAR_MAX = 380

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function normalize(s: string | null | undefined): string {
    return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Gün cinsinden fark (a - b), iki 'YYYY-MM-DD' arasında. */
function dayDiff(a: string, b: string): number {
    return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000)
}

/** iso'dan n ay geri ('YYYY-MM-DD'). Gün taşması yaklaşık kabul edilir (4 ay penceresi). */
function subMonths(iso: string, n: number): string {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1 - n, d)).toISOString().slice(0, 10)
}

function median(nums: number[]): number {
    const s = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Aday kimliği — reddedilenler listesiyle eşleştirmek için kararlı parmak izi. */
export function candidateFingerprint(c: Pick<RecurringCandidate, 'label' | 'categoryId' | 'cadence'>): string {
    return `${normalize(c.label)}|${c.categoryId ?? ''}|${c.cadence}`
}

type Group = { key: string; txs: RecurringTransaction[] }

export function detectRecurring(
    transactions: RecurringTransaction[],
    asOf: string = new Date().toISOString().slice(0, 10)
): RecurringCandidate[] {
    // Gruplama: aynı açıklama + kategori. Açıklama yoksa yalnız kategori.
    const groups = new Map<string, Group>()
    for (const t of transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        if (t.source_type) continue
        const desc = normalize(t.description)
        const key = desc ? `${desc}|${t.category_id ?? ''}` : `__cat__${t.category_id ?? 'none'}`
        let g = groups.get(key)
        if (!g) { g = { key, txs: [] }; groups.set(key, g) }
        g.txs.push(t)
    }

    const cutoff = subMonths(asOf, RECENCY_MONTHS)
    const candidates: RecurringCandidate[] = []

    for (const g of groups.values()) {
        if (g.txs.length < MIN_OCCURRENCES) continue

        const sorted = [...g.txs].sort((a, b) => a.cash_date.localeCompare(b.cash_date))
        const amounts = sorted.map(t => Math.abs(toNumber(t.amount)))
        const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length

        // Tutar tutarlılığı: hepsi ortalamanın ±%10'u içinde (sıfır ortalama elenir).
        if (mean <= 0) continue
        if (!amounts.every(a => Math.abs(a - mean) / mean <= AMOUNT_TOLERANCE)) continue

        // Ritim: ardışık aralıkların HEPSİ ya aylık ya yıllık bandında olmalı.
        const gaps: number[] = []
        for (let i = 1; i < sorted.length; i++) gaps.push(dayDiff(sorted[i].cash_date, sorted[i - 1].cash_date))
        const allMonthly = gaps.every(gp => gp >= MONTH_MIN && gp <= MONTH_MAX)
        const allYearly = gaps.every(gp => gp >= YEAR_MIN && gp <= YEAR_MAX)
        const cadence: Cadence | null = allMonthly ? 'aylik' : allYearly ? 'yillik' : null
        if (!cadence) continue

        // Tazelik: son örnek 4 ay içinde olmalı.
        const lastSeen = sorted[sorted.length - 1].cash_date
        if (lastSeen < cutoff) continue

        // Etiket: gruptaki en sık boş-olmayan açıklama; yoksa kategori adı.
        const descCounts = new Map<string, number>()
        for (const t of sorted) {
            const d = (t.description ?? '').trim()
            if (d) descCounts.set(d, (descCounts.get(d) ?? 0) + 1)
        }
        let label = ''
        let best = 0
        for (const [d, c] of descCounts) if (c > best) { best = c; label = d }
        if (!label) label = sorted.find(t => t.categoryName)?.categoryName ?? 'Düzenli ödeme'

        candidates.push({
            label,
            categoryId: sorted[0].category_id ?? null,
            avgAmount: round2(mean),
            cadence,
            dayOfMonth: Math.round(median(sorted.map(t => Number(t.cash_date.slice(8, 10))))),
            occurrenceCount: sorted.length,
            lastSeen,
            sampleTransactionIds: sorted.map(t => t.id),
        })
    }

    // Çok tekrarlayan ve büyük tutarlı öneriler önce.
    return candidates.sort((a, b) =>
        b.occurrenceCount - a.occurrenceCount || b.avgAmount - a.avgAmount)
}
