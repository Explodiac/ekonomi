/**
 * Yorum motoru.
 *
 * Saf fonksiyon, LLM YOK. En fazla 3 cümle döner. Söyleyecek bir şey yoksa boş
 * dizi döner — "her şey yolunda" doldurması yapmaz.
 *
 * Her kural ayrı, tek başına test edilebilir bir fonksiyondur. Kurallar
 * öncelik sırasına göre değerlendirilir, en yüksek öncelikli üç tanesi seçilir.
 */

import { monthName, monthLocative, type UpcomingResult } from './upcoming.ts'
import type { ProjectionResult } from './projection.ts'

export type Insight = {
    text: string
    severity: 'notr' | 'dikkat'
    /** Yüksek olan üste çıkar. */
    priority: number
    /** Tıklanınca nereye gidileceği. */
    sourceId?: string
}

export type InsightTransaction = {
    id?: string
    amount: number | string
    type: string
    cash_date: string
    category_id?: string | null
    categoryName?: string | null
    source_type?: string | null
    account_id?: string | null
}

export type InsightAccount = {
    id: string
    name: string
    type?: string | null
    credit_limit?: number | string | null
}

export type InsightsInput = {
    upcoming: UpcomingResult
    projection: ProjectionResult
    transactions: InsightTransaction[]
    accounts: InsightAccount[]
    /** Hesaplanmış bakiyeler (lib/balance.ts). Kart borcu negatif değerdir. */
    balances?: Map<string, number>
    /** "Faiz & ücretler" kategorisinin id'si — faiz artış kuralı için. */
    interestCategoryId?: string
}

const MAX_INSIGHTS = 3

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(amount))} ₺`
}

function monthKeyOf(isoDate: string): string {
    return isoDate.slice(0, 7)
}

function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Kural 1 (en yüksek öncelik): projeksiyonda bakiye eksiye düşüyor
// ---------------------------------------------------------------------------

export function ruleNegativeBalance(projection: ProjectionResult): Insight | null {
    const negative = projection.months.find(m => m.isNegative)
    if (!negative) return null

    return {
        text: `${monthLocative(negative.month)} bakiye eksiye düşüyor.`,
        severity: 'dikkat',
        priority: 100,
        sourceId: negative.month,
    }
}

// ---------------------------------------------------------------------------
// Kural 2: önümüzdeki 12 ayda belirgin şekilde ağır bir ay var
// ---------------------------------------------------------------------------

export function ruleHeaviestMonth(upcoming: UpcomingResult): Insight | null {
    const heaviest = upcoming.heaviestMonth
    if (!heaviest) return null
    // Sadece gerçekten aykırı aylar konuşulur; en yüksek ay her zaman kayda değer değil.
    const month = upcoming.months.find(m => m.month === heaviest.month && m.isHeavy)
    if (!month) return null

    const coincide = (month.heavyReason || '').includes(' ve ')
    const text = coincide
        ? `${monthName(heaviest.month)} dar geçecek: ${heaviest.reason} aynı aya denk geliyor, ${formatTL(heaviest.total)} çıkacak.`
        : `${monthName(heaviest.month)} dar geçecek: ${heaviest.reason} nedeniyle ${formatTL(heaviest.total)} çıkacak.`

    return { text, severity: 'dikkat', priority: 90, sourceId: heaviest.month }
}

// ---------------------------------------------------------------------------
// Kural 3 ve 4: kategori artışı — işlem sayısı sabitse fiyat, arttıysa adet
// ---------------------------------------------------------------------------

type CategoryStat = { total: number; count: number }

function categoryStats(
    transactions: InsightTransaction[],
    month: string
): Map<string, CategoryStat> {
    const stats = new Map<string, CategoryStat>()
    for (const t of transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        // Abonelik/taksit kaynaklı harcamalar alışkanlık değil yükümlülüktür.
        if (t.source_type) continue
        if (monthKeyOf(t.cash_date) !== month) continue

        const label = t.categoryName || 'Kategorisiz'
        const current = stats.get(label) ?? { total: 0, count: 0 }
        current.total += Math.abs(toNumber(t.amount))
        current.count += 1
        stats.set(label, current)
    }
    return stats
}

const CATEGORY_GROWTH_THRESHOLD = 0.15

export function ruleCategoryGrowth(
    transactions: InsightTransaction[],
    currentMonth: string
): Insight | null {
    const now = categoryStats(transactions, currentMonth)
    const prev = categoryStats(transactions, shiftMonth(currentMonth, -1))

    let best: { label: string; growth: number; countDelta: number } | null = null

    for (const [label, current] of now) {
        const previous = prev.get(label)
        if (!previous || previous.total <= 0) continue

        const growth = (current.total - previous.total) / previous.total
        if (growth < CATEGORY_GROWTH_THRESHOLD) continue

        if (!best || growth > best.growth) {
            best = { label, growth, countDelta: current.count - previous.count }
        }
    }

    if (!best) return null

    const percent = Math.round(best.growth * 100)

    if (best.countDelta <= 0) {
        return {
            text: `${best.label} %${percent} arttı ama alışveriş sayısı aynı — fiyat farkı.`,
            severity: 'dikkat',
            priority: 70,
            sourceId: best.label,
        }
    }

    return {
        text: `${best.label} kategorisinde bu ay ${best.countDelta} harcama daha yaptınız.`,
        severity: 'notr',
        priority: 60,
        sourceId: best.label,
    }
}

// ---------------------------------------------------------------------------
// Kural 5: gelecek ayın kart yükü bu aydan belirgin fazla
// ---------------------------------------------------------------------------

const CARD_LOAD_THRESHOLD = 0.20

export function ruleCardLoadJump(
    transactions: InsightTransaction[],
    accounts: InsightAccount[],
    currentMonth: string
): Insight | null {
    const cardIds = new Set(
        accounts.filter(a => a.type === 'credit_card').map(a => a.id)
    )
    if (cardIds.size === 0) return null

    const nextMonth = shiftMonth(currentMonth, 1)

    const cardLoad = (month: string) => {
        let total = 0
        let installment = 0
        for (const t of transactions) {
            if (t.type !== 'expense' || !t.cash_date) continue
            if (!t.account_id || !cardIds.has(t.account_id)) continue
            if (monthKeyOf(t.cash_date) !== month) continue

            const amount = Math.abs(toNumber(t.amount))
            total += amount
            if (t.source_type === 'installment') installment += amount
        }
        return { total, installment }
    }

    const thisMonth = cardLoad(currentMonth)
    const next = cardLoad(nextMonth)

    if (thisMonth.total <= 0 || next.total <= 0) return null
    if ((next.total - thisMonth.total) / thisMonth.total < CARD_LOAD_THRESHOLD) return null

    const text = next.installment > 0
        ? `${monthLocative(nextMonth)} kartlardan ${formatTL(next.total)} çıkacak, bunun ${formatTL(next.installment)}'si zaten harcanmış taksitler.`
        : `${monthLocative(nextMonth)} kartlardan ${formatTL(next.total)} çıkacak.`

    return { text, severity: 'dikkat', priority: 80, sourceId: nextMonth }
}

// ---------------------------------------------------------------------------
// Kural 6: bir taksit yükü yakında kalkıyor
// ---------------------------------------------------------------------------

export function ruleRelief(upcoming: UpcomingResult): Insight | null {
    const first = upcoming.relievingMonths[0]
    if (!first) return null

    return {
        text: `${monthLocative(first.month)} ${formatTL(first.monthlyRelief)}'lik taksit yükü kalkıyor.`,
        severity: 'notr',
        priority: 50,
        sourceId: first.month,
    }
}

// ---------------------------------------------------------------------------
// Kural 7: kart limitinin %40'ı aşıldı
// ---------------------------------------------------------------------------

const CARD_USAGE_THRESHOLD = 0.40

export function ruleCardUsage(
    accounts: InsightAccount[],
    balances: Map<string, number>,
    /** Kart limit uyarı eşiği (0-1). Tercihlerden gelmezse mevcut sabit %40. */
    threshold: number = CARD_USAGE_THRESHOLD
): Insight | null {
    let worst: { name: string; id: string; ratio: number } | null = null

    for (const account of accounts) {
        if (account.type !== 'credit_card') continue
        const limit = toNumber(account.credit_limit)
        if (limit <= 0) continue

        // Kart bakiyesi borçluyken negatiftir.
        const debt = Math.max(0, -(balances.get(account.id) ?? 0))
        const ratio = debt / limit
        if (ratio <= threshold) continue

        if (!worst || ratio > worst.ratio) {
            worst = { name: account.name, id: account.id, ratio }
        }
    }

    if (!worst) return null

    return {
        text: `${worst.name} limitinin %${Math.round(worst.ratio * 100)}'ini kullandınız.`,
        severity: 'dikkat',
        priority: 40,
        sourceId: worst.id,
    }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Kural: bu ay faiz ödemesi arttı — asgari ödeme tuzağının erken sinyali (yüksek öncelik)
// ---------------------------------------------------------------------------

export function ruleInterestIncrease(
    transactions: InsightTransaction[],
    currentMonth: string,
    interestCategoryId?: string
): Insight | null {
    if (!interestCategoryId) return null
    const sumFor = (month: string) => transactions.reduce((s, t) => {
        if (t.type !== 'expense' || !t.cash_date) return s
        if (t.category_id !== interestCategoryId) return s
        if (monthKeyOf(t.cash_date) !== month) return s
        return s + Math.abs(toNumber(t.amount))
    }, 0)
    const now = sumFor(currentMonth)
    if (now <= 0) return null
    const prev = sumFor(shiftMonth(currentMonth, -1))
    if (prev > 0 && now - prev >= 50) {
        return { text: `Bu ay faize ${formatTL(now)} ödedin — geçen ay ${formatTL(prev)} idi.`, severity: 'dikkat', priority: 95 }
    }
    if (prev <= 0) {
        return { text: `Bu ay faize ${formatTL(now)} ödedin.`, severity: 'dikkat', priority: 92 }
    }
    return null
}

export function buildInsights(
    input: InsightsInput,
    options: { currentMonth?: string; cardUsageThreshold?: number } = {}
): Insight[] {
    const now = new Date()
    const currentMonth =
        options.currentMonth ??
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const candidates = [
        ruleNegativeBalance(input.projection),
        ruleInterestIncrease(input.transactions, currentMonth, input.interestCategoryId),
        ruleHeaviestMonth(input.upcoming),
        ruleCardLoadJump(input.transactions, input.accounts, currentMonth),
        ruleCategoryGrowth(input.transactions, currentMonth),
        ruleRelief(input.upcoming),
        ruleCardUsage(input.accounts, input.balances ?? new Map(), options.cardUsageThreshold),
    ].filter((i): i is Insight => i !== null)

    // Söyleyecek bir şey yoksa sessiz kal; olumlu cümle uydurma.
    return candidates
        .sort((a, b) => b.priority - a.priority)
        .slice(0, MAX_INSIGHTS)
}
