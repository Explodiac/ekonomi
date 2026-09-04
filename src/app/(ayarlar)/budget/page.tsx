"use client"

import { useState, useEffect, useMemo } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, ChevronRight } from "lucide-react"
import { computeBudgetRollover, safeParent, type BudgetPeriodResult, type BudgetCategoryMeta } from "@/lib/budget-rollover"
import { CategoryTile } from "@/components/dashboard/category-tile"

function formatTL(n: number): string {
    const abs = Math.abs(Math.round(n))
    return `${n < 0 ? '−' : ''}${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs)} ₺`
}
function todayStr() { return new Date().toISOString().slice(0, 10) }
const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

type Cat = { id: string; name: string; type: string; parent_id: string | null }

// Rampa: kullanım oranına renk (bütçe rampası)
function rampColor(ratio: number): string {
    if (ratio < 0.7) return 'var(--budget-ok)'
    if (ratio < 0.9) return 'var(--budget-mid)'
    if (ratio < 1) return 'var(--budget-near)'
    return 'var(--budget-over)'
}

export default function BudgetPage() {
    const [hhId, setHhId] = useState<string | null>(null)
    const [categories, setCategories] = useState<Cat[]>([])
    const [transactions, setTransactions] = useState<any[]>([])
    const [budgetPeriods, setBudgetPeriods] = useState<any[]>([])
    const [negativeCarry, setNegativeCarry] = useState(true)
    const [isLoading, setIsLoading] = useState(true)

    const currentMonth = todayStr().slice(0, 7)

    const fetchAll = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const id = await ensureHouseholdExists(user.id)
            setHhId(id)
            const [catRes, txRes, bpRes, hhRes] = await Promise.all([
                supabase.from('categories').select('id, name, type, parent_id').eq('household_id', id).order('name'),
                supabase.from('transactions').select('amount, type, cash_date, category_id, source_type, transfer_direction').eq('household_id', id),
                supabase.from('budget_periods').select('category_id, period, budgeted').eq('household_id', id),
                supabase.from('households').select('negative_carry').eq('id', id).single(),
            ])
            if (catRes.error) throw catRes.error
            setCategories(catRes.data || [])
            setTransactions(txRes.data || [])
            setBudgetPeriods(bpRes.data || [])
            setNegativeCarry(hhRes.data?.negative_carry ?? true)
        } catch (e: any) {
            console.error('Bütçe yüklenemedi:', e)
        } finally {
            setIsLoading(false)
        }
    }
    useEffect(() => { fetchAll() }, [])

    const rollover = useMemo(() =>
        computeBudgetRollover(
            budgetPeriods.map(b => ({ categoryId: b.category_id, period: b.period, budgeted: b.budgeted })),
            transactions,
            { currentMonth, asOf: todayStr(), negativeCarry },
        ), [budgetPeriods, transactions, currentMonth, negativeCarry])

    const currentByCat = useMemo(() => {
        const m = new Map<string, BudgetPeriodResult>()
        for (const r of rollover) if (r.period === currentMonth) m.set(r.categoryId, r)
        return m
    }, [rollover, currentMonth])

    const budgetedByCat = useMemo(() => {
        const m = new Map<string, number>()
        for (const b of budgetPeriods) if (String(b.period).slice(0, 7) === currentMonth) m.set(b.category_id, Number(b.budgeted))
        return m
    }, [budgetPeriods, currentMonth])

    // Hiyerarşi: gider kategorileri, üst-seviye → çocuklar (safeParent ile)
    const tree = useMemo(() => {
        const meta: BudgetCategoryMeta[] = categories.map(c => ({ id: c.id, parent_id: c.parent_id }))
        const byId = new Map(meta.map(m => [m.id, m]))
        const expense = categories.filter(c => c.type === 'expense')
        const tops = expense.filter(c => !safeParent({ id: c.id, parent_id: c.parent_id }, byId))
        return tops.map(top => ({
            cat: top,
            children: expense.filter(c => safeParent({ id: c.id, parent_id: c.parent_id }, byId) === top.id),
        }))
    }, [categories])

    const updateBudget = async (categoryId: string, budgeted: number) => {
        if (!hhId) return
        try {
            await supabase.from('budget_periods').upsert(
                { household_id: hhId, category_id: categoryId, period: `${currentMonth}-01`, budgeted },
                { onConflict: 'household_id,category_id,period' },
            )
            fetchAll()
        } catch (e: any) {
            console.error('Bütçe güncellenemedi:', e)
        }
    }

    const toggleNegativeCarry = async () => {
        if (!hhId) return
        const next = !negativeCarry
        setNegativeCarry(next)
        try { await supabase.from('households').update({ negative_carry: next }).eq('id', hhId) }
        catch (e: any) { console.error('Ayar güncellenemedi:', e) }
    }

    const inputStyle = { background: 'var(--bg)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 14 } as const

    return (
        <div className="flex flex-col gap-[var(--s3)] pb-10">
            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="py-[var(--s2)]">
                <div className="flex items-center justify-between px-[22px] pb-[var(--s2)] pt-[var(--s3)]">
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                        Bu ay · {TR_MONTHS[Number(currentMonth.slice(5)) - 1]} {currentMonth.slice(0, 4)}
                    </span>
                    <label className="flex cursor-pointer items-center gap-[var(--s2)]">
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Negatif devir (aşımı sonraki aya taşı)</span>
                        <button type="button" onClick={toggleNegativeCarry} className="relative h-5 w-10 rounded-full transition-colors" style={{ background: negativeCarry ? 'var(--accent)' : 'var(--ink-4)' }} aria-pressed={negativeCarry}>
                            <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: negativeCarry ? 22 : 2 }} />
                        </button>
                    </label>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-[var(--s6)]"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
                ) : tree.length === 0 ? (
                    <p className="px-[22px] pb-[var(--s3)]" style={{ fontSize: 14.5, color: 'var(--ink-3)' }}>Önce Kategoriler sekmesinden gider kategorisi ekleyin.</p>
                ) : (
                    <ul>
                        {tree.map(({ cat, children }, gi) => (
                            <li key={cat.id} style={{ borderTop: gi === 0 ? 'none' : '1px solid var(--border)' }}>
                                <BudgetRow
                                    cat={cat} budgeted={budgetedByCat.get(cat.id) ?? 0} result={currentByCat.get(cat.id) ?? null}
                                    inputStyle={inputStyle} onSave={(v) => updateBudget(cat.id, v)}
                                    hasChildren={children.length > 0}
                                />
                                {children.map(ch => (
                                    <div key={ch.id} className="pl-[var(--s6)]" style={{ borderTop: '1px solid var(--border)' }}>
                                        <BudgetRow
                                            cat={ch} child budgeted={budgetedByCat.get(ch.id) ?? 0} result={currentByCat.get(ch.id) ?? null}
                                            inputStyle={inputStyle} onSave={(v) => updateBudget(ch.id, v)}
                                        />
                                    </div>
                                ))}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <p className="px-[var(--s2)]" style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                Üst kategorinin kendi bütçesi varsa alt kategoriler onun havuzunda değerlendirilir; yoksa üst satır alt bütçelerin toplamını gösterir.
            </p>
        </div>
    )
}

function BudgetRow({ cat, child, budgeted, result, inputStyle, onSave, hasChildren }: {
    cat: Cat
    child?: boolean
    budgeted: number
    result: BudgetPeriodResult | null
    inputStyle: any
    onSave: (v: number) => void
    hasChildren?: boolean
}) {
    const ratio = result && result.available > 0 ? result.spent / result.available : 0
    const pct = Math.min(1, ratio) * 100
    return (
        <div className="px-[22px] py-[12px]">
            <div className="flex items-center gap-[var(--s3)]">
                {child && <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--ink-4)' }} />}
                <CategoryTile name={cat.name} size={28} />
                <span className="min-w-0 flex-1 truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{cat.name}</span>
                <div className="relative shrink-0">
                    <input
                        type="number" placeholder="0" defaultValue={budgeted || ''}
                        onBlur={(e) => onSave(parseFloat(e.target.value) || 0)}
                        className="tnum h-9 w-28 pr-7 text-right outline-none"
                        style={{ ...inputStyle }}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2" style={{ fontSize: 13, color: 'var(--ink-3)' }}>₺</span>
                </div>
            </div>

            {result && result.available > 0 && (
                <div className="mt-[var(--s2)]">
                    <div className="h-[5px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                        <div className="h-full" style={{ width: `${pct}%`, background: rampColor(ratio), borderRadius: 'var(--r-bar)' }} />
                    </div>
                    <p className="tnum mt-[6px]" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        {result.carriedIn !== 0 && (<>devir {result.carriedIn > 0 ? '+' : '−'}{formatTL(Math.abs(result.carriedIn))} · </>)}
                        kullanılabilir {formatTL(result.available)} · harcanan {formatTL(result.spent)} ·{' '}
                        <span style={{ color: result.isOver ? 'var(--flow-out)' : 'var(--ink)' }}>
                            {result.isOver ? 'aşım' : 'kalan'} {formatTL(Math.abs(result.remaining))}
                        </span>
                    </p>
                </div>
            )}
            {hasChildren && !(result && result.available > 0) && (
                <p className="mt-[6px]" style={{ fontSize: 12, color: 'var(--ink-4)' }}>Alt kategorilerin havuzu</p>
            )}
        </div>
    )
}
