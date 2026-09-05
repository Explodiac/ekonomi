'use client'

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, ShieldCheck, Target, ArrowUpRight, ShoppingBag } from "lucide-react"
import { buildPurchasePlan } from "@/lib/purchase-plan"
import { computePendingInterest, computeInterest } from "@/lib/interest"
import { computePurchasePlanContext } from "@/lib/purchase-plan-data"
import { deriveAccountBalances, today } from "@/lib/balance"
import { buildUpcoming, monthName, monthLocative, type UpcomingResult, type UpcomingItem } from "@/lib/upcoming"
import { NetWorthSummary } from "@/components/varlik/net-worth-summary"
import { buildProjection, type ProjectionResult } from "@/lib/projection"
import { buildInsights, type Insight } from "@/lib/insights"
import { buildFlow, type FlowPeriod } from "@/lib/flow"
import { computeBudgetTree, type BudgetTreeNode } from "@/lib/budget-rollover"
import { computePace, paceSeries, type PacePoint } from "@/lib/pace"
import { computeRunway } from "@/lib/runway"
import { computeGoalProgress } from "@/lib/goal-progress"
import { fetchSettings, type AppSettings } from "@/lib/settings"
import { CategoryTile, CategoryPill } from "@/components/dashboard/category-tile"
import { AccountIcon, shortAccount } from "@/components/dashboard/account-icon"
import { DeltaChip } from "@/components/ui/delta-chip"
import { QuickEntry } from "@/components/dashboard/quick-entry"

/** Kuruş gösterilmez. */
function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(amount)))} ₺`
}

function monthKeyOf(iso: string) { return iso.slice(0, 7) }
function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type Row = {
    id: string
    amount: number
    type: string
    cash_date: string
    description?: string | null
    categoryName?: string | null
    category_id?: string | null
    source_type?: string | null
    source_id?: string | null
    account_id: string | null
    transfer_direction?: string | null
}

type Goal = {
    id: string; name: string; target_amount: number; saved_tl: number
    is_fiat: boolean; created_at?: string | null; monthly_alloc?: number | null
    status?: 'aktif' | 'hazir' | 'arsiv'
    source_account_id?: string | null
    deadline?: string | null
}

/** Bütçe ağacı düğümü + görsel alanlar (isim, doluluk oranı). */
type NamedBudgetNode = Omit<BudgetTreeNode, 'children'> & { name: string; ratio: number; children?: NamedBudgetNode[] }

export default function DashboardPage() {
    const [isLoading, setIsLoading] = useState(true)
    const [accounts, setAccounts] = useState<any[]>([])
    const [transactions, setTransactions] = useState<Row[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [balances, setBalances] = useState<Map<string, number>>(new Map())
    const [projection, setProjection] = useState<ProjectionResult | null>(null)
    const [upcoming, setUpcoming] = useState<UpcomingResult | null>(null)
    const [insights, setInsights] = useState<Insight[]>([])
    const [budgetPeriods, setBudgetPeriods] = useState<{ categoryId: string; period: string; budgeted: number }[]>([])
    const [negativeCarry, setNegativeCarry] = useState(true)
    const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
    const [goals, setGoals] = useState<Goal[]>([])
    // Planlı alımlar — "Sıradaki alım" satırı için (yalnız status='planli' çekilir).
    const [purchasePlans, setPurchasePlans] = useState<any[]>([])
    // Cevaplanmış/atlanmış faiz dönemleri (dismissed_recurring 'faiz:...').
    const [dismissedFaiz, setDismissedFaiz] = useState<string[]>([])
    const [interestModalOpen, setInterestModalOpen] = useState(false)
    const [hhIdState, setHhIdState] = useState<string | null>(null)
    // Ham hedef katkıları (goal_contributions). Runway ve Hedefler bloğu tek kaynaktan.
    const [goalContribs, setGoalContribs] = useState<{ goal_id: string; period: string; amount: number }[]>([])
    // Taksit bitişini hedefe yönlendirme akışı (1b-4). Açıksa hangi kalkan yük.
    const [reliefModal, setReliefModal] = useState<{ month: string; monthlyRelief: number } | null>(null)

    const fetchData = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return

            const [accRes, txRes, subRes, instRes, contractRes, catRes, bpRes, hhRes, goalRes, goalContribRes, planRes, dismRes] = await Promise.all([
                supabase.from('accounts')
                    .select('id, name, type, balance, opening_balance, credit_limit, interest_rate, cut_date')
                    .eq('household_id', hhId),
                supabase.from('transactions')
                    .select('id, account_id, category_id, amount, type, cash_date, description, source_type, spend_nature, source_id, transfer_direction, categories(name)')
                    .eq('household_id', hhId),
                supabase.from('subscriptions')
                    .select('id, name, amount, frequency, next_payment_date, status')
                    .eq('household_id', hhId),
                supabase.from('installments')
                    .select('id, description, kind, installment_payments(id, payment_date, amount)')
                    .eq('household_id', hhId),
                supabase.from('contracts')
                    .select('id, name, contract_payments(id, amount, expected_date, status)')
                    .eq('household_id', hhId),
                supabase.from('categories')
                    .select('id, name, budget_limit, type, parent_id, default_nature, is_base_income')
                    .eq('household_id', hhId),
                supabase.from('budget_periods')
                    .select('category_id, period, budgeted')
                    .eq('household_id', hhId),
                supabase.from('households')
                    .select('negative_carry').eq('id', hhId).single(),
                supabase.from('goals')
                    .select('id, name, target_amount, saved_tl, is_fiat, created_at, monthly_alloc, status, source_account_id, deadline')
                    .eq('household_id', hhId),
                supabase.from('goal_contributions')
                    .select('goal_id, period, amount')
                    .eq('household_id', hhId),
                supabase.from('purchase_plans')
                    .select('id, name, amount, priority, payment_plan, installment_count, desired_by, category_id, status')
                    .eq('household_id', hhId).eq('status', 'planli'),
                supabase.from('dismissed_recurring')
                    .select('fingerprint').eq('household_id', hhId).like('fingerprint', 'faiz:%'),
            ])

            const accountList = accRes.data || []
            const rows: Row[] = (txRes.data || []).map((t: any) => ({
                ...t,
                categoryName: t.categories?.name ?? null,
            }))
            const installmentList = (instRes.data || []).map((i: any) => ({
                ...i,
                payments: i.installment_payments || [],
            }))
            const contractPayments = (contractRes.data || []).flatMap((c: any) =>
                (c.contract_payments || [])
                    .filter((p: any) => p.status === 'pending')
                    .map((p: any) => ({ ...p, contract_id: c.id, contractName: c.name }))
            )

            const derived = deriveAccountBalances(accountList, rows)

            const projectionResult = buildProjection({
                accounts: accountList,
                transactions: rows,
                subscriptions: subRes.data || [],
                installments: installmentList,
                contractPayments,
                goalAllocations: (goalRes.data || []).map((g: any) => ({ name: g.name, monthlyAlloc: g.monthly_alloc, status: g.status })),
            })

            const upcomingResult = buildUpcoming({
                transactions: rows,
                subscriptions: subRes.data || [],
                installments: installmentList,
            })

            setAccounts(accountList)
            setTransactions(rows)
            setCategories(catRes.data || [])
            setBudgetPeriods((bpRes.data || []).map((b: any) => ({ categoryId: b.category_id, period: b.period, budgeted: Number(b.budgeted) })))
            setNegativeCarry(hhRes.data?.negative_carry ?? true)
            setGoals((goalRes.data || []) as Goal[])
            setGoalContribs((goalContribRes.data || []).map((c: any) => ({ goal_id: c.goal_id, period: c.period, amount: Number(c.amount) })))
            setPurchasePlans(planRes.data || [])
            setDismissedFaiz((dismRes.data || []).map((d: any) => d.fingerprint))
            setHhIdState(hhId)
            setBalances(derived)
            setProjection(projectionResult)
            setUpcoming(upcomingResult)
            // Tercihler: eşikler settings'ten; satır yoksa lib'lerin kendi sabitine düşer.
            const settings = await fetchSettings(supabase, hhId)
            setAppSettings(settings)
            setInsights(buildInsights({
                upcoming: upcomingResult,
                projection: projectionResult,
                transactions: rows,
                accounts: accountList,
                balances: derived,
            }, { cardUsageThreshold: settings ? settings.cardAlertPct / 100 : undefined }))
        } catch (error) {
            console.error("Dashboard verisi alınamadı:", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => { fetchData() }, [])

    const currentMonthKey = today().slice(0, 7)

    // --- 1) Bu ayki akış: flow.ts (transfer hariç inflow/outflow/net) ---
    const flowCurrent = useMemo(() => {
        const periods = buildFlow(transactions as any, { granularity: 'month', asOf: today() })
        return periods.find(p => p.isCurrent) ?? periods[periods.length - 1] ?? null
    }, [transactions])

    // Bir önceki ayın net'i — "Bu ay net" bloğundaki önceki-aya-göre delta için.
    const flowPrevNet = useMemo<number | null>(() => {
        const periods = buildFlow(transactions as any, { granularity: 'month', asOf: today() })
        const idx = periods.findIndex(p => p.isCurrent)
        const prev = idx > 0 ? periods[idx - 1] : null
        return prev ? prev.net : null
    }, [transactions])

    // --- 2) Bütçe durumu: hiyerarşik ağaç (parent grupları + devir dahil available) ---
    const budgetTree = useMemo<NamedBudgetNode[]>(() => {
        const nodes = computeBudgetTree({
            categories: categories.map((c: any) => ({ id: c.id, parent_id: c.parent_id })),
            periods: budgetPeriods.map(b => ({ categoryId: b.categoryId, period: b.period, budgeted: b.budgeted })),
            transactions: transactions as any,
            currentMonth: currentMonthKey,
            asOf: today(),
            negativeCarry,
        })
        const nameById = new Map(categories.map((c: any) => [c.id, c.name]))
        const named = (n: BudgetTreeNode): NamedBudgetNode => ({
            ...n,
            name: (nameById.get(n.categoryId) as string) ?? 'Kategori',
            ratio: n.available > 0 ? n.spent / n.available : (n.spent > 0 ? 1 : 0),
            children: n.children?.map(named),
        })
        return nodes
            .filter(n => n.available > 0 || n.spent > 0)
            .map(named)
            .sort((a, b) => b.ratio - a.ratio)
    }, [budgetPeriods, transactions, categories, currentMonthKey, negativeCarry])

    // --- 4) Runway + hedef ---
    // Gerçek biriken = saved_tl (başlangıç) + katkılar. Kaynak hesap likitse serbest
    // süreden düşülür, değilse "hedefler dahil"e eklenir (runway.ts çift saymayı önler).
    const contribByGoal = useMemo(() => {
        const m = new Map<string, number>()
        for (const c of goalContribs) m.set(c.goal_id, (m.get(c.goal_id) ?? 0) + Number(c.amount))
        return m
    }, [goalContribs])

    const runway = useMemo(() => {
        return computeRunway({
            accounts, balances, transactions: transactions as any, asOf: today(),
            goals: goals
                .filter(g => g.status !== 'arsiv')
                .map(g => ({ saved: Number(g.saved_tl || 0) + (contribByGoal.get(g.id) ?? 0), sourceAccountId: g.source_account_id ?? null })),
        })
    }, [accounts, balances, transactions, goals, contribByGoal])

    // Sıradaki alım — planlı alımların önerilen aya göre en yakını. Motor burada da
    // koşar ama girdiler mevcut projection/upcoming'den gelir (ek ağır hesap yok);
    // tek ek sorgu purchase_plans. Planlı alım yoksa null → satır hiç görünmez.
    const nextPurchase = useMemo(() => {
        if (!projection || !upcoming || purchasePlans.length === 0) return null
        const ctx = computePurchasePlanContext({
            projection, upcoming, transactions: transactions as any,
            goals: goals as any, currentMonth: currentMonthKey,
            baseIncomeCategoryIds: (categories as any[]).filter(c => c.type === 'income' && c.is_base_income).map(c => c.id),
        })
        const plan = buildPurchasePlan({
            from: currentMonthKey, months: 24, monthlyRoom: ctx.monthlyRoomBase,
            reliefs: ctx.reliefs, loads: ctx.loads,
            plans: purchasePlans.map((p: any) => ({
                id: p.id, name: p.name, amount: Number(p.amount), priority: p.priority,
                paymentPlan: p.payment_plan, installmentCount: p.installment_count,
                desiredBy: p.desired_by, categoryId: p.category_id, status: 'planli' as const,
            })),
        })
        const placed = plan.scheduled.filter(s => s.recommendedMonth)
        if (!placed.length) return null
        const next = placed.reduce((a, b) => (a.recommendedMonth! <= b.recommendedMonth! ? a : b))
        return { name: next.name, month: next.recommendedMonth! }
    }, [projection, upcoming, transactions, goals, purchasePlans, currentMonthKey, categories])

    // Dönem sonu faiz onayı — türetilmiş bakiye + hesap oranından (interest.ts).
    const pendingInterest = useMemo(() => computePendingInterest({
        accounts: (accounts as any[]).map(a => ({
            id: a.id, name: a.name, type: a.type,
            balance: balances.get(a.id) ?? a.balance, interest_rate: a.interest_rate, cut_date: a.cut_date,
        })),
        answeredFingerprints: dismissedFaiz,
        today: today(),
    }), [accounts, balances, dismissedFaiz])

    // Dashboard faiz bloğu — ödenen faiz (source_type='faiz') + en kötü asgari senaryo.
    const faizData = useMemo(() => {
        const faizTx = (transactions as any[]).filter(t => t.source_type === 'faiz')
        const mapped = (accounts as any[]).map(a => ({
            id: a.id, name: a.name, type: a.type,
            balance: balances.get(a.id) ?? a.balance, interest_rate: a.interest_rate, credit_limit: a.credit_limit,
        }))
        const summary = computeInterest({ accounts: mapped, transactions: faizTx, today: today(), minPaymentPct: 20 })
        if (summary.paidThisYear <= 0) return null

        const cm = today().slice(0, 7)
        const pmD = new Date(Number(cm.slice(0, 4)), Number(cm.slice(5, 7)) - 2, 1)
        const lm = `${pmD.getFullYear()}-${String(pmD.getMonth() + 1).padStart(2, '0')}`
        let lastMonth = 0
        for (const t of faizTx) if (t.cash_date && t.cash_date.slice(0, 7) === lm) lastMonth += Math.abs(Number(t.amount))

        const byAccount = summary.paidByAccount.filter(p => p.paidThisYear > 0).sort((a, b) => b.paidThisYear - a.paidThisYear)

        // En kötü durum: en borçlu KART (asgari ödeme kart kavramı), kendi limit-tabanlı oranıyla.
        const worstAcc = mapped
            .filter(a => a.type === 'credit_card' && a.interest_rate && Math.max(0, -Number(a.balance)) > 0)
            .sort((a, b) => Math.max(0, -Number(b.balance)) - Math.max(0, -Number(a.balance)))[0]
        let worst: { name: string; scenario: { months: number | null; totalInterest: number | null } } | null = null
        if (worstAcc) {
            const limit = Number(worstAcc.credit_limit || 0)
            const minPct = limit > 0 && limit <= 25000 ? 20 : 40
            const w = computeInterest({ accounts: [worstAcc], transactions: [], today: today(), minPaymentPct: minPct })
            const sc = w.paidByAccount[0]?.minimumPaymentScenario
            if (sc) worst = { name: worstAcc.name, scenario: sc }
        }

        return { paidThisYear: summary.paidThisYear, thisMonth: summary.paidThisMonth, lastMonth: Math.round(lastMonth * 100) / 100, byAccount, worst }
    }, [transactions, accounts, balances])

    // Eyleme bağlı öneri: bir taksit bitiyor VE aktif hedef varsa.
    const reliefSuggestion = useMemo(() => {
        const relief = upcoming?.relievingMonths?.[0]
        const goal = goals
            .map(g => ({ g, remaining: Number(g.target_amount) - Number(g.saved_tl || 0) }))
            .filter(x => x.remaining > 0)
            .sort((a, b) => a.remaining - b.remaining)[0]?.g
        if (!relief || !goal) return null
        return { relief, goalName: goal.name }
    }, [upcoming, goals])

    const recent = useMemo(
        () => [...transactions]
            .filter(t => t.cash_date && t.cash_date <= today() && t.type !== 'transfer')
            .sort((a, b) => b.cash_date.localeCompare(a.cash_date))
            .slice(0, 8),
        [transactions]
    )

    // Hareket satırında hesap ikonu + kısa adı için.
    const accountById = useMemo(
        () => new Map(accounts.map((a: any) => [a.id, { name: a.name as string, type: a.type as string }])),
        [accounts]
    )

    // Bütçe toplamları (Bu ay harcama bloğu) — üst-seviye düğümler (parent grup
    // toplamı zaten çocukları kapsar, çift sayma yok).
    const budgetTotals = useMemo(() => {
        const available = budgetTree.reduce((s, r) => s + r.available, 0)
        const spent = budgetTree.reduce((s, r) => s + r.spent, 0)
        return { available, spent, kaldi: available - spent, hasBudget: budgetTree.length > 0 }
    }, [budgetTree])

    // Zaman eksenli tempo grafiği için günlük seri (SpendingCard). Kümülatif harcama
    // budgetTree ile AYNI evrenden (bütçeli üst-seviye + tüm alt kategorileri) toplanır
    // ki son nokta ≈ budgetTotals.spent olsun.
    const spendingSeries = useMemo<{ points: PacePoint[]; daysInMonth: number; dayOfMonth: number }>(() => {
        const now = new Date()
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        const dayOfMonth = now.getDate()

        // Bütçe evreni: her üst-seviye düğüm + parent'ı o olan tüm kategoriler (bütçesiz dahil).
        const budgeted = new Set<string>()
        for (const node of budgetTree) {
            budgeted.add(node.categoryId)
            for (const c of categories as any[]) {
                if (c.parent_id === node.categoryId) budgeted.add(c.id)
            }
        }

        const dailySpent = new Array(daysInMonth).fill(0)
        const asOf = today()
        for (const t of transactions) {
            if (t.type !== 'expense' || !t.cash_date) continue
            if (t.cash_date.slice(0, 7) !== currentMonthKey || t.cash_date > asOf) continue
            if (!t.category_id || !budgeted.has(t.category_id)) continue
            const day = Number(t.cash_date.slice(8, 10))
            if (day >= 1 && day <= daysInMonth) dailySpent[day - 1] += Math.abs(Number(t.amount))
        }

        const points = paceSeries({ available: budgetTotals.available, daysInMonth, dayOfMonth, dailySpent })
        return { points, daysInMonth, dayOfMonth }
    }, [budgetTree, categories, transactions, currentMonthKey, budgetTotals.available])

    // Önümüzdeki 14 gün (Yaklaşan'ın ilk 14 günü, en fazla 5 satır).
    const next14 = useMemo(() => {
        if (!upcoming) return []
        const from = today()
        const to = (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10) })()
        return upcoming.months
            .flatMap(m => m.items)
            .filter(it => it.date >= from && it.date <= to)
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, 5)
    }, [upcoming])

    // Hedef özeti (monthly_alloc, 0a).
    // Hedefler bloğu — TEK KAYNAK computeGoalProgress (Hedefler ekranıyla aynı).
    // Yalnız AKTİF hedefler. "Bu ay birikti" gerçekleşen katkılardan; kalan/ETA
    // her hedefin progress'inden. Birim TRY dışıysa o hedef kendi biriminde.
    const goalView = useMemo(() => {
        const asOf = today()
        const cm = asOf.slice(0, 7)
        const active = goals.filter(g => (g.status ?? 'aktif') === 'aktif')
        const plannedMonthly = active.reduce((s, g) => s + Number(g.monthly_alloc || 0), 0)
        const savedThisMonth = goalContribs
            .filter(c => c.period.slice(0, 7) === cm && active.some(g => g.id === c.goal_id))
            .reduce((s, c) => s + Number(c.amount), 0)

        let remainingTotal = 0
        let nearest: { name: string; etaText: string; unit: string } | null = null
        let nearestRemaining = Infinity
        for (const g of active) {
            const unit = g.is_fiat ? 'TRY' : (g as any).asset_unit || (g as any).asset_name || 'birim'
            const savedAmount = g.is_fiat ? Number(g.saved_tl || 0) : 0
            const cs = goalContribs.filter(c => c.goal_id === g.id)
                .map(c => ({ period: c.period, amount: c.amount, unitAmount: g.is_fiat ? c.amount : null }))
            const p = computeGoalProgress({
                goal: { targetAmount: g.target_amount, savedAmount, monthlyAlloc: g.monthly_alloc, targetDate: g.deadline, unit },
                contributions: cs, today: asOf,
            })
            remainingTotal += p.remaining
            if (p.remaining > 0 && p.etaText && p.remaining < nearestRemaining) {
                nearestRemaining = p.remaining
                nearest = { name: g.name, etaText: p.etaText, unit }
            }
        }
        return {
            savedThisMonth: Math.round(savedThisMonth), plannedMonthly: Math.round(plannedMonthly),
            remainingTotal: Math.round(remainingTotal), count: active.length, nearest,
        }
    }, [goals, goalContribs])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-32">
                <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} />
            </div>
        )
    }

    const daysElapsed = new Date().getDate()
    const hasData = accounts.length > 0 || transactions.length > 0

    return (
        <div className="w-full pb-10">
            <div className="mb-[var(--s4)] flex items-baseline justify-between">
                <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                    {monthName(currentMonthKey)}
                </h1>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>
                    {daysElapsed} gün geçti
                </span>
            </div>

            {!hasData ? (
                <StartingState />
            ) : (
                // İki kolon (masaüstü, bağımsız akış). Mobilde tek sütun: kolon
                // sarmalayıcıları `contents` ile düzleşir, `order-*` mobil sırayı verir.
                <div className="flex flex-col lg:flex-row gap-[var(--s3)]">
                    {/* SOL KOLON */}
                    <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-[var(--s3)]">
                        <div className="order-1 lg:order-none"><SpendingCard totals={budgetTotals} flow={flowCurrent} series={spendingSeries} /></div>
                        {(insights.length > 0 || reliefSuggestion || pendingInterest.length > 0) && (
                            <div className="order-3 lg:order-none">
                                <InsightsCard insights={insights} suggestion={reliefSuggestion} onRedirect={setReliefModal}
                                    interestPending={pendingInterest} onOpenInterest={() => setInterestModalOpen(true)} />
                            </div>
                        )}
                        <div className="order-8 lg:order-none"><RecentCard rows={recent} accountById={accountById} /></div>
                        <div className="order-5 lg:order-none"><NetCard flow={flowCurrent} prevNet={flowPrevNet} /></div>
                    </div>
                    {/* SAĞ KOLON */}
                    <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-[var(--s3)]">
                        <div className="order-6 lg:order-none"><NetWorthSummary /></div>
                        <div className="order-2 lg:order-none"><BudgetCard nodes={budgetTree} /></div>
                        {faizData && <div className="order-4 lg:order-none"><FaizCard data={faizData} /></div>}
                        {next14.length > 0 && (
                            <div className="order-4 lg:order-none"><Next14Card items={next14} /></div>
                        )}
                        {(goalView.count > 0 || runway.runwayFree !== null || nextPurchase) && (
                            <div className="order-7 lg:order-none"><GoalsCard view={goalView} runway={runway} nextPurchase={nextPurchase} /></div>
                        )}
                    </div>
                </div>
            )}

            <div className="mt-[var(--s4)]">
                <QuickEntry
                    accounts={accounts}
                    categories={categories}
                    transactions={transactions}
                    currentMonthKey={currentMonthKey}
                    onSuccess={fetchData}
                    budgetPeriods={budgetPeriods}
                    negativeCarry={negativeCarry}
                    budgetInfoThreshold={appSettings ? appSettings.budgetAlertPct / 100 : undefined}
                />
            </div>

            {reliefModal && (
                <ReliefRedirectModal
                    relief={reliefModal}
                    goals={goals}
                    onClose={() => setReliefModal(null)}
                    onDone={() => { setReliefModal(null); fetchData() }}
                />
            )}

            {interestModalOpen && hhIdState && (
                <FaizApprovalModal
                    pending={pendingInterest}
                    accounts={accounts}
                    hhId={hhIdState}
                    onClose={() => setInterestModalOpen(false)}
                    onDone={() => { setInterestModalOpen(false); fetchData() }}
                />
            )}
        </div>
    )
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <section className={className} style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
            {children}
        </section>
    )
}

/** ORTAK: kart başlığındaki ekran-bağlantısı. 11px uppercase, --ink-3, ↗, hover --accent. */
function CardLink({ href, label }: { href: string; label: string }) {
    return (
        <Link
            href={href}
            className="flex items-center gap-[2px] transition-colors hover:text-[var(--accent)]"
            style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}
        >
            {label}<ArrowUpRight className="h-[12px] w-[12px]" />
        </Link>
    )
}

/** ORTAK: blok başlığı — Copilot etiketi (11.5px uppercase) + opsiyonel CardLink. */
function CardHead({ title, href, link }: { title: string; href?: string; link?: string }) {
    return (
        <div className="flex items-baseline justify-between gap-[var(--s2)] mb-[var(--s2)]">
            <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{title}</span>
            {href && link && <CardLink href={href} label={link} />}
        </div>
    )
}

/** SOL 1 — Bu ay harcama (Copilot "Monthly spending"). Zaman eksenli tempo grafiği:
 *  X = ayın günleri, Y = birikmiş harcama. Gerçek çizgi (bütçe rampası renginde)
 *  ay 1'inden BUGÜNE; kesikli beklenen-hız çizgisi (--ink-4) ayı kapsar; bugünün
 *  noktası üstünde tempo etiketi. Bugünden sonrası çizilmez. */
function SpendingCard({ totals, flow, series }: {
    totals: { available: number; spent: number; kaldi: number; hasBudget: boolean }
    flow: FlowPeriod | null
    series: { points: PacePoint[]; daysInMonth: number; dayOfMonth: number }
}) {
    if (!totals.hasBudget) {
        const spent = flow?.outflow ?? 0
        return (
            <Card className="p-[22px]">
                <CardHead title="Bu ay harcama" href="/hareketler" link="Hareketler" />
                <div className="tnum" style={{ fontSize: 30, fontWeight: 600, color: 'var(--ink)' }}>{formatTL(spent)}</div>
                <p className="mt-[var(--s2)]" style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
                    Bu ay harcanan. <Link href="/settings" style={{ color: 'var(--accent)' }}>Bütçe tanımla</Link> → kalan takibi.
                </p>
            </Card>
        )
    }

    const { points, daysInMonth, dayOfMonth } = series
    const pace = computePace({ available: totals.available, spent: totals.spent, dayOfMonth, daysInMonth })
    // İlk 3 gün: tempo yorumu yok (kesikli çizgi + etiket + nokta gizli), sade çizgi.
    const active = totals.available > 0 && dayOfMonth > 3

    return (
        <Card className="p-[22px]">
            <CardHead title="Bu ay harcama" href="/hareketler" link="Hareketler" />
            {/* Hero: kalan + bütçe */}
            <div className="flex items-baseline gap-[var(--s2)]">
                <span className="tnum" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>{formatTL(totals.kaldi)}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>kaldı</span>
            </div>
            <div className="tnum mt-[2px]" style={{ fontSize: 13, color: 'var(--ink-3)' }}>{formatTL(totals.available)} bütçeden</div>

            <div className="mt-[var(--s4)]">
                <SpendingChart
                    points={points} daysInMonth={daysInMonth} dayOfMonth={dayOfMonth}
                    available={totals.available} pace={pace} active={active}
                />
            </div>
        </Card>
    )
}

/** Tempo rengi: o günkü kümülatif/beklenen oranına göre bütçe rampası.
 *  Altında yeşil, yaklaşınca sarı, aşınca turuncu→kırmızı. */
function paceColor(ratio: number): string {
    if (ratio >= 1.15) return 'var(--budget-over)'
    if (ratio >= 1.0) return 'var(--budget-near)'
    if (ratio >= 0.85) return 'var(--budget-mid)'
    return 'var(--budget-ok)'
}

/** Kümülatif harcama tempo grafiği (SVG). Çizgi rengi GÜN GÜN tempoya göre değişir
 *  (ne zaman öne geçtiği görünür). Genişlik esner; nokta ve etiket HTML overlay. */
function SpendingChart({ points, daysInMonth, dayOfMonth, available, pace, active }: {
    points: PacePoint[]
    daysInMonth: number
    dayOfMonth: number
    available: number
    pace: { diff: number; status: 'onde' | 'hizinda' | 'geride'; isOverPace: boolean }
    /** Ayın ilk 3 günü false → kesikli çizgi/nokta/etiket gizli, sade çizgi. */
    active: boolean
}) {
    const W = 300, H = 84, LABEL_H = 30

    // Y ölçeği: bütçe ile bugünkü birikimin büyüğü (aşımda kümülatif bütçeyi geçer).
    const realPts = points.filter(p => p.cumulative !== null) as { day: number; cumulative: number; expected: number }[]
    const maxCum = realPts.reduce((m, p) => Math.max(m, p.cumulative), 0)
    const maxY = Math.max(1, available, maxCum)

    const x = (day: number) => (day / daysInMonth) * W
    const y = (v: number) => H - (v / maxY) * H

    // Gün gün segmentler — her segment o günün kümülatif/beklenen oranıyla renkli.
    const segments: { x1: number; y1: number; x2: number; y2: number; color: string }[] = []
    let prev = { x: 0, y: H }
    for (const p of realPts) {
        const cur = { x: x(p.day), y: y(p.cumulative) }
        const r = p.expected > 0 ? p.cumulative / p.expected : 1
        segments.push({ x1: prev.x, y1: prev.y, x2: cur.x, y2: cur.y, color: paceColor(r) })
        prev = cur
    }

    // Beklenen kesikli: (0,0) → (son gün, available).
    const expEnd = { x: x(daysInMonth), y: y(available) }

    const todayPt = realPts.length ? realPts[realPts.length - 1] : null
    const todayRatio = todayPt && todayPt.expected > 0 ? todayPt.cumulative / todayPt.expected : 1
    const tempoColor = paceColor(todayRatio)
    const dotXpct = todayPt ? (x(todayPt.day) / W) * 100 : 0
    const dotYpx = todayPt ? y(todayPt.cumulative) : 0

    const labelText = pace.isOverPace ? `${formatTL(pace.diff)} önde` : `${formatTL(Math.abs(pace.diff))} geride`

    return (
        <div className="relative w-full" style={{ height: LABEL_H + H }}>
            <svg
                viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
                className="absolute inset-x-0 w-full" style={{ height: H, top: LABEL_H }}
                role="img" aria-label="Aylık harcama temposu"
            >
                {active && (
                    <line x1={0} y1={H} x2={expEnd.x} y2={expEnd.y}
                        stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
                )}
                {segments.map((s, i) => (
                    <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                        stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                ))}
            </svg>

            {/* Bugünün noktası — küçük dolu, tempo renginde, beyaz ince halka */}
            {active && todayPt && (
                <div
                    className="absolute rounded-full"
                    style={{ left: `${dotXpct}%`, top: LABEL_H + dotYpx, width: 8, height: 8, background: tempoColor, border: '1.5px solid #fff', transform: 'translate(-50%,-50%)' }}
                />
            )}

            {/* Tempo etiketi — konuşma balonu, tempo renginde, ok ucu noktaya değer */}
            {active && todayPt && pace.status !== 'hizinda' && (
                <div
                    className="absolute -translate-x-1/2 whitespace-nowrap px-[6px] py-[1px]"
                    style={{
                        left: `${dotXpct}%`, top: LABEL_H + dotYpx - 11, transform: 'translate(-50%,-100%)',
                        background: `color-mix(in srgb, ${tempoColor} 15%, transparent)`,
                        color: tempoColor, borderRadius: 'var(--r-pill)', fontSize: 11, fontWeight: 600,
                    }}
                >
                    <span className="tnum">{labelText}</span>
                    {/* Ok ucu — balonun alt-ortasında, noktaya doğru */}
                    <span className="absolute" style={{ left: '50%', bottom: -3, width: 7, height: 7, background: `color-mix(in srgb, ${tempoColor} 15%, transparent)`, transform: 'translateX(-50%) rotate(45deg)' }} aria-hidden />
                </div>
            )}
        </div>
    )
}

/** SOL 4 — Bu ay net. Net + önceki-aya-göre delta çipi + gelir/gider. */
function NetCard({ flow, prevNet }: { flow: FlowPeriod | null; prevNet: number | null }) {
    const inflow = flow?.inflow ?? 0
    const outflow = flow?.outflow ?? 0
    const net = flow?.net ?? (inflow - outflow)
    const pct = inflow > 0 ? Math.min(100, (outflow / inflow) * 100) : (outflow > 0 ? 100 : 0)
    return (
        <Card className="p-[22px]">
            <CardHead title="Bu ay net" href="/akis" link="Akış" />
            <div className="flex flex-wrap items-baseline gap-x-[var(--s3)] gap-y-[2px]">
                <span className="tnum" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                    {net >= 0 ? '+' : '−'}{formatTL(net)}
                </span>
                {prevNet !== null && <DeltaChip value={net - prevNet} context="önceki aya göre" />}
            </div>
            <div className="mt-[var(--s4)] h-[6px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                <div className="h-full" style={{ width: `${pct}%`, background: 'var(--ink-4)', borderRadius: 'var(--r-bar)' }} />
            </div>
            <div className="mt-[var(--s3)] flex items-baseline justify-between">
                <span className="tnum" style={{ fontSize: 14, fontWeight: 600, color: 'var(--flow-in)' }}>+{formatTL(inflow)} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>gelir</span></span>
                <span className="tnum" style={{ fontSize: 14, fontWeight: 600, color: 'var(--flow-out)' }}>−{formatTL(outflow)} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>gider</span></span>
            </div>
        </Card>
    )
}

/** SAĞ 3 — Önümüzdeki 14 gün. Yaklaşan'ın ilk 14 günü, en fazla 5 satır. */
/** Faiz kartı — bu yıl ödenen faiz, aylık delta, hesap kırılımı, en kötü asgari senaryo. */
function FaizCard({ data }: { data: {
    paidThisYear: number; thisMonth: number; lastMonth: number
    byAccount: { accountId: string; name: string | null; paidThisYear: number }[]
    worst: { name: string; scenario: { months: number | null; totalInterest: number | null } } | null
} }) {
    const delta = data.thisMonth - data.lastMonth // artış = daha çok faiz = kötü
    return (
        <Card className="px-[22px] py-[var(--s4)]">
            <CardHead title="Faiz" href="/varlik" link="Tümü" />
            <div className="tnum" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{formatTL(data.paidThisYear)}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>bu yıl ödenen faiz</div>
            <div className="mt-[var(--s2)] flex items-center gap-[var(--s2)]">
                <span className="tnum" style={{ fontSize: 13, color: 'var(--ink-2)' }}>bu ay {formatTL(data.thisMonth)}</span>
                <DeltaChip value={-delta} directionValue={delta} context="geçen aya göre" />
            </div>

            {data.byAccount.length > 0 && (
                <ul className="mt-[var(--s4)] flex flex-col gap-[var(--s2)]">
                    {data.byAccount.map(p => (
                        <li key={p.accountId}>
                            <Link href={`/varlik?hesap=${p.accountId}`} className="flex items-center justify-between transition-opacity hover:opacity-80">
                                <span className="truncate" style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{p.name ?? 'Hesap'}</span>
                                <span className="tnum shrink-0" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{formatTL(p.paidThisYear)}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {data.worst && (data.worst.scenario.months == null ? (
                <div className="mt-[var(--s4)] p-[var(--s3)]" style={{ background: 'color-mix(in srgb, var(--flow-out) 12%, transparent)', borderRadius: 'var(--r-button)', border: '1px solid color-mix(in srgb, var(--flow-out) 30%, transparent)' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5, color: 'var(--flow-out)' }}>
                        Asgari ödeme {data.worst.name}&apos;in faizini karşılamıyor — borç asgariyle ödenmez, her ay büyür.
                    </p>
                </div>
            ) : (
                <p className="mt-[var(--s4)] pt-[var(--s3)]" style={{ borderTop: '1px solid var(--border)', fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                    <b style={{ color: 'var(--ink)' }}>{data.worst.name}</b>&apos;ta asgari ödersen borç <b className="tnum">{data.worst.scenario.months} ayda</b> kapanır,{' '}
                    <b className="tnum" style={{ color: 'var(--flow-out)' }}>{formatTL(data.worst.scenario.totalInterest ?? 0)}</b> faiz ödersin.
                </p>
            ))}
        </Card>
    )
}

function Next14Card({ items }: { items: UpcomingItem[] }) {
    return (
        <Card className="p-[22px]">
            <CardHead title="Önümüzdeki 14 gün" href="/yaklasan" link="Yaklaşan" />
            <ul className="flex flex-col gap-[var(--s3)]">
                {items.map((it, i) => {
                    const [, mo, dd] = it.date.split('-').map(Number)
                    return (
                        <li key={`${it.date}-${i}`} className="flex items-center justify-between gap-[var(--s3)]">
                            <span className="min-w-0 flex-1 truncate" style={{ fontSize: 14, color: 'var(--ink)' }}>
                                <span className="tnum" style={{ color: 'var(--ink-3)' }}>{dd} {TR_AYLAR[mo - 1].slice(0, 3)}</span>{'  '}{it.label}
                            </span>
                            <span className="tnum shrink-0" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{formatTL(it.amount)}</span>
                        </li>
                    )
                })}
            </ul>
        </Card>
    )
}

/** SAĞ 4 — Hedefler. computeGoalProgress ile (Hedefler ekranıyla tek kaynak):
 *  bu ay gerçekleşen katkı + toplam kalan + ilerleme + dayanma + en yakın ETA. */
function GoalsCard({ view, runway, nextPurchase }: {
    view: {
        savedThisMonth: number; plannedMonthly: number; remainingTotal: number; count: number
        nearest: { name: string; etaText: string; unit: string } | null
    }
    runway: { runwayFree: number | null; runwayWithGoals: number | null }
    nextPurchase: { name: string; month: string } | null
}) {
    const pct = view.plannedMonthly > 0 ? Math.min(100, (view.savedThisMonth / view.plannedMonthly) * 100) : 0
    const bothDiffer = runway.runwayFree !== null && runway.runwayWithGoals !== null && runway.runwayWithGoals !== runway.runwayFree
    const nextMonthText = nextPurchase
        ? monthName(nextPurchase.month) + (nextPurchase.month.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${nextPurchase.month.slice(0, 4)}` : '')
        : null
    return (
        <Card className="p-[22px]">
            <CardHead title="Hedefler" href="/hedefler" link="Tüm hedefler" />
            {view.count > 0 && (
                <>
                    <div className="tnum" style={{ fontSize: 14.5, color: 'var(--ink)' }}>
                        Bu ay {formatTL(view.savedThisMonth)} birikti · hedefe {formatTL(view.remainingTotal)} kaldı
                    </div>
                    <div className="mt-[var(--s3)] h-[6px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                        <div className="h-full" style={{ width: `${pct}%`, background: 'var(--accent)', borderRadius: 'var(--r-bar)' }} />
                    </div>
                </>
            )}
            <div className="mt-[var(--s4)] flex flex-col gap-[var(--s2)]">
                {runway.runwayFree !== null && (
                    <div className="flex items-center gap-[var(--s3)]">
                        <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: 'var(--ink-3)' }} />
                        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                            Gelir kesilse:{' '}
                            <span className="tnum" style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmtAy(runway.runwayFree)} ay serbest</span>
                            {bothDiffer && <span className="tnum" style={{ color: 'var(--ink-3)' }}> · {fmtAy(runway.runwayWithGoals!)} ay hedefler dahil</span>}
                        </span>
                    </div>
                )}
                {view.nearest && (
                    <div className="flex items-center gap-[var(--s3)]">
                        <Target className="h-4 w-4 shrink-0" style={{ color: 'var(--ink-3)' }} />
                        <span className="truncate" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                            {view.nearest.name}: <span style={{ color: 'var(--ink)', fontWeight: 500 }}>bu hızla {view.nearest.etaText}</span>
                        </span>
                    </div>
                )}
                {nextPurchase && (
                    <Link href="/alim-listesi" className="flex items-center gap-[var(--s3)] transition-opacity hover:opacity-80">
                        <ShoppingBag className="h-4 w-4 shrink-0" style={{ color: 'var(--ink-3)' }} />
                        <span className="truncate" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                            Sıradaki alım: <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{nextPurchase.name} · {nextMonthText}</span>
                        </span>
                    </Link>
                )}
            </div>
        </Card>
    )
}

/** Bar rengi: bütçe doluluk rampası (rol 3). Yalnız bütçe barında kullanılır.
 *  %0-60 ok · %60-85 mid · %85-100 near · %100+ over. */
function budgetBarColor(ratio: number): string {
    if (ratio >= 1) return 'var(--budget-over)'
    if (ratio >= 0.85) return 'var(--budget-near)'
    if (ratio >= 0.6) return 'var(--budget-mid)'
    return 'var(--budget-ok)'
}

/** TEK SATIR bütçe satırı (Copilot): [ikon] Ad [alt-sayı rozeti] — harcanan —
 *  [ince sabit bar] — bütçe. Ad tıklanınca kategori detayına gider; parent'ta ok
 *  ayrı düğme → alt kategorileri girintili açar. */
function BudgetRow({ node, depth = 0, expanded, onToggle }: {
    node: NamedBudgetNode
    depth?: number
    expanded?: boolean
    onToggle?: () => void
}) {
    const pct = Math.min(100, node.ratio * 100)
    const hasChildren = !!node.children && node.children.length > 0
    const isChild = depth > 0
    return (
        <div className="flex w-full items-center gap-[var(--s3)]" style={{ paddingLeft: isChild ? 32 : 0 }}>
            {!isChild && <CategoryTile name={node.name} size={24} />}
            {/* Ad + (parent) alt-sayı rozeti — kategori detayına link */}
            <Link href={`/kategoriler?kategori=${node.categoryId}`} className="flex min-w-0 flex-1 items-center gap-[var(--s2)] transition-opacity hover:opacity-80">
                <span className="truncate" style={{ fontSize: isChild ? 13.5 : 14, color: isChild ? 'var(--ink-2)' : 'var(--ink)' }}>{node.name}</span>
                {hasChildren && (
                    <span className="tnum shrink-0" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', background: 'var(--fill-track)', borderRadius: 999, padding: '1px 6px' }}>
                        {node.children!.length}
                    </span>
                )}
            </Link>
            {hasChildren && (
                <button type="button" onClick={onToggle} aria-label={expanded ? 'Daralt' : 'Genişlet'} className="shrink-0 px-[2px]" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    {expanded ? '▾' : '▸'}
                </button>
            )}
            {/* Harcanan — ince sabit bar — bütçe, hepsi yan yana sabit kolonlar */}
            <span className="tnum shrink-0 text-right" style={{ fontSize: 13, color: 'var(--ink)', minWidth: 54 }}>{formatTL(node.spent)}</span>
            <span className="inline-block h-[4px] shrink-0 overflow-hidden" style={{ width: 56, background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                <span className="block h-full" style={{ width: `${pct}%`, background: budgetBarColor(node.ratio), borderRadius: 'var(--r-bar)' }} />
            </span>
            <span className="tnum shrink-0 text-right" style={{ fontSize: 13, color: 'var(--ink-3)', minWidth: 54 }}>{formatTL(node.available)}</span>
        </div>
    )
}

/** SAĞ 2 — Kategoriler (hiyerarşik bütçe, devir dahil). Parent satırı grup toplamı,
 *  tıklanınca alt kategoriler açılır. Bar rengi bütçe doluluk rampası. */
function BudgetCard({ nodes }: { nodes: NamedBudgetNode[] }) {
    const [open, setOpen] = useState<Set<string>>(new Set())

    if (nodes.length === 0) {
        return (
            <Card className="p-[22px]">
                <CardHead title="Kategoriler" href="/settings" link="Tümü" />
                <p style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                    Henüz bütçe tanımlı değil. Kategorilere aylık bütçe verirsen harcamalar
                    devir dahil burada takip edilir.
                </p>
                <div className="mt-[var(--s4)]">
                    <Link href="/settings" style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--accent)' }}>Bütçe tanımla</Link>
                </div>
            </Card>
        )
    }

    const onTrack = nodes.filter(r => r.ratio < 1).length
    const totalRemaining = nodes.reduce((s, r) => s + Math.max(0, r.remaining), 0)
    const now = new Date()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const weeksLeft = Math.max(1, Math.ceil((daysInMonth - now.getDate()) / 7))
    const weekly = totalRemaining / weeksLeft

    const toggle = (id: string) => setOpen(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
    })

    return (
        <Card className="p-[22px]">
            <CardHead title="Kategoriler" href="/settings" link="Tümü" />
            <div className="mb-[var(--s4)]" style={{ fontSize: 13, color: 'var(--ink-3)' }}>{nodes.length} kategoriden {onTrack}&apos;i yolunda</div>

            <div className="flex flex-col gap-[11px]">
                {nodes.map(node => {
                    const isOpen = open.has(node.categoryId)
                    return (
                        <div key={node.categoryId} className="flex flex-col gap-[11px]">
                            <BudgetRow node={node} expanded={isOpen} onToggle={() => toggle(node.categoryId)} />
                            {isOpen && node.children?.map(child => (
                                <BudgetRow key={child.categoryId} node={child} depth={1} />
                            ))}
                        </div>
                    )
                })}
            </div>

            <div className="mt-[var(--s4)] pt-[var(--s3)] flex items-baseline justify-between" style={{ borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Bu hafta kalan keyfi</span>
                <span className="tnum" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{formatTL(weekly)}</span>
            </div>
        </Card>
    )
}

/** Blok 3 — Yorumlar + eyleme bağlı öneri. Öneri linki taksit→hedef akışını açar. */
function InsightsCard({
    insights, suggestion, onRedirect, interestPending = [], onOpenInterest,
}: {
    insights: Insight[]
    suggestion: { relief: { month: string; monthlyRelief: number }; goalName: string } | null
    onRedirect: (relief: { month: string; monthlyRelief: number }) => void
    interestPending?: { accountId: string; name: string; amount: number }[]
    onOpenInterest?: () => void
}) {
    if (insights.length === 0 && !suggestion && interestPending.length === 0) return null
    return (
        <Card className="px-[22px] py-[var(--s4)]">
            <CardHead title="Yorumlar" />
            <ul className="flex flex-col gap-[var(--s3)]">
                {/* Dönem sonu faiz onayı — sessiz satır; tıklanınca onay akışı açılır. */}
                {interestPending.map(p => (
                    <li key={p.accountId} className="flex items-start gap-[var(--s3)]">
                        <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: 'var(--budget-near)' }} aria-hidden />
                        <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>
                            <b style={{ color: 'var(--ink)' }}>{p.name}</b>&apos;ta <span className="tnum">{formatTL(p.amount)}</span> faiz işlemiş olabilir —{' '}
                            <button type="button" onClick={onOpenInterest} style={{ color: 'var(--accent)', fontWeight: 500 }} className="underline-offset-2 hover:underline">onayla</button>
                        </span>
                    </li>
                ))}
                {insights.map((insight, i) => (
                    <li key={i} className="flex items-start gap-[var(--s3)]">
                        <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: i === 0 ? 'var(--ink)' : 'var(--ink-4)' }} aria-hidden />
                        <span style={{ fontSize: 14.5, lineHeight: 1.45, color: i === 0 ? 'var(--ink)' : 'var(--ink-2)' }}>{insight.text}</span>
                    </li>
                ))}

                {suggestion && (
                    <li className="flex items-start gap-[var(--s3)]">
                        <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden />
                        <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>
                            {monthLocative(suggestion.relief.month)} {formatTL(suggestion.relief.monthlyRelief)} taksit bitiyor —{' '}
                            <button
                                type="button"
                                onClick={() => onRedirect(suggestion.relief)}
                                style={{ color: 'var(--accent)', fontWeight: 500 }}
                                className="underline-offset-2 hover:underline"
                            >
                                bir hedefe yönlendir
                            </button>
                        </span>
                    </li>
                )}
            </ul>
        </Card>
    )
}

/** Dönem sonu faiz onayı. Kaydet → source_type='faiz' hareketi + bakiye + dönem
 *  işareti; Tutarı düzelt → gerçek tutar; Faiz işlemedi → yalnız işaret (bir daha
 *  sorulmaz). Faiz HESAPLANIR (interest.ts), aranmaz. */
function FaizApprovalModal({ pending, accounts, hhId, onClose, onDone }: {
    pending: { accountId: string; name: string; type: string; periodEnd: string; debt: number; monthlyRatePct: number; amount: number; fingerprint: string }[]
    accounts: any[]
    hhId: string
    onClose: () => void
    onDone: () => void
}) {
    const [busy, setBusy] = useState<string | null>(null)
    const [editing, setEditing] = useState<string | null>(null)
    const [editAmount, setEditAmount] = useState<string>('')
    const [done, setDone] = useState<Set<string>>(new Set())

    const remaining = pending.filter(p => !done.has(p.fingerprint))
    useEffect(() => { if (pending.length > 0 && remaining.length === 0) onDone() }, [remaining.length])

    const mark = async (p: typeof pending[number]) =>
        supabase.from('dismissed_recurring').upsert({ household_id: hhId, fingerprint: p.fingerprint }, { onConflict: 'household_id,fingerprint' })

    const save = async (p: typeof pending[number], amount: number) => {
        if (!amount || amount <= 0) return
        setBusy(p.accountId)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            await supabase.from('transactions').insert({
                household_id: hhId, account_id: p.accountId, category_id: null, user_id: user?.id ?? null,
                amount, type: 'expense',
                transaction_date: new Date(p.periodEnd + 'T00:00:00').toISOString(),
                cash_date: p.periodEnd, description: 'Faiz', source_type: 'faiz',
            })
            const acc = accounts.find(a => a.id === p.accountId)
            if (acc) await supabase.from('accounts').update({ balance: Number(acc.balance) - amount }).eq('id', p.accountId)
            await mark(p)
            setEditing(null); setDone(s => new Set(s).add(p.fingerprint))
        } catch (e) { console.error('Faiz kaydedilemedi:', e) } finally { setBusy(null) }
    }

    const skip = async (p: typeof pending[number]) => {
        setBusy(p.accountId)
        try { await mark(p); setDone(s => new Set(s).add(p.fingerprint)) }
        catch (e) { console.error('İşaretlenemedi:', e) } finally { setBusy(null) }
    }

    const btn = { borderRadius: 'var(--r-button)', fontSize: 13, fontWeight: 600 } as const

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
            <div className="w-full max-w-md rounded-[var(--r-card)] p-[var(--s5)]" style={{ background: 'var(--surface)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                <div className="mb-[var(--s4)] flex items-center justify-between">
                    <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Dönem sonu faizi</span>
                    <button onClick={onClose} aria-label="Kapat" style={{ color: 'var(--ink-3)' }}>✕</button>
                </div>
                <div className="space-y-[var(--s4)]">
                    {remaining.map(p => (
                        <div key={p.fingerprint} className="p-[var(--s4)]" style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-card)' }}>
                            <div className="tnum" style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
                                <b style={{ color: 'var(--ink)' }}>{p.name}</b> · {formatTL(p.debt)} borç · %{p.monthlyRatePct} aylık faiz
                            </div>
                            <p className="mt-[var(--s2)]" style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ink)' }}>
                                Bu dönem <b className="tnum">{formatTL(p.amount)}</b> faiz işlemiş olmalı. Kaydedeyim mi?
                            </p>
                            {editing === p.accountId ? (
                                <div className="mt-[var(--s3)] flex items-center gap-[var(--s2)]">
                                    <input autoFocus type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)}
                                        className="tnum w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={{ fontSize: 14, background: 'var(--bg)', borderRadius: 'var(--r-button)', color: 'var(--ink)', border: '1px solid var(--border)' }} />
                                    <button disabled={busy === p.accountId} onClick={() => save(p, parseFloat(editAmount) || 0)} className="shrink-0 px-[var(--s3)] py-[var(--s2)]" style={{ ...btn, background: 'var(--accent)', color: '#fff' }}>Kaydet</button>
                                    <button onClick={() => setEditing(null)} className="shrink-0 px-[var(--s2)] py-[var(--s2)]" style={{ ...btn, color: 'var(--ink-3)' }}>Vazgeç</button>
                                </div>
                            ) : (
                                <div className="mt-[var(--s3)] flex flex-wrap items-center gap-[var(--s2)]">
                                    <button disabled={busy === p.accountId} onClick={() => save(p, p.amount)} className="px-[var(--s3)] py-[6px]" style={{ ...btn, background: 'var(--accent)', color: '#fff' }}>Kaydet</button>
                                    <button onClick={() => { setEditing(p.accountId); setEditAmount(String(p.amount)) }} className="px-[var(--s3)] py-[6px]" style={{ ...btn, background: 'var(--surface)', color: 'var(--ink-2)' }}>Tutarı düzelt</button>
                                    <button disabled={busy === p.accountId} onClick={() => skip(p)} className="ml-auto px-[var(--s3)] py-[6px]" style={{ ...btn, color: 'var(--ink-3)', fontWeight: 500 }}>Faiz işlemedi</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

/** 1b-4 — Kalkan taksit yükünü seçilen hedefin monthly_alloc'ına ekler. Onay ister;
 *  sessizce değiştirmez. Birden fazla aktif hedef olabilir → kullanıcı seçer. */
function ReliefRedirectModal({ relief, goals, onClose, onDone }: {
    relief: { month: string; monthlyRelief: number }
    goals: Goal[]
    onClose: () => void
    onDone: () => void
}) {
    const active = goals
        .map(g => ({ g, remaining: Number(g.target_amount) - Number(g.saved_tl || 0) }))
        .filter(x => x.remaining > 0)
        .sort((a, b) => a.remaining - b.remaining)
        .map(x => x.g)

    const [selectedId, setSelectedId] = useState<string>(active[0]?.id ?? '')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const selected = active.find(g => g.id === selectedId) ?? null
    const currentAlloc = Number(selected?.monthly_alloc || 0)
    const newAlloc = currentAlloc + relief.monthlyRelief

    const confirm = async () => {
        if (!selected) return
        setSaving(true); setError(null)
        try {
            const { error: err } = await supabase
                .from('goals')
                .update({ monthly_alloc: newAlloc })
                .eq('id', selected.id)
            if (err) throw err
            onDone()
        } catch (e) {
            console.error('Hedefe yönlendirme başarısız:', e)
            setError('Kaydedilemedi. Tekrar deneyin.')
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-[var(--s4)]" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
            <div
                className="w-full max-w-[420px] p-[22px]"
                style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Taksiti hedefe yönlendir</div>
                <p className="mt-[var(--s2)]" style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                    {monthLocative(relief.month)} biten <span className="tnum" style={{ fontWeight: 600, color: 'var(--ink)' }}>{formatTL(relief.monthlyRelief)}</span>/ay
                    taksit yükünü bir hedefin aylık ayrılan tutarına ekle.
                </p>

                {active.length === 0 ? (
                    <p className="mt-[var(--s4)]" style={{ fontSize: 14, color: 'var(--ink-3)' }}>Aktif (tamamlanmamış) hedef yok.</p>
                ) : (
                    <div className="mt-[var(--s4)] flex flex-col gap-[var(--s2)]">
                        {active.map(g => {
                            const on = g.id === selectedId
                            return (
                                <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => setSelectedId(g.id)}
                                    className="flex items-center justify-between gap-[var(--s3)] rounded-[var(--r-bar)] px-[var(--s3)] py-[var(--s3)] text-left transition-colors"
                                    style={{ border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-bg)' : 'transparent' }}
                                >
                                    <span className="min-w-0 truncate" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{g.name}</span>
                                    <span className="tnum shrink-0" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                                        {Number(g.monthly_alloc || 0) > 0 ? `${formatTL(Number(g.monthly_alloc))}/ay` : 'ayrılan yok'}
                                    </span>
                                </button>
                            )
                        })}

                        {selected && (
                            <div className="mt-[var(--s2)] flex items-baseline justify-between" style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                                <span>{selected.name} aylık ayrılan</span>
                                <span className="tnum" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                                    {formatTL(currentAlloc)} → <span style={{ color: 'var(--accent)' }}>{formatTL(newAlloc)}</span>
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {error && <p className="mt-[var(--s3)]" style={{ fontSize: 13, color: 'var(--flow-out)' }}>{error}</p>}

                <div className="mt-[var(--s5)] flex justify-end gap-[var(--s3)]">
                    <button type="button" onClick={onClose} style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-3)' }} className="px-[var(--s3)] py-[var(--s2)]">
                        Vazgeç
                    </button>
                    <button
                        type="button"
                        onClick={confirm}
                        disabled={!selected || saving}
                        className="rounded-[var(--r-bar)] px-[var(--s4)] py-[var(--s2)] transition-opacity disabled:opacity-50"
                        style={{ fontSize: 14, fontWeight: 600, background: 'var(--accent)', color: '#fff' }}
                    >
                        {saving ? 'Ekleniyor…' : `${formatTL(relief.monthlyRelief)} ekle`}
                    </button>
                </div>
            </div>
        </div>
    )
}

/** Blok 4 — Dayanma + hedef. Sessiz iki satır, --ink-3 ikon. */
function fmtAy(n: number) { return n.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) }

const TR_AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

/** cash_date → "Bugün" / "Dün" / "10 Ağustos". */
function dayLabel(cashDate: string, todayStr: string): string {
    if (cashDate === todayStr) return 'Bugün'
    const [ty, tm, td] = todayStr.split('-').map(Number)
    const yst = new Date(ty, tm - 1, td - 1)
    const yStr = `${yst.getFullYear()}-${String(yst.getMonth() + 1).padStart(2, '0')}-${String(yst.getDate()).padStart(2, '0')}`
    if (cashDate === yStr) return 'Dün'
    const [, mo, dd] = cashDate.split('-').map(Number)
    return `${dd} ${TR_AYLAR[mo - 1]}`
}

/**
 * Blok 5 — Son hareketler, GÜNE GÖRE gruplu (Bugün/Dün/tarih). En yeni gün grubu
 * görsel ayrımlı (--ink başlık + accent nokta), eskiler --ink-3. İkon kategori
 * renginde, rakam yön rengi taşır (giren --flow-in, çıkan --ink); zemin nötr.
 */
function RecentCard({ rows, accountById }: { rows: Row[]; accountById: Map<string, { name: string; type: string }> }) {
    const todayStr = today()
    // Ardışık aynı-gün satırları grupla (rows zaten tarihe göre azalan sıralı).
    const groups: { date: string; rows: Row[] }[] = []
    for (const row of rows) {
        const last = groups[groups.length - 1]
        if (last && last.date === row.cash_date) last.rows.push(row)
        else groups.push({ date: row.cash_date, rows: [row] })
    }

    return (
        <Card className="py-[var(--s2)]">
            <div className="px-[22px] pb-[var(--s2)] pt-[var(--s3)]">
                <CardHead title="Son hareketler" href="/hareketler" link="Tümü" />
            </div>

            {rows.length === 0 ? (
                <p className="px-[22px] pb-[var(--s3)]" style={{ fontSize: 14.5, color: 'var(--ink-3)' }}>Bu ay henüz hareket yok.</p>
            ) : (
                groups.map((g, gi) => (
                    <div key={g.date}>
                        {/* Gün başlığı — en yeni grup (gi===0) öne çıkar */}
                        <div
                            className="flex items-center gap-[var(--s2)] px-[22px] pt-[var(--s3)] pb-[var(--s1)]"
                            style={{ borderTop: gi === 0 ? 'none' : '1px solid var(--border)' }}
                        >
                            {gi === 0 && (
                                <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'var(--accent)' }} aria-hidden />
                            )}
                            <span style={{ fontSize: 12, fontWeight: 600, color: gi === 0 ? 'var(--ink)' : 'var(--ink-3)' }}>
                                {dayLabel(g.date, todayStr)}
                            </span>
                        </div>
                        <ul>
                            {g.rows.map(row => {
                                // Başlık = açıklama; boşsa kategori adına düş. Sol ikon HESABI,
                                // kategori kimliği sağdaki pill'de (renk tek yerde).
                                const acc = row.account_id ? accountById.get(row.account_id) : undefined
                                const title = row.description || row.categoryName || 'Hareket'
                                const accShort = shortAccount(acc?.name)
                                return (
                                    <li key={row.id} className="flex items-center gap-[var(--s3)] px-[22px] py-[10px]">
                                        <AccountIcon type={acc?.type} />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate" style={{ fontSize: 14, color: 'var(--ink)' }}>{title}</div>
                                            {accShort && (
                                                <div className="truncate mt-[1px]" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{accShort}</div>
                                            )}
                                        </div>
                                        {row.categoryName && <CategoryPill name={row.categoryName} />}
                                        {/* Kimlik pill'de olduğu için tutar nötr --ink; yön yalnız işaretle. */}
                                        <span className="tnum shrink-0" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>
                                            {row.type === 'income' ? '+' : ''}{formatTL(Math.abs(Number(row.amount)))}
                                        </span>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                ))
            )}
        </Card>
    )
}

/** Veri yokken alarm değil: ne ekleneceğini söyleyen başlangıç durumu. */
function StartingState() {
    return (
        <Card className="p-[22px]">
            <p style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--ink)' }}>Başlamak için bir hesap ekleyin.</p>
            <p className="mt-[var(--s2)]" style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                Hesabınızı ve düzenli ödemelerinizi girdikçe bu ekran ay sonu tahminini,
                bütçe durumunu ve harcama yorumlarını gösterecek.
            </p>
            <div className="mt-[var(--s4)] flex flex-wrap gap-[var(--s4)]">
                <Link href="/accounts" style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--accent)' }}>Hesap ekle</Link>
                <Link href="/subscriptions" style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--accent)' }}>Abonelik ekle</Link>
            </div>
        </Card>
    )
}
