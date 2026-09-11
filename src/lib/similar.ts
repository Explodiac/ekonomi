/**
 * Benzer hareketler — "bu markete ayda ne veriyorum" sorusunu tek bakışta yanıtlar.
 *
 * Saf fonksiyon. Seçili harekete benzeyen GEÇMİŞ hareketleri bulur, aya göre grupla,
 * her ayın toplamıyla döndürür.
 *
 * Benzerlik ölçütü, SIRAYLA:
 *   1. Aynı normalize açıklama (büyük/küçük, boşluk, noktalama temizlenmiş)
 *   2. Hiç açıklama eşleşmesi yoksa: aynı kategori + tutar ±%20 bandı
 *
 * Kapsam: kendisi hariç, aynı tür (gider/gelir), en fazla `maxMonths` ay geriye.
 * Hiç benzer yoksa boş dizi → çağıran blok göstermez.
 */

/** Benzer hareket listesinde esas gün: transaction_date, yoksa cash_date. */
function simDate(t: { transaction_date?: string | null; cash_date?: string | null }): string {
    return (t.transaction_date || t.cash_date || '').slice(0, 10)
}

export type SimilarTx = {
    id: string
    description?: string | null
    category_id?: string | null
    categoryName?: string | null
    amount: number | string
    type?: string | null
    cash_date?: string | null
    transaction_date?: string | null
}

export type SimilarMonth = {
    /** 'YYYY-MM', yeniden eskiye sıralı. */
    month: string
    /** O aydaki eşleşen hareketlerin |tutar| toplamı. */
    total: number
    items: SimilarTx[]
}

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

/** Küçük/büyük harf, noktalama ve fazla boşluk temizlenmiş açıklama. */
export function normalizeDesc(s: string | null | undefined): string {
    return (s ?? '')
        .toLocaleLowerCase('tr')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')  // harf/rakam/boşluk dışı → boşluk
        .replace(/\s+/g, ' ')
        .trim()
}

function shiftMonthKey(monthKey: string, delta: number): string {
    const [y, m] = monthKey.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function findSimilar(
    target: SimilarTx,
    all: SimilarTx[],
    options: { asOf: string; maxMonths?: number }
): SimilarMonth[] {
    const maxMonths = options.maxMonths ?? 6
    const asOfMonth = options.asOf.slice(0, 7)
    const oldestMonth = shiftMonthKey(asOfMonth, -(maxMonths - 1))
    const targetType = target.type ?? 'expense'
    const targetAmt = Math.abs(toNumber(target.amount))
    const targetNorm = normalizeDesc(target.description)

    // Aday havuzu: kendisi hariç, aynı tür, transfer değil, pencere içinde.
    const pool = all.filter(t =>
        t.id !== target.id &&
        t.type !== 'transfer' &&
        (t.type ?? 'expense') === targetType &&
        simDate(t) && simDate(t) <= options.asOf &&
        simDate(t).slice(0, 7) >= oldestMonth
    )

    // 1) Açıklama eşleşmesi
    let matches = targetNorm ? pool.filter(t => normalizeDesc(t.description) === targetNorm) : []

    // 2) Fallback: aynı kategori + tutar ±%20
    if (matches.length === 0 && target.category_id && targetAmt > 0) {
        const lo = targetAmt * 0.8, hi = targetAmt * 1.2
        matches = pool.filter(t => {
            if (t.category_id !== target.category_id) return false
            const a = Math.abs(toNumber(t.amount))
            return a >= lo && a <= hi
        })
    }

    if (matches.length === 0) return []

    // Aya göre grupla
    const byMonth = new Map<string, SimilarMonth>()
    for (const t of matches) {
        const mk = simDate(t).slice(0, 7)
        let g = byMonth.get(mk)
        if (!g) { g = { month: mk, total: 0, items: [] }; byMonth.set(mk, g) }
        g.total = round2(g.total + Math.abs(toNumber(t.amount)))
        g.items.push(t)
    }

    return [...byMonth.values()]
        .map(g => ({ ...g, items: g.items.sort((a, b) => simDate(b).localeCompare(simDate(a))) }))
        .sort((a, b) => b.month.localeCompare(a.month))
}
