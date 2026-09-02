'use client'

import { useState, useEffect, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, Plus, ChevronDown, ChevronRight, X, PieChart } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { PrimaryButton } from "@/components/ui/primary-button"
import { CategoryTile, categoryInk } from "@/components/dashboard/category-tile"
import { computeBudgetRollover, safeParent, type BudgetPeriodResult, type BudgetCategoryMeta } from "@/lib/budget-rollover"
import { CategoryDetailPanel } from "@/components/categories/category-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"

function formatTL(n: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n)))} ₺`
}
function todayStr() { return new Date().toISOString().slice(0, 10) }

type Cat = { id: string; name: string; type: string; parent_id: string | null }
type Node = {
    id: string; name: string; spent: number; available: number; budgeted: number
    ratio: number; isOver: boolean; hasBudget: boolean; children: Node[]
}

// Bütçe rampası
function rampColor(ratio: number): string {
    if (ratio >= 1) return 'var(--budget-over)'
    if (ratio >= 0.85) return 'var(--budget-near)'
    if (ratio >= 0.6) return 'var(--budget-mid)'
    return 'var(--budget-ok)'
}

export default function KategorilerPage() {
    const router = useRouter()
    const [categories, setCategories] = useState<Cat[]>([])
    const [transactions, setTransactions] = useState<any[]>([])
    const [budgetPeriods, setBudgetPeriods] = useState<any[]>([])
    const [negativeCarry, setNegativeCarry] = useState(true)
    const [isLoading, setIsLoading] = useState(true)
    const [selected, setSelected] = useState<string | null>(null)
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const isDesktop = useIsDesktop()

    const currentMonth = todayStr().slice(0, 7)

    const fetchAll = useCallback(async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const id = await ensureHouseholdExists(user.id)
            if (!id) return
            const [catRes, txRes, bpRes, hhRes] = await Promise.all([
                supabase.from('categories').select('id, name, type, parent_id').eq('household_id', id).order('name'),
                supabase.from('transactions').select('amount, type, cash_date, category_id, source_type, transfer_direction').eq('household_id', id),
                supabase.from('budget_periods').select('category_id, period, budgeted').eq('household_id', id),
                supabase.from('households').select('negative_carry').eq('id', id).single(),
            ])
            setCategories((catRes.data || []) as Cat[])
            setTransactions(txRes.data || [])
            setBudgetPeriods(bpRes.data || [])
            setNegativeCarry(hhRes.data?.negative_carry ?? true)
        } catch (e) {
            console.error('Kategoriler yüklenemedi:', e)
        } finally {
            setIsLoading(false)
        }
    }, [])
    useEffect(() => { fetchAll() }, [fetchAll])

    // URL'den ?kategori=<id> → seçili
    useEffect(() => {
        if (typeof window === 'undefined') return
        const k = new URLSearchParams(window.location.search).get('kategori')
        if (k) setSelected(k)
    }, [])

    const select = useCallback((id: string | null) => {
        setSelected(id)
        if (typeof window !== 'undefined') {
            const url = id ? `/kategoriler?kategori=${id}` : '/kategoriler'
            window.history.replaceState(null, '', url)
        }
    }, [])

    // Devir dahil sonuçlar (bu ay)
    const currentByCat = useMemo(() => {
        const flat = computeBudgetRollover(
            budgetPeriods.map(b => ({ categoryId: b.category_id, period: b.period, budgeted: b.budgeted })),
            transactions, { currentMonth, asOf: todayStr(), negativeCarry },
        )
        const m = new Map<string, BudgetPeriodResult>()
        for (const r of flat) if (r.period === currentMonth) m.set(r.categoryId, r)
        return m
    }, [budgetPeriods, transactions, currentMonth, negativeCarry])

    // Bu ay kategori başına harcanan (bütçesiz kategoriler dahil)
    const spentMap = useMemo(() => {
        const m = new Map<string, number>()
        const asOf = todayStr()
        for (const t of transactions) {
            if (t.type !== 'expense' || !t.cash_date || t.cash_date > asOf) continue
            if (t.cash_date.slice(0, 7) !== currentMonth || !t.category_id) continue
            m.set(t.category_id, (m.get(t.category_id) ?? 0) + Math.abs(Number(t.amount)))
        }
        return m
    }, [transactions, currentMonth])

    // Tam hiyerarşi — tüm gider kategorileri (bütçesizler de dahil)
    const tree = useMemo<Node[]>(() => {
        const meta: BudgetCategoryMeta[] = categories.map(c => ({ id: c.id, parent_id: c.parent_id }))
        const byId = new Map(meta.map(m => [m.id, m]))
        const nameById = new Map(categories.map(c => [c.id, c.name]))
        const expense = categories.filter(c => c.type === 'expense')
        const tops = expense.filter(c => !safeParent({ id: c.id, parent_id: c.parent_id }, byId))

        const leaf = (id: string): Node => {
            const r = currentByCat.get(id)
            const spent = spentMap.get(id) ?? (r?.spent ?? 0)
            const available = r?.available ?? 0
            const ratio = available > 0 ? spent / available : (spent > 0 ? 1 : 0)
            return { id, name: nameById.get(id) ?? 'Kategori', spent, available, budgeted: r?.budgeted ?? 0, ratio, isOver: available > 0 && spent > available, hasBudget: available > 0, children: [] }
        }

        const nodes = tops.map(top => {
            const childCats = expense.filter(c => safeParent({ id: c.id, parent_id: c.parent_id }, byId) === top.id)
            const children = childCats.map(c => leaf(c.id))
            const own = currentByCat.get(top.id)
            const hasOwnBudget = !!own && own.available > 0
            const groupSpent = (spentMap.get(top.id) ?? 0) + children.reduce((s, c) => s + c.spent, 0)
            const available = hasOwnBudget ? own!.available : children.reduce((s, c) => s + c.available, 0)
            const ratio = available > 0 ? groupSpent / available : (groupSpent > 0 ? 1 : 0)
            return {
                id: top.id, name: nameById.get(top.id) ?? 'Kategori',
                spent: groupSpent, available, budgeted: hasOwnBudget ? own!.budgeted : children.reduce((s, c) => s + c.budgeted, 0),
                ratio, isOver: available > 0 && groupSpent > available, hasBudget: available > 0, children,
            }
        })
        // Harcaması/bütçesi olanlar üstte (harcanan azalan), boşlar altta (ada göre)
        return nodes.sort((a, b) => {
            const aActive = a.spent > 0 || a.available > 0
            const bActive = b.spent > 0 || b.available > 0
            if (aActive !== bActive) return aActive ? -1 : 1
            if (aActive) return b.spent - a.spent
            return a.name.localeCompare(b.name, 'tr')
        })
    }, [categories, currentByCat, spentMap])

    // Halka + iki rakam SADECE bütçesi olan kategoriler (elmayla elma).
    const budgetedNodes = useMemo(() => tree.filter(n => n.hasBudget), [tree])
    const budgetedSpent = budgetedNodes.reduce((s, n) => s + n.spent, 0)
    const budgetedBudget = budgetedNodes.reduce((s, n) => s + n.available, 0)
    // Bütçesiz kategorilerdeki harcama ayrı sayılır (halkaya karışmaz).
    const unbudgetedSpent = tree.filter(n => !n.hasBudget).reduce((s, n) => s + n.spent, 0)

    // "Bütçesizleri öne çıkar" filtresi — bütçesiz satırları listenin başına alır + vurgular.
    const [promoteUnbudgeted, setPromoteUnbudgeted] = useState(false)
    const displayTree = useMemo(() => {
        if (!promoteUnbudgeted) return tree
        const unb = tree.filter(n => !n.hasBudget)
        const bud = tree.filter(n => n.hasBudget)
        return [...unb, ...bud]
    }, [tree, promoteUnbudgeted])

    const toggle = (id: string) => setExpanded(prev => {
        const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
    })

    // Açılışta ilk kayıt (en çok harcanan) varsayılan seçili — sadece masaüstünde,
    // mobilde bottom sheet açılmasın. URL'de seçim varsa dokunma.
    useEffect(() => {
        if (selected || tree.length === 0 || !isDesktop) return
        if (new URLSearchParams(window.location.search).get('kategori')) return
        select(tree[0].id)
    }, [tree, selected, select, isDesktop])

    if (isLoading) {
        return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }

    return (
        <div>
            <div className="mb-[var(--s4)] flex items-center justify-between gap-[var(--s3)]">
                <PageHeader title="Kategoriler" subtitle="Harcama ve bütçeler" />
                <PrimaryButton onClick={() => router.push('/settings')}>
                    <Plus className="h-4 w-4" /> Kategori ekle
                </PrimaryButton>
            </div>

            <div className="flex gap-[var(--s5)]">
                {/* SOL PANEL */}
                <div className="min-w-0 flex-1 space-y-[var(--s4)]">
                    {/* Özet — halka (yalnız bütçeli kategoriler) */}
                    <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                        <div className="flex items-center justify-between gap-[var(--s4)]">
                            <div className="min-w-0">
                                <div className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)' }}>{formatTL(budgetedSpent)}</div>
                                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>bütçede harcandı</div>
                            </div>
                            <Donut nodes={budgetedNodes} total={budgetedSpent} />
                            <div className="min-w-0 text-right">
                                <div className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)' }}>{formatTL(budgetedBudget)}</div>
                                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>toplam bütçe</div>
                            </div>
                        </div>
                        {unbudgetedSpent > 0 && (
                            <button
                                onClick={() => setPromoteUnbudgeted(v => !v)}
                                className="mt-[var(--s3)] block w-full pt-[var(--s3)] text-left transition-colors hover:text-[var(--ink-2)]"
                                style={{ borderTop: '1px solid var(--border)', fontSize: 12.5, color: promoteUnbudgeted ? 'var(--accent)' : 'var(--ink-3)' }}
                            >
                                Bütçesiz kategorilerde ayrıca <span className="tnum">{formatTL(unbudgetedSpent)}</span> harcandı
                                {promoteUnbudgeted ? ' · gizle' : ''}
                            </button>
                        )}
                    </section>

                    {/* Liste */}
                    <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                        <div className="mb-[var(--s3)] flex items-center" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                            <span className="flex-1">Kategoriler</span>
                            <span className="w-[60px] text-right">Harcanan</span>
                            <span className="w-[56px]" />
                            <span className="w-[60px] text-right">Bütçe</span>
                        </div>
                        <div className="flex flex-col gap-[11px]">
                            {displayTree.map(node => {
                                const isOpen = expanded.has(node.id)
                                return (
                                    <div key={node.id} className="flex flex-col gap-[11px]">
                                        <CatRow node={node} selected={selected === node.id} highlight={promoteUnbudgeted && !node.hasBudget} onSelect={() => select(node.id)} expanded={isOpen} onToggle={() => toggle(node.id)} />
                                        {isOpen && node.children.map(ch => (
                                            <CatRow key={ch.id} node={ch} depth={1} selected={selected === ch.id} onSelect={() => select(ch.id)} />
                                        ))}
                                    </div>
                                )
                            })}
                        </div>
                    </section>
                </div>

                {/* SAĞ PANEL — masaüstü sticky */}
                <aside className="hidden w-[420px] shrink-0 lg:block">
                    <div className="sticky top-[var(--s3)]">
                        {selected ? (
                            <CategoryDetailPanel categoryId={selected} onSelectCategory={select} onChanged={fetchAll} bare />
                        ) : (
                            <div className="rounded-[var(--r-card)] p-[var(--s6)] text-center" style={{ background: 'var(--surface)', color: 'var(--ink-3)', fontSize: 14 }}>
                                <PieChart className="mx-auto mb-[var(--s3)] h-6 w-6" style={{ opacity: 0.5 }} />
                                Detay için bir kategori seç.
                            </div>
                        )}
                    </div>
                </aside>
            </div>

            {/* Mobil bottom sheet */}
            {selected && (
                <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" onClick={() => select(null)}>
                    <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.4)' }} />
                    <div className="relative max-h-[90vh] overflow-y-auto rounded-t-[var(--r-card)] p-[var(--s4)]" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
                        <div className="mb-[var(--s3)] flex justify-end">
                            <button onClick={() => select(null)} className="icon-btn p-1" aria-label="Kapat"><X className="h-5 w-5" /></button>
                        </div>
                        <CategoryDetailPanel categoryId={selected} onSelectCategory={select} onChanged={fetchAll} bare />
                    </div>
                </div>
            )}
        </div>
    )
}

/** Halka grafik — segmentler kategori kimlik renginde, harcama oranına göre, içi boş. */
function Donut({ nodes, total }: { nodes: Node[]; total: number }) {
    const R = 30, SW = 9, C = 2 * Math.PI * R
    const size = (R + SW) * 2
    let offset = 0
    const segs = total > 0 ? nodes.filter(n => n.spent > 0).map(n => {
        const frac = n.spent / total
        const seg = { color: categoryInk(n.name), dash: frac * C, offset }
        offset += frac * C
        return seg
    }) : []
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--fill-track)" strokeWidth={SW} />
            {segs.map((s, i) => (
                <circle
                    key={i} cx={size / 2} cy={size / 2} r={R} fill="none"
                    stroke={s.color} strokeWidth={SW}
                    strokeDasharray={`${s.dash} ${C - s.dash}`} strokeDashoffset={-s.offset}
                />
            ))}
        </svg>
    )
}

/** Tek satır: [ok/nokta] [alt-sayı rozeti] [ikon] Ad — harcanan — bar — bütçe. */
function CatRow({ node, depth = 0, selected, highlight, onSelect, expanded, onToggle }: {
    node: Node
    depth?: number
    selected: boolean
    highlight?: boolean
    onSelect: () => void
    expanded?: boolean
    onToggle?: () => void
}) {
    const isChild = depth > 0
    const hasChildren = node.children.length > 0
    const ink = categoryInk(node.name)
    const pct = Math.min(100, node.ratio * 100)
    // Bar özel durum: tam dolu (%100, aşım yok) → içi boş çerçeve; aşım → dolu --flow-out.
    const full = node.hasBudget && node.spent === node.available && node.available > 0
    const bg = selected ? 'var(--surface-2)' : highlight ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent'
    return (
        <div
            className="relative flex w-full items-center gap-[var(--s2)] rounded-[var(--r-button)] py-[3px] pr-[var(--s2)] transition-colors"
            style={{ background: bg, paddingLeft: isChild ? 26 : 8, boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : highlight ? 'inset 3px 0 0 color-mix(in srgb, var(--accent) 50%, transparent)' : 'none' }}
        >
            {/* Ok (parent) veya nokta (yaprak) */}
            {hasChildren ? (
                <button onClick={onToggle} className="shrink-0" style={{ color: 'var(--ink-3)' }} aria-label={expanded ? 'Daralt' : 'Genişlet'}>
                    {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
            ) : (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ink }} aria-hidden />
            )}

            {/* Alt-sayı rozeti (yalnız parent) — kimlik renginde */}
            {hasChildren && (
                <span className="tnum inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center px-[4px]" style={{ background: ink, color: '#fff', borderRadius: 5, fontSize: 11, fontWeight: 700 }}>
                    {node.children.length}
                </span>
            )}

            {!isChild && <CategoryTile name={node.name} size={22} />}

            <button onClick={onSelect} className="min-w-0 flex-1 truncate text-left" style={{ fontSize: isChild ? 13.5 : 14, color: isChild ? 'var(--ink-2)' : 'var(--ink)' }}>
                {node.name}
            </button>

            {/* Harcanan */}
            <span className="tnum w-[60px] shrink-0 text-right" style={{ fontSize: 13, color: 'var(--ink)' }}>{node.spent > 0 ? formatTL(node.spent) : '—'}</span>
            {/* Bar */}
            <span className="inline-block h-[5px] w-[56px] shrink-0 overflow-hidden" style={{ background: node.hasBudget ? 'var(--fill-track)' : 'transparent', borderRadius: 'var(--r-bar)' }}>
                {node.hasBudget && (
                    full
                        ? <span className="block h-full" style={{ border: '1.5px solid var(--budget-near)', borderRadius: 'var(--r-bar)', width: '100%' }} />
                        : <span className="block h-full" style={{ width: `${pct}%`, background: rampColor(node.ratio), borderRadius: 'var(--r-bar)' }} />
                )}
            </span>
            {/* Bütçe */}
            <span className="tnum w-[60px] shrink-0 text-right" style={{ fontSize: 13, color: 'var(--ink-3)' }}>{node.hasBudget ? formatTL(node.available) : ''}</span>
        </div>
    )
}
