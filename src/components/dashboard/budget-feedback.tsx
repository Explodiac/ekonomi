import { checkBudget, evaluateBudget, type BudgetCategory, type BudgetTransaction } from "@/lib/budget"
import { getBudgetPeriod, type BudgetPeriodInput } from "@/lib/budget-rollover"
import { projectMonthEnd, type EstimateTransaction } from "@/lib/estimate"
import { today } from "@/lib/balance"

function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(amount))} ₺`
}

/**
 * Bir harcama kaydından sonra o kategori için satır içi geri bildirim.
 * Fren BİLGİLENDİRİR, engellemez. İki bilgi:
 *   - Bütçe durumu (limit varsa): %80 bilgi, %100 dikkat tonu
 *   - Ay içi ayna (3 ay verisi varsa): bu gidişle ay sonu izdüşümü
 * İkisi de sessizse hiç render edilmez.
 *
 * Renk değil değer: "dikkat" tonu sadece koyulukla (--ink), kırmızı alarmla değil.
 */
export function BudgetFeedback({
    categoryId,
    categories,
    transactions,
    month,
    budgetPeriods,
    negativeCarry = true,
    budgetInfoThreshold,
}: {
    categoryId: string
    categories: BudgetCategory[]
    transactions: (BudgetTransaction & EstimateTransaction)[]
    month: string
    /** Verilirse fren devir DAHİL gerçek sınıra (available) karşı kontrol eder. */
    budgetPeriods?: BudgetPeriodInput[]
    negativeCarry?: boolean
    /** Bütçe 'bilgi' uyarı eşiği (0-1). Tercihlerden gelmezse mevcut sabit %80. */
    budgetInfoThreshold?: number
}) {
    // Devir verisi varsa gerçek sınır = available (budgeted + devir); yoksa tek-ay limiti.
    let budget = null
    if (budgetPeriods) {
        const r = getBudgetPeriod(categoryId, month, budgetPeriods, transactions, { currentMonth: month, asOf: today(), negativeCarry })
        const cat = categories.find(c => c.id === categoryId)
        budget = r ? evaluateBudget(categoryId, cat?.name ?? 'Kategori', r.spent, r.available, budgetInfoThreshold) : null
    } else {
        budget = checkBudget(categoryId, month, categories, transactions, budgetInfoThreshold)
    }
    const mirror = projectMonthEnd(transactions, categoryId, month, today())

    if (!budget && !mirror) return null

    return (
        <div
            className="mt-[var(--s2)] px-[var(--s4)] py-[var(--s3)]"
            style={{ background: 'var(--surface)', borderRadius: 'var(--r-button)' }}
        >
            {budget && (
                <p
                    style={{
                        fontSize: 13.5,
                        lineHeight: 1.4,
                        // Aşımda koyu (--ink), yaklaşımda ikincil (--ink-2). Kırmızı yok.
                        color: budget.level === 'dikkat' ? 'var(--ink)' : 'var(--ink-2)',
                        fontWeight: budget.level === 'dikkat' ? 600 : 400,
                    }}
                >
                    {budget.text}
                </p>
            )}
            {mirror && (
                <p
                    className="tnum"
                    style={{
                        fontSize: 13,
                        lineHeight: 1.4,
                        color: 'var(--ink-3)',
                        marginTop: budget ? 4 : 0,
                    }}
                >
                    {mirror.label} bu ay {formatTL(mirror.soFar)}, bu gidişle ~{formatTL(mirror.projected)}
                    {' '}· {mirror.basisMonths} ay ortalaman {formatTL(mirror.average)}
                </p>
            )}
        </div>
    )
}
