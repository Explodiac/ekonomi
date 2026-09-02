/**
 * Kategori bazlı harcama tahmini.
 *
 * Saf fonksiyon. Tahmin son 3 TAM ayın (içinde bulunulan ay hariç) ortalamasıdır.
 * Bir kategori bu üç ayın hepsinde görünmüyorsa yeterli veri yok sayılır ve tahmin
 * ÜRETİLMEZ — uydurma tahmin güven kaybettirir.
 *
 * Yalnızca source_type'ı boş hareketler sayılır: abonelik/sözleşme/taksit kaynaklı
 * harcamalar değişken değil, bilinen yüktür ve upcoming/projection'da ayrıca işlenir.
 */

export type EstimateTransaction = {
    amount: number | string
    type: string
    cash_date: string
    category_id?: string | null
    categoryName?: string | null
    source_type?: string | null
    /** Harcama doğası: 'tek_seferlik' ortalamaya GİRMEZ; 'aliskanlik'/null girer. */
    spend_nature?: string | null
}

export type CategoryEstimate = {
    categoryId: string
    label: string
    /** Aylık ortalama harcama (pozitif). */
    amount: number
    /** Kaç tam aydan hesaplandı (daima >= MIN_BASIS_MONTHS). */
    basisMonths: number
    /** Kullanıcıya gösterilecek dayanak: "son 3 ay ortalaması". */
    basisLabel: string
}

export type MonthEndProjection = {
    categoryId: string
    label: string
    /** Bu ay şimdiye kadar harcanan. */
    soFar: number
    /** Ay sonu doğrusal izdüşüm. */
    projected: number
    /** Karşılaştırma için 3 ay ortalaması. */
    average: number
    basisMonths: number
}

/** 3 aydan az veriyle tahmin üretilmez. */
export const MIN_BASIS_MONTHS = 3

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

/** currentMonth'tan `delta` ay kaydırır. delta negatif = geçmiş. */
function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Son 3 tam ay: içinde bulunulan aydan önceki üç ay. */
function basisMonthsOf(currentMonth: string): string[] {
    return [1, 2, 3].map(i => shiftMonth(currentMonth, -i))
}

/**
 * Bir kategorinin son 3 tam aydaki aylık ortalama harcaması.
 * Kategori bu üç ayın hepsinde görünmüyorsa null (yeterli veri yok).
 */
export function estimateCategory(
    transactions: EstimateTransaction[],
    categoryId: string,
    currentMonth: string
): CategoryEstimate | null {
    const basis = new Set(basisMonthsOf(currentMonth))
    const monthTotals = new Map<string, number>()
    let label = ''

    for (const t of transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        if (t.source_type) continue
        if (t.spend_nature === 'tek_seferlik') continue
        if (t.category_id !== categoryId) continue
        const month = monthKeyOf(t.cash_date)
        if (!basis.has(month)) continue

        monthTotals.set(month, (monthTotals.get(month) ?? 0) + Math.abs(toNumber(t.amount)))
        if (!label && t.categoryName) label = t.categoryName
    }

    // Üç ayın hepsinde harcama olmalı; aksi halde tahmin güvenilir değil.
    if (monthTotals.size < MIN_BASIS_MONTHS) return null

    // MEDYAN + trend: ortalama tek aykırı aya duyarlı (bir 11.000'lik ay tahmini
    // %17 şişirir). Medyan aykırıyı bastırır. Ama medyan artan trendi geç yakalar;
    // son ay medyanın belirgin üstündeyse (>%25) son aya ağırlık verip trendi yakala.
    const values = [...monthTotals.values()]
    const n = values.length
    const sorted = [...values].sort((a, b) => a - b)
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    const latestMonth = basisMonthsOf(currentMonth)[0] // en yakın tam ay
    const latest = monthTotals.get(latestMonth) ?? median

    const rising = latest > median * 1.25
    const amount = rising ? (median + latest) / 2 : median

    return {
        categoryId,
        label: label || 'Kategori',
        amount: round2(amount),
        basisMonths: n,
        basisLabel: rising ? `son ${n} ay, artan trend` : `son ${n} ay medyanı`,
    }
}

/**
 * Ay içi ayna: bu ayın şimdiye kadarki harcamasını doğrusal izdüşümle ay sonuna
 * taşır ve 3 ay ortalamasıyla karşılaştırır. Bir limit değildir; kategori limiti
 * olmasa da çalışır. 3 ay verisi yoksa (karşılaştırma tabanı yok) null döner.
 */
export function projectMonthEnd(
    transactions: EstimateTransaction[],
    categoryId: string,
    currentMonth: string,
    asOf: string
): MonthEndProjection | null {
    const estimate = estimateCategory(transactions, categoryId, currentMonth)
    if (!estimate) return null

    const [y, m] = currentMonth.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const asOfDay = Number(asOf.slice(8, 10)) || 1
    const elapsed = Math.min(Math.max(asOfDay, 1), daysInMonth)

    let soFar = 0
    for (const t of transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        if (t.source_type) continue
        if (t.spend_nature === 'tek_seferlik') continue
        if (t.category_id !== categoryId) continue
        if (monthKeyOf(t.cash_date) !== currentMonth) continue
        if (t.cash_date > asOf) continue
        soFar += Math.abs(toNumber(t.amount))
    }

    const projected = round2((soFar / elapsed) * daysInMonth)

    return {
        categoryId,
        label: estimate.label,
        soFar: round2(soFar),
        projected,
        average: estimate.amount,
        basisMonths: estimate.basisMonths,
    }
}

export type EndedSeries = {
    categoryId: string
    label: string
    /** Son görüldüğü aya kadar üst üste kaç ay sürdüğü. */
    consecutiveMonths: number
    /** Son görüldüğü ay 'YYYY-MM'. */
    lastMonth: string
}

/**
 * Bitmiş seri tespiti (2e): bir kategori 3+ ay ÜST ÜSTE görünüp SON 2 ayda hiç
 * görünmediyse muhtemelen bitmiş bir şeydir (diş tedavisi gibi), kalıcı alışkanlık
 * değil. Kullanıcıya "alışkanlık ortalamasından çıkarayım mı?" diye sorulur;
 * onaylanırsa o kategorinin geçmişi tek_seferlik işaretlenir. Kural KARAR VERMEZ,
 * yalnız aday çıkarır. Çok eski seriler (son ay > 4 ay önce) elenir.
 */
export function detectEndedSeries(
    transactions: EstimateTransaction[],
    currentMonth: string
): EndedSeries[] {
    const lastTwo = [shiftMonth(currentMonth, -1), shiftMonth(currentMonth, -2)]
    const recentFloor = shiftMonth(currentMonth, -4)

    const byCat = new Map<string, { label: string; months: Set<string> }>()
    for (const t of transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        if (t.source_type) continue
        if (t.spend_nature === 'tek_seferlik') continue
        if (!t.category_id) continue
        const mk = monthKeyOf(t.cash_date)
        if (mk >= currentMonth) continue // yalnız tamamlanmış geçmiş aylar
        let c = byCat.get(t.category_id)
        if (!c) { c = { label: t.categoryName || 'Kategori', months: new Set() }; byCat.set(t.category_id, c) }
        c.months.add(mk)
        if (t.categoryName && c.label === 'Kategori') c.label = t.categoryName
    }

    const out: EndedSeries[] = []
    for (const [categoryId, c] of byCat) {
        if (lastTwo.some(m => c.months.has(m))) continue // son 2 ayda var → hâlâ aktif
        const lastMonth = [...c.months].sort().pop()
        if (!lastMonth || lastMonth < recentFloor) continue // hiç yok ya da çok eski
        let run = 0, m: string = lastMonth
        while (c.months.has(m)) { run++; m = shiftMonth(m, -1) }
        if (run < MIN_BASIS_MONTHS) continue // üst üste 3 aydan kısa → seri sayılmaz
        out.push({ categoryId, label: c.label, consecutiveMonths: run, lastMonth })
    }
    return out.sort((a, b) => (a.lastMonth < b.lastMonth ? 1 : -1))
}

/**
 * Projeksiyon motoru için: 3 ay kuralını geçen tüm kategorilerin tahmini,
 * tutara göre azalan. estimateCategory tek kaynak olduğu için kural tek yerde.
 */
export function estimateAllCategories(
    transactions: EstimateTransaction[],
    currentMonth: string
): CategoryEstimate[] {
    const categoryIds = new Set<string>()
    for (const t of transactions) {
        if (t.spend_nature === 'tek_seferlik') continue
        if (t.type === 'expense' && !t.source_type && t.category_id) {
            categoryIds.add(t.category_id)
        }
    }

    const result: CategoryEstimate[] = []
    for (const id of categoryIds) {
        const est = estimateCategory(transactions, id, currentMonth)
        if (est) result.push(est)
    }
    return result.sort((a, b) => b.amount - a.amount)
}
