/**
 * Aylık bütçe + devir (rollover). budget.ts'in tek-ay limitini genişletir.
 *
 * Saf fonksiyon, salt okuma. Her kategori-ay bir kova: available = budgeted +
 * carriedIn; remaining = available − spent. Bir ayın remaining'i sonraki ayın
 * carriedIn'i olur (YNAB mantığı, sade).
 *
 * Üç karar:
 *  1) Devir başlangıcı: ilk (en eski) döneme carriedIn = 0. Geriye dönük hesap yok.
 *  2) Zaman: değer chain'den TÜRETİLİR ve deterministiktir. Geçmiş ayın spent'i
 *     ay bittiği için sabittir (cash_date o ay içinde ve <= asOf). İçinde bulunulan
 *     ay canlıdır (spent asOf'a kadar), gelecek aya sadece tahmini carriedIn taşınır.
 *     status alanı bunu etiketler: 'past' kesin, 'current' canlı, 'future' tahmini.
 *  3) Negatif devir seçmeli: kapalıysa remaining<0 olan ay carriedIn=0 devreder
 *     (borç taşınmaz); pozitif devir her hâlde çalışır. Varsayılan: AÇIK.
 *
 * spent, budget.ts ile tutarlı biçimde kategorinin TÜM giderini sayar (source_type
 * dahil): bütçe gerçek harcama sınırıdır, bilinen yükler de ona yazılır.
 */

export type BudgetPeriodInput = {
    categoryId: string
    /** 'YYYY-MM' ya da 'YYYY-MM-DD' (ay başı) — ay anahtarına indirgenir. */
    period: string
    budgeted: number | string
}

export type RolloverTransaction = {
    amount: number | string
    type: string
    cash_date: string
    category_id?: string | null
    source_type?: string | null
}

export type PeriodStatus = 'past' | 'current' | 'future'

export type RolloverOptions = {
    /** 'YYYY-MM' — içinde bulunulan ay. */
    currentMonth: string
    /** 'YYYY-MM-DD' — bu tarihe kadarki harcama (canlı spent). */
    asOf: string
    /** Negatif devir açık mı? Varsayılan true. */
    negativeCarry?: boolean
}

export type BudgetPeriodResult = {
    categoryId: string
    /** 'YYYY-MM' */
    period: string
    budgeted: number
    carriedIn: number
    /** budgeted + carriedIn — devir dahil gerçek sınır. */
    available: number
    spent: number
    /** available − spent. */
    remaining: number
    /** remaining < 0. */
    isOver: boolean
    status: PeriodStatus
}

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

/** Bir dönemin remaining'i sonraki döneme ne taşır? */
function carryFrom(remaining: number, negativeCarry: boolean): number {
    if (remaining >= 0) return round2(remaining)        // pozitif devir her zaman
    return negativeCarry ? round2(remaining) : 0        // negatif devir seçmeli
}

/**
 * Tüm kategori-ay kovalarını hesaplar. Dönüş düz liste (kategori, dönem sıralı).
 */
export function computeBudgetRollover(
    periods: BudgetPeriodInput[],
    transactions: RolloverTransaction[],
    options: RolloverOptions
): BudgetPeriodResult[] {
    const { currentMonth, asOf } = options
    const negativeCarry = options.negativeCarry ?? true

    // spent[categoryId][month] — kategorinin o aydaki gideri, asOf'a kadar.
    // asOf sınırı: geçmiş tam, bu ay canlı, gelecek 0.
    const spent = new Map<string, Map<string, number>>()
    for (const t of transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        if (!t.category_id) continue
        if (t.cash_date > asOf) continue
        const month = monthKeyOf(t.cash_date)
        let byMonth = spent.get(t.category_id)
        if (!byMonth) { byMonth = new Map(); spent.set(t.category_id, byMonth) }
        byMonth.set(month, (byMonth.get(month) ?? 0) + Math.abs(toNumber(t.amount)))
    }

    // Kategori bazında dönemleri sırala; chain'le carriedIn türet.
    const byCategory = new Map<string, BudgetPeriodInput[]>()
    for (const p of periods) {
        const list = byCategory.get(p.categoryId) ?? []
        list.push(p)
        byCategory.set(p.categoryId, list)
    }

    const results: BudgetPeriodResult[] = []
    for (const [categoryId, list] of byCategory) {
        const sorted = [...list].sort((a, b) => monthKeyOf(a.period).localeCompare(monthKeyOf(b.period)))
        let prevRemaining: number | null = null

        for (const p of sorted) {
            const month = monthKeyOf(p.period)
            const budgeted = round2(toNumber(p.budgeted))
            // Karar 1: ilk dönem carriedIn = 0; sonrası önceki dönemden.
            const carriedIn = prevRemaining === null ? 0 : carryFrom(prevRemaining, negativeCarry)
            const available = round2(budgeted + carriedIn)
            const spentHere = round2(spent.get(categoryId)?.get(month) ?? 0)
            const remaining = round2(available - spentHere)
            const status: PeriodStatus =
                month < currentMonth ? 'past' : month === currentMonth ? 'current' : 'future'

            results.push({
                categoryId, period: month,
                budgeted, carriedIn, available,
                spent: spentHere, remaining,
                isOver: remaining < 0,
                status,
            })
            prevRemaining = remaining
        }
    }

    return results
}

/**
 * Tek bir kategori-ay kovasını döndürür (fren ve kategori detayı için). Kategori
 * o ay için bütçelenmemişse null.
 */
export function getBudgetPeriod(
    categoryId: string,
    month: string,
    periods: BudgetPeriodInput[],
    transactions: RolloverTransaction[],
    options: RolloverOptions
): BudgetPeriodResult | null {
    const all = computeBudgetRollover(periods, transactions, options)
    return all.find(r => r.categoryId === categoryId && r.period === month) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Kategori hiyerarşisi — parent'a göre gruplu bütçe ağacı (TEK SEVİYE).
// Mevcut düz fonksiyonlar (computeBudgetRollover / getBudgetPeriod) bozulmaz;
// bu ek yalnızca ağaç isteyen tüketiciler içindir. flattenBudgetTree ile geriye
// uyumlu düz görünüm de alınabilir.
// ─────────────────────────────────────────────────────────────────────────────

export type BudgetCategoryMeta = {
    id: string
    parent_id?: string | null
}

export type BudgetTreeNode = {
    categoryId: string
    budgeted: number
    carriedIn: number
    /** budgeted + carriedIn (devir dahil). Parent'ta: kendi bütçesi ya da çocuk toplamı. */
    available: number
    spent: number
    remaining: number
    isOver: boolean
    /** Yalnız parent düğümlerde: bütçesi olan alt kategoriler. */
    children?: BudgetTreeNode[]
}

export type BudgetTreeInput = {
    categories: BudgetCategoryMeta[]
    periods: BudgetPeriodInput[]
    transactions: RolloverTransaction[]
    currentMonth: string
    asOf: string
    negativeCarry?: boolean
    /** Ağacın kurulacağı ay; varsayılan currentMonth. */
    month?: string
}

/**
 * parent_id'yi GÜVENLİ çöz. Tek seviye kural:
 *   - parent yok / kendine işaret / eksik referans → üst seviye (null)
 *   - parent'ın kendisi de bir child ise (geçerli parent_id'si var) → nesting YAPMA (null)
 *     Böylece A→B→A döngüsü ikisini de üst seviyeye düşürür, çökme olmaz.
 */
export function safeParent(cat: BudgetCategoryMeta, byId: Map<string, BudgetCategoryMeta>): string | null {
    const p = cat.parent_id
    if (!p || p === cat.id) return null
    const parent = byId.get(p)
    if (!parent) return null
    const pp = parent.parent_id
    if (pp && pp !== parent.id && byId.has(pp)) return null
    return p
}

/** Bir aydaki kategori bazlı harcanan (budget spent ile aynı evren: tüm gider, cash_date<=asOf). */
function spentByCategory(transactions: RolloverTransaction[], month: string, asOf: string): Map<string, number> {
    const m = new Map<string, number>()
    for (const t of transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        if (!t.category_id) continue
        if (t.cash_date > asOf) continue
        if (monthKeyOf(t.cash_date) !== month) continue
        m.set(t.category_id, round2((m.get(t.category_id) ?? 0) + Math.abs(toNumber(t.amount))))
    }
    return m
}

export function computeBudgetTree(input: BudgetTreeInput): BudgetTreeNode[] {
    const month = input.month ?? input.currentMonth
    const flat = computeBudgetRollover(input.periods, input.transactions, {
        currentMonth: input.currentMonth, asOf: input.asOf, negativeCarry: input.negativeCarry,
    })
    const resultById = new Map<string, BudgetPeriodResult>()
    for (const r of flat) if (r.period === month) resultById.set(r.categoryId, r)

    const byId = new Map(input.categories.map(c => [c.id, c]))
    const spent = spentByCategory(input.transactions, month, input.asOf)

    // TÜM alt kategorileri (bütçeli olsun olmasın) güvenli parent'a göre grupla.
    const childCatsOf = new Map<string, string[]>()
    for (const c of input.categories) {
        const pid = safeParent(c, byId)
        if (pid) {
            const list = childCatsOf.get(pid) ?? []
            list.push(c.id)
            childCatsOf.set(pid, list)
        }
    }

    const leaf = (r: BudgetPeriodResult): BudgetTreeNode => ({
        categoryId: r.categoryId, budgeted: r.budgeted, carriedIn: r.carriedIn,
        available: r.available, spent: r.spent, remaining: r.remaining, isOver: r.isOver,
    })

    const nodes: BudgetTreeNode[] = []
    const consumed = new Set<string>()  // parent olarak ya da child leaf olarak yerleşenler

    // 1) Çocuğu olan kategoriler → parent düğüm
    for (const [parentId, childIds] of childCatsOf) {
        const own = resultById.get(parentId)
        const hasOwnBudget = !!own && own.available > 0
        const budgetedKids = childIds
            .map(id => resultById.get(id))
            .filter((r): r is BudgetPeriodResult => !!r)
        // Grup bütçesizse (ne parent ne çocuk) gösterme.
        if (!hasOwnBudget && budgetedKids.length === 0) continue

        // Harcanan: parent'ın kendi + TÜM alt kategorilerin harcaması (bütçesiz çocuklar dahil).
        const groupSpent = round2(
            (spent.get(parentId) ?? 0) + childIds.reduce((s, id) => s + (spent.get(id) ?? 0), 0)
        )

        let budgeted: number, carriedIn: number, available: number
        if (hasOwnBudget) {
            // Parent'ın kendi budget_periods kaydı VARSA o kullanılır (çakışmada parent kazanır).
            budgeted = own!.budgeted; carriedIn = own!.carriedIn; available = own!.available
        } else {
            budgeted = round2(budgetedKids.reduce((s, k) => s + k.budgeted, 0))
            carriedIn = round2(budgetedKids.reduce((s, k) => s + k.carriedIn, 0))
            available = round2(budgetedKids.reduce((s, k) => s + k.available, 0))
        }
        const remaining = round2(available - groupSpent)

        nodes.push({
            categoryId: parentId, budgeted, carriedIn, available,
            spent: groupSpent, remaining, isOver: remaining < 0,
            children: budgetedKids.length > 0 ? budgetedKids.map(leaf) : undefined,
        })
        consumed.add(parentId)
        for (const k of budgetedKids) consumed.add(k.categoryId)
    }

    // 2) Kalan bütçeli, üst-seviye yapraklar (parent olmayan, child olarak yerleşmemiş)
    for (const r of resultById.values()) {
        if (consumed.has(r.categoryId)) continue
        nodes.push(leaf(r))
    }

    return nodes
}

/** Ağacı düz listeye indirger (parent + children sırayla) — geriye uyumlu görünüm. */
export function flattenBudgetTree(nodes: BudgetTreeNode[]): BudgetTreeNode[] {
    const out: BudgetTreeNode[] = []
    for (const n of nodes) {
        out.push(n)
        if (n.children) out.push(...n.children)
    }
    return out
}
