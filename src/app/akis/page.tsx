'use client'

import { useState, useEffect, useMemo, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, ArrowUpRight } from "lucide-react"
import { buildCashflowPeriod, type FlowTransaction, type CashflowResult, type CashflowCategory } from "@/lib/flow"
import { safeParent, type BudgetCategoryMeta } from "@/lib/budget-rollover"
import { categoryInk, CategoryTile } from "@/components/dashboard/category-tile"
import { DeltaChip } from "@/components/ui/delta-chip"
import { Segmented } from "@/components/ui/segmented"
import { PageHeader } from "@/components/ui/page-header"
import { FlowDetailPanel, type PanelKind } from "@/components/akis/flow-detail-panel"
import type { YearRow } from "@/components/categories/key-metrics"

/** Bir tür için yıllık toplam + aylık ortalama (tüm hareketlerden). */
function panelYearly(txs: FlowTransaction[], kind: PanelKind, asOf: string): YearRow[] {
    const curYear = Number(asOf.slice(0, 4)), curMonth = Number(asOf.slice(5, 7))
    const byYear = new Map<number, { inc: number; exp: number }>()
    for (const t of txs) {
        if (!t.cash_date || t.cash_date > asOf) continue
        if (t.transfer_direction || (t.type !== 'income' && t.type !== 'expense')) continue
        const y = Number(t.cash_date.slice(0, 4))
        const amt = Math.abs(Number(t.amount))
        const e = byYear.get(y) ?? { inc: 0, exp: 0 }
        if (t.type === 'income') e.inc += amt; else e.exp += amt
        byYear.set(y, e)
    }
    return [...byYear.entries()]
        .map(([year, v]) => {
            const total = kind === 'harcama' ? v.exp : kind === 'gelir' ? v.inc : v.inc - v.exp
            const isCurrent = year === curYear
            const months = isCurrent ? curMonth : 12
            return { year, total, monthlyAvg: total / months, isCurrent }
        })
        .sort((a, b) => b.year - a.year)
}

function formatTL(amount: number): string {
    const abs = Math.abs(Math.round(amount))
    const s = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs)
    return `${amount < 0 ? '−' : ''}${s} ₺`
}
const TR_MON_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const TR_MON_LETTER = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A']

const RECURRING_KEY = '__recurring__'
function monthLabel(mk: string) { const [y, m] = mk.split('-').map(Number); return `${TR_MON_SHORT[m - 1]} ${y}` }

function todayISO() { return new Date().toISOString().slice(0, 10) }

/**
 * Bar üzerinde hangi ayda olunduğunu imleç x'inden bulur (mousemove başına yeniden
 * hesaplama yok — sadece bölme). Mobilde dokunuşla çalışır; dışarı dokununca kapanır.
 */
function useBarHover(n: number, activeAt?: (i: number) => boolean, onPick?: (i: number) => void) {
    const ref = useRef<HTMLDivElement>(null)
    const [hover, setHover] = useState<number | null>(null)
    const [width, setWidth] = useState(0)

    const fromX = (clientX: number): number | null => {
        const el = ref.current
        if (!el || n === 0) return null
        const r = el.getBoundingClientRect()
        if (r.width === 0) return null
        setWidth(r.width)
        const i = Math.floor(((clientX - r.left) / r.width) * n)
        if (!Number.isFinite(i) || i < 0 || i >= n) return null
        if (activeAt && !activeAt(i)) return null
        return i
    }

    useEffect(() => {
        if (hover === null) return
        const onDoc = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as any)) setHover(null) }
        document.addEventListener('pointerdown', onDoc)
        return () => document.removeEventListener('pointerdown', onDoc)
    }, [hover])

    const handlers = {
        onMouseMove: (e: React.MouseEvent) => setHover(fromX(e.clientX)),
        onMouseLeave: () => setHover(null),
        onTouchStart: (e: React.TouchEvent) => setHover(fromX(e.touches[0].clientX)),
        onTouchMove: (e: React.TouchEvent) => setHover(fromX(e.touches[0].clientX)),
        onClick: (e: React.MouseEvent) => { const i = fromX(e.clientX); if (i !== null) onPick?.(i) },
    }
    return { ref, hover, setHover, width, handlers }
}

type TipRow = { color: string; label: string; amount: number; icon?: boolean }

/** Hover tooltip kartı — bar grafiğin üstünde, sütuna göre konumlanır (kenardan taşmaz). */
function FlowTooltip({ n, index, width, title, total, totalColor, rows, footer }: {
    n: number; index: number; width: number
    title: string; total: number; totalColor?: string
    rows?: TipRow[]; footer?: React.ReactNode
}) {
    const CARD = 248
    const center = ((index + 0.5) / n) * width
    const half = Math.min(CARD / 2, width / 2)
    const left = Math.max(half, Math.min(width - half, center))
    return (
        <div
            className="pointer-events-none absolute z-20"
            style={{ left, top: -8, transform: 'translate(-50%, -100%)', width: Math.min(CARD, width) }}
        >
            <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', boxShadow: '0 12px 32px rgba(0,0,0,0.28)' }} className="p-[var(--s3)]">
                <div className="flex items-baseline justify-between gap-[var(--s3)]">
                    <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{title}</span>
                    <span className="tnum" style={{ fontSize: 14, fontWeight: 700, color: totalColor ?? 'var(--ink)' }}>{formatTL(total)}</span>
                </div>
                {(rows || footer) && <div className="my-[var(--s2)] h-px" style={{ background: 'var(--border)' }} />}
                {rows && (
                    <div className="flex flex-col gap-[6px]">
                        {rows.map((r, i) => (
                            <div key={i} className="flex items-center gap-[var(--s2)]">
                                <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: r.color }} />
                                {r.icon && <CategoryTile name={r.label} size={16} />}
                                <span className="min-w-0 flex-1 truncate" style={{ fontSize: 12.5, color: 'var(--ink)' }}>{r.label}</span>
                                <span className="tnum shrink-0" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{formatTL(r.amount)}</span>
                            </div>
                        ))}
                    </div>
                )}
                {footer}
            </div>
        </div>
    )
}

/** Bir ay için ilk 5 kategori + "Diğer kategoriler…" satırı. */
function topRows(cats: { key: string; label: string; monthly: number[] }[], i: number, otherLabel: string, pinnedKey?: string | null): TipRow[] {
    const items = cats
        .map(c => ({ key: c.key, label: c.label, amount: c.monthly[i] ?? 0 }))
        .filter(c => c.amount > 0)
        .sort((a, b) => b.amount - a.amount)
    // "Faiz & ücretler" sıralamaya karışmaz — her zaman en üstte, görünür kalır.
    const pinned = pinnedKey ? items.find(c => c.key === pinnedKey) : undefined
    const rest = pinned ? items.filter(c => c.key !== pinnedKey) : items
    const top: TipRow[] = rest.slice(0, 5).map(c => ({
        color: c.key === RECURRING_KEY ? 'var(--ink-3)' : categoryInk(c.label),
        label: c.label, amount: c.amount, icon: c.key !== RECURRING_KEY,
    }))
    const restSum = rest.slice(5).reduce((s, c) => s + c.amount, 0)
    if (restSum > 0) top.push({ color: 'var(--ink-3)', label: otherLabel, amount: restSum })
    if (pinned) top.unshift({ color: 'var(--flow-out)', label: pinned.label, amount: pinned.amount, icon: true })
    return top
}
function d(iso: string) { const [y, m, day] = iso.split('-').map(Number); return new Date(y, m - 1, day) }
function iso(dt: Date) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` }
function addDays(isoStr: string, n: number) { const t = d(isoStr); t.setDate(t.getDate() + n); return iso(t) }
function addYears(isoStr: string, n: number) { const t = d(isoStr); t.setFullYear(t.getFullYear() + n); return iso(t) }
function monthStart(isoStr: string, monthsBack = 0) { const t = d(isoStr); return iso(new Date(t.getFullYear(), t.getMonth() - monthsBack, 1)) }
function fmtDate(isoStr: string) { const [y, m, day] = isoStr.split('-').map(Number); return `${day} ${TR_MON_SHORT[m - 1]} ${y}` }

type Period = 'bu-ay' | '3-ay' | 'ybb' | '12-ay' | 'ozel'
type Compare = 'onceki' | 'gecen-yil'

export default function AkisPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>}>
            <AkisInner />
        </Suspense>
    )
}

function AkisInner() {
    const router = useRouter()
    const params = useSearchParams()
    const [txs, setTxs] = useState<FlowTransaction[]>([])
    const [categories, setCategories] = useState<BudgetCategoryMeta[]>([])
    const [interestCatId, setInterestCatId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const period = (params.get('donem') as Period) || 'ybb'
    const compare = (params.get('karsilastir') as Compare) || 'onceki'
    const splitRecurring = params.get('ayrik') === '1'
    const customFrom = params.get('baslangic') || ''
    const customTo = params.get('bitis') || ''

    const setParam = (k: string, v: string) => {
        const next = new URLSearchParams(params.toString())
        if (v) next.set(k, v); else next.delete(k)
        router.replace(`/akis?${next.toString()}`, { scroll: false })
    }

    useEffect(() => {
        const load = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return
                const hhId = await ensureHouseholdExists(user.id)
                if (!hhId) return
                const [txRes, catRes] = await Promise.all([
                    supabase.from('transactions')
                        .select('amount, type, cash_date, category_id, description, transfer_direction, source_type, categories(name)')
                        .eq('household_id', hhId),
                    supabase.from('categories').select('id, name, parent_id, is_interest').eq('household_id', hhId),
                ])
                setTxs((txRes.data || []).map((t: any) => ({ ...t, categoryName: t.categories?.name ?? null })))
                setCategories((catRes.data || []) as any)
                setInterestCatId((catRes.data || []).find((c: any) => c.is_interest)?.id ?? null)
            } catch (e) {
                console.error('Akış hesaplanamadı:', e)
            } finally {
                setIsLoading(false)
            }
        }
        load()
    }, [])

    const asOf = todayISO()

    // Dönem aralığı.
    const range = useMemo(() => {
        if (period === 'ozel' && customFrom && customTo) return { from: customFrom, to: customTo }
        const to = asOf
        if (period === 'bu-ay') return { from: monthStart(asOf), to }
        if (period === '3-ay') return { from: monthStart(asOf, 2), to }
        if (period === '12-ay') return { from: monthStart(asOf, 11), to }
        return { from: `${asOf.slice(0, 4)}-01-01`, to } // ybb
    }, [period, customFrom, customTo, asOf])

    // Karşılaştırma aralığı.
    const compareRange = useMemo(() => {
        if (compare === 'gecen-yil') return { from: addYears(range.from, -1), to: addYears(range.to, -1) }
        const lenDays = Math.round((d(range.to).getTime() - d(range.from).getTime()) / 86400000)
        const prevTo = addDays(range.from, -1)
        return { from: addDays(prevTo, -lenDays), to: prevTo }
    }, [compare, range])

    const result = useMemo(() => buildCashflowPeriod({ transactions: txs, ...range, asOf, splitRecurring }), [txs, range, asOf, splitRecurring])
    const cmp = useMemo(() => buildCashflowPeriod({ transactions: txs, ...compareRange, asOf, splitRecurring }), [txs, compareRange, asOf, splitRecurring])

    // Derin panel: tür + ay URL'de (?panel=harcama&ay=2026-05).
    const panelKind = params.get('panel') as PanelKind | null
    const panelMonth = params.get('ay') || asOf.slice(0, 7)
    const openPanel = (kind: PanelKind, month: string) => {
        const next = new URLSearchParams(params.toString())
        next.set('panel', kind); next.set('ay', month)
        router.push(`/akis?${next.toString()}`, { scroll: false })
    }
    const patchPanel = (patch: Record<string, string>) => {
        const next = new URLSearchParams(params.toString())
        for (const [k, v] of Object.entries(patch)) next.set(k, v)
        router.replace(`/akis?${next.toString()}`, { scroll: false })
    }
    const closePanel = () => {
        const next = new URLSearchParams(params.toString())
        next.delete('panel'); next.delete('ay')
        router.replace(`/akis?${next.toString()}`, { scroll: false })
    }

    // 24 aylık pencere (panel için, dönem seçiciden bağımsız).
    const panelRange = useMemo(() => ({ from: monthStart(asOf, 23), to: asOf }), [asOf])
    const panelResult = useMemo(() => buildCashflowPeriod({ transactions: txs, ...panelRange, asOf, splitRecurring: false }), [txs, panelRange, asOf])
    const panelYearRows = useMemo(() => panelKind ? panelYearly(txs, panelKind, asOf) : [], [txs, panelKind, asOf])

    if (isLoading) {
        return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }

    const compareLabel = compare === 'gecen-yil' ? 'geçen yıl aynı dönem' : 'önceki dönem'
    const hasData = result.totalIncome > 0 || result.totalExpense > 0

    return (
        <div className="w-full pb-10">
            <PageHeader title="Akış" />

            {/* Üst bar */}
            <div className="mb-[var(--s3)] flex flex-col gap-[var(--s2)]">
                <div className="flex flex-wrap items-center gap-[var(--s3)]">
                    <Segmented
                        options={[
                            { value: 'bu-ay', label: 'Bu ay' }, { value: '3-ay', label: 'Son 3 ay' },
                            { value: 'ybb', label: 'Yılbaşından' }, { value: '12-ay', label: 'Son 12 ay' },
                        ]}
                        value={period === 'ozel' ? '' : period}
                        onChange={(v) => setParam('donem', v)}
                    />
                    <span className="tnum" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{fmtDate(range.from)} – {fmtDate(range.to)}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-[var(--s3)]">
                    <div className="flex items-center gap-[var(--s2)]">
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>karşılaştır:</span>
                        <Segmented
                            options={[{ value: 'onceki', label: 'Önceki dönem' }, { value: 'gecen-yil', label: 'Geçen yıl' }]}
                            value={compare}
                            onChange={(v) => setParam('karsilastir', v)}
                        />
                    </div>
                    <label className="flex cursor-pointer items-center gap-[var(--s2)]" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                        Taksit & abonelikleri ayrı göster
                        <input type="checkbox" checked={splitRecurring} onChange={e => setParam('ayrik', e.target.checked ? '1' : '')} className="h-[15px] w-[15px]" style={{ accentColor: 'var(--accent)' }} />
                    </label>
                </div>
            </div>

            {!hasData ? (
                <EmptyState />
            ) : (
                <div className="flex flex-col gap-[var(--s3)]">
                    <NetCard result={result} cmp={cmp} compareLabel={compareLabel} onOpenPanel={openPanel} />
                    <div className="flex flex-col gap-[var(--s3)] lg:flex-row">
                        <div className="lg:flex-1"><FlowSideCard kind="expense" result={result} cmp={cmp} compareLabel={compareLabel} onOpenPanel={openPanel} interestCatId={interestCatId} /></div>
                        <div className="lg:flex-1"><FlowSideCard kind="income" result={result} cmp={cmp} compareLabel={compareLabel} onOpenPanel={openPanel} /></div>
                    </div>
                    <BreakdownCard result={result} categories={categories} />
                </div>
            )}

            {panelKind && (
                <FlowDetailPanel
                    kind={panelKind} month={panelMonth} result={panelResult} yearly={panelYearRows}
                    onKindChange={(k) => patchPanel({ panel: k })}
                    onMonthChange={(m) => patchPanel({ ay: m })}
                    onClose={closePanel}
                />
            )}
        </div>
    )
}

function CardLink({ href, label }: { href: string; label: string }) {
    return (
        <Link href={href} className="flex items-center gap-[2px] transition-colors hover:text-[var(--accent)]"
            style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            {label}<ArrowUpRight className="h-[12px] w-[12px]" />
        </Link>
    )
}

/** 2) Net gelir bloğu — net rakam + DeltaChip + sıfır çizgili aylık bar + karşılaştırma kesikli. */
function NetCard({ result, cmp, compareLabel, onOpenPanel }: { result: CashflowResult; cmp: CashflowResult; compareLabel: string; onOpenPanel: (kind: PanelKind, month: string) => void }) {
    const net = result.net
    const diff = net - cmp.net
    const pct = cmp.net !== 0 ? Math.round((diff / Math.abs(cmp.net)) * 100) : null

    const W = 600, H = 90, mid = H / 2
    const months = result.months
    const n = months.length
    const cmpNets = cmp.months.map(m => m.net)
    const maxAbs = Math.max(1, ...months.map(m => Math.abs(m.net)), ...cmpNets.map(Math.abs))
    const bw = n > 0 ? (W / n) * 0.6 : 0
    const xCenter = (i: number) => (i + 0.5) * (W / n)
    const barY = (v: number) => v >= 0 ? mid - (v / maxAbs) * mid : mid
    const barH = (v: number) => (Math.abs(v) / maxAbs) * mid
    // Karşılaştırma kesikli çizgi (indeks hizalı).
    const cmpLine = cmpNets.map((v, i) => `${xCenter(i).toFixed(1)},${(mid - (v / maxAbs) * mid).toFixed(1)}`).join(' ')

    const active = (i: number) => !months[i].isFuture && (months[i].income > 0 || months[i].expense > 0)
    const { ref, hover, width, handlers } = useBarHover(n, active, (i) => onOpenPanel('net', months[i].month))

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div className="mb-[var(--s3)] flex items-start justify-between">
                <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Net akış</div>
                    <div className="mt-[var(--s2)] flex flex-wrap items-baseline gap-x-[var(--s3)] gap-y-[2px]">
                        <span className="tnum" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: net >= 0 ? 'var(--flow-in)' : 'var(--flow-out)' }}>
                            {net >= 0 ? '+' : '−'}{formatTL(net)}
                        </span>
                        <DeltaChip value={diff} context={`${pct !== null ? `%${Math.abs(pct)} · ` : ''}${compareLabel} ${formatTL(cmp.net)}`} />
                    </div>
                </div>
                <CardLink href="/hareketler" label="Hareketler" />
            </div>

            <div ref={ref} className="relative touch-none cursor-pointer" {...handlers}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[90px] w-full" role="img" aria-label="Aylık net akış">
                    {/* Hover bandı — sütun genişliğinde, barların arkasında */}
                    {hover !== null && (
                        <rect x={hover * (W / n)} y={0} width={W / n} height={H} fill="var(--surface-2)" rx={2} />
                    )}
                    {months.map((m, i) => {
                        if (m.isFuture || (m.income === 0 && m.expense === 0)) return null
                        const x = xCenter(i) - bw / 2
                        const op = hover === null ? (m.isCurrent ? 0.5 : 1) : (i === hover ? 1 : 0.55)
                        return <rect key={m.month} x={x} y={barY(m.net)} width={bw} height={Math.max(1, barH(m.net))}
                            fill={m.net >= 0 ? 'var(--flow-in)' : 'var(--flow-out)'} opacity={op} rx={1} />
                    })}
                    {/* Sıfır çizgisi */}
                    <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--ink-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    {/* Karşılaştırma dönemi kesikli */}
                    {cmp.months.some(m => m.income || m.expense) && (
                        <polyline points={cmpLine} fill="none" stroke="var(--ink-4)" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                    )}
                </svg>
                {hover !== null && (
                    <FlowTooltip
                        n={n} index={hover} width={width}
                        title={monthLabel(months[hover].month)} total={months[hover].net}
                        totalColor={months[hover].net >= 0 ? 'var(--flow-in)' : 'var(--flow-out)'}
                        footer={
                            <div className="flex flex-col gap-[4px]">
                                <div className="flex items-center justify-between"><span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Giren</span><span className="tnum" style={{ fontSize: 12.5, color: 'var(--flow-in)' }}>{formatTL(months[hover].income)}</span></div>
                                <div className="flex items-center justify-between"><span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Çıkan</span><span className="tnum" style={{ fontSize: 12.5, color: 'var(--flow-out)' }}>{formatTL(months[hover].expense)}</span></div>
                            </div>
                        }
                    />
                )}
            </div>
            <MonthAxis months={months} />
        </section>
    )
}

/** 3) Harcama / Gelir kartı — toplam + DeltaChip + aylık bar (harcama yığılmış). */
function FlowSideCard({ kind, result, cmp, compareLabel, onOpenPanel, interestCatId }: { kind: 'expense' | 'income'; result: CashflowResult; cmp: CashflowResult; compareLabel: string; onOpenPanel: (kind: PanelKind, month: string) => void; interestCatId?: string | null }) {
    const isExp = kind === 'expense'
    const total = isExp ? result.totalExpense : result.totalIncome
    const cmpTotal = isExp ? cmp.totalExpense : cmp.totalIncome
    // İyilik yönü: gider AZALIŞI iyi (yeşil), gelir ARTIŞI iyi.
    const diff = isExp ? (cmpTotal - total) : (total - cmpTotal)
    const months = result.months
    const n = months.length
    const monthTotals = months.map(m => isExp ? m.expense : m.income)
    const maxV = Math.max(1, ...monthTotals)
    const cats = result.expenseCategories
    const sources = isExp ? result.expenseCategories : result.incomeSources

    const active = (i: number) => !months[i].isFuture && monthTotals[i] > 0
    const { ref, hover, width, handlers } = useBarHover(n, active, (i) => onOpenPanel(isExp ? 'harcama' : 'gelir', months[i].month))

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div className="mb-[var(--s3)] flex items-start justify-between">
                <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{isExp ? 'Harcama' : 'Gelir'}</div>
                    <div className="mt-[var(--s2)] flex flex-wrap items-baseline gap-x-[var(--s3)] gap-y-[2px]">
                        <span className="tnum" style={{ fontSize: 24, fontWeight: 600, color: isExp ? 'var(--flow-out)' : 'var(--flow-in)' }}>{formatTL(total)}</span>
                        {/* Ok = matematiksel değişim (total − önceki); renk/büyüklük = iyilik yönü (diff). */}
                        <DeltaChip value={diff} directionValue={total - cmpTotal} context={compareLabel} />
                    </div>
                </div>
                <CardLink href={isExp ? '/hareketler?tur=expense' : '/hareketler?tur=income'} label={isExp ? 'Giderler' : 'Gelirler'} />
            </div>

            <div ref={ref} className="relative touch-none cursor-pointer" {...handlers}>
                {/* Hover bandı — sütun genişliğinde, barların arkasında */}
                {hover !== null && (
                    <div className="absolute inset-y-0" style={{ left: `${(hover / n) * 100}%`, width: `${(1 / n) * 100}%`, background: 'var(--surface-2)', borderRadius: 2 }} aria-hidden />
                )}
                <div className="relative flex h-[64px] items-end gap-[4px]">
                    {months.map((m, i) => {
                        if (m.isFuture) return <div key={m.month} className="flex-1" />
                        const val = monthTotals[i]
                        const hPct = Math.max(val > 0 ? 3 : 0, (val / maxV) * 100)
                        const op = hover === null ? (m.isCurrent ? 0.5 : 1) : (i === hover ? 1 : 0.55)
                        if (isExp) {
                            return (
                                <div key={m.month} className="flex flex-1 flex-col-reverse overflow-hidden" style={{ height: `${hPct}%`, opacity: op, borderRadius: '2px' }}>
                                    {cats.map(c => c.monthly[i] > 0 && (
                                        <div key={c.key} style={{ height: `${(c.monthly[i] / Math.max(1, val)) * 100}%`, background: c.key === RECURRING_KEY ? 'var(--ink-3)' : categoryInk(c.label) }} />
                                    ))}
                                </div>
                            )
                        }
                        return <div key={m.month} className="flex-1" style={{ height: `${hPct}%`, background: 'var(--flow-in)', opacity: op, borderRadius: '2px' }} />
                    })}
                </div>
                {hover !== null && (
                    <FlowTooltip
                        n={n} index={hover} width={width}
                        title={monthLabel(months[hover].month)} total={monthTotals[hover]}
                        totalColor={isExp ? 'var(--flow-out)' : 'var(--flow-in)'}
                        rows={topRows(sources, hover, isExp ? 'Diğer kategoriler…' : 'Diğer kaynaklar…', isExp ? interestCatId : null)}
                    />
                )}
            </div>
            <MonthAxis months={months} />
        </section>
    )
}

/** Ay ekseni — içinde bulunulan ay "ŞİMDİ" + kalın. */
function MonthAxis({ months }: { months: CashflowResult['months'] }) {
    const dense = months.length > 12
    return (
        <div className="mt-[var(--s2)] flex gap-[4px]">
            {months.map(m => {
                const mo = Number(m.month.slice(5, 7)) - 1
                return (
                    <span key={m.month} className="flex-1 text-center" style={{ fontSize: 10, fontWeight: m.isCurrent ? 700 : 400, color: m.isCurrent ? 'var(--ink)' : 'var(--ink-3)' }}>
                        {m.isCurrent ? 'ŞİMDİ' : dense ? TR_MON_LETTER[mo] : TR_MON_SHORT[mo]}
                    </span>
                )
            })}
        </div>
    )
}

/** 4) Kırılım — gelir kaynakları üstte, gider kategorileri altta (parent gruplu). */
function BreakdownCard({ result, categories }: { result: CashflowResult; categories: BudgetCategoryMeta[] }) {
    // Gider kategorilerini parent'a göre grupla (computeBudgetTree deseni: safeParent).
    const grouped = useMemo(() => {
        const byId = new Map(categories.map(c => [c.id, c]))
        const nameById = new Map(categories.map(c => [c.id, (c as any).name as string]))
        const parents = new Map<string, { label: string; amount: number; children: CashflowCategory[] }>()
        const flat: CashflowCategory[] = []
        for (const c of result.expenseCategories) {
            const meta = byId.get(c.key)
            const pid = meta ? safeParent(meta, byId) : null
            if (pid) {
                let p = parents.get(pid)
                if (!p) { p = { label: nameById.get(pid) ?? 'Grup', amount: 0, children: [] }; parents.set(pid, p) }
                p.amount += c.amount
                p.children.push(c)
            } else {
                flat.push(c)
            }
        }
        const rows = [
            ...[...parents.entries()].map(([key, p]) => ({ key, label: p.label, amount: p.amount, children: p.children, parentId: key })),
            ...flat.map(c => ({ key: c.key, label: c.label, amount: c.amount, children: [] as CashflowCategory[], parentId: null as string | null })),
        ].sort((a, b) => b.amount - a.amount)
        return rows
    }, [result.expenseCategories, categories])

    const maxIn = Math.max(1, ...result.incomeSources.map(s => s.amount))
    const maxOut = Math.max(1, ...grouped.map(g => g.amount))

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }} className="mb-[var(--s3)]">Gelir kaynakları</div>
            <div className="flex flex-col gap-[var(--s3)]">
                {result.incomeSources.map(s => <Bar key={`in-${s.key}`} label={s.label} amount={s.amount} max={maxIn} color="var(--flow-in)" />)}
                {result.incomeSources.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Bu dönemde gelir yok.</p>}
            </div>

            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }} className="mb-[var(--s3)] mt-[var(--s5)] pt-[var(--s4)]">Gider kategorileri</div>
            <div className="flex flex-col gap-[var(--s3)]">
                {grouped.map(g => (
                    <div key={g.key}>
                        <Bar label={g.label} amount={g.amount} max={maxOut} color={categoryInk(g.label)}
                            href={g.parentId || (g.children.length === 0 && g.key.length > 20) ? `/kategoriler?kategori=${g.key}` : undefined}
                            icon />
                        {g.children.length > 0 && (
                            <div className="mt-[var(--s2)] flex flex-col gap-[var(--s2)] pl-[var(--s5)]">
                                {g.children.sort((a, b) => b.amount - a.amount).map(c => (
                                    <Link key={c.key} href={`/kategoriler?kategori=${c.key}`} className="flex items-center justify-between gap-[var(--s2)] transition-opacity hover:opacity-80">
                                        <span className="flex min-w-0 items-center gap-[var(--s2)]">
                                            <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: categoryInk(c.label) }} aria-hidden />
                                            <span className="truncate" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{c.label}</span>
                                        </span>
                                        <span className="tnum shrink-0" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{formatTL(c.amount)}</span>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                {grouped.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Bu dönemde gider yok.</p>}
            </div>
        </section>
    )
}

function Bar({ label, amount, max, color, href, icon }: { label: string; amount: number; max: number; color: string; href?: string; icon?: boolean }) {
    const body = (
        <>
            <div className="flex items-center justify-between gap-[var(--s2)] mb-[3px]">
                <span className="flex min-w-0 items-center gap-[var(--s2)]">
                    {icon && <CategoryTile name={label} size={20} />}
                    <span className="min-w-0 truncate" style={{ fontSize: 14, color: 'var(--ink)' }}>{label}</span>
                </span>
                <span className="tnum shrink-0" style={{ fontSize: 14, color: 'var(--ink)' }}>{formatTL(amount)}</span>
            </div>
            <div className="h-[6px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                <div className="h-full" style={{ width: `${(amount / max) * 100}%`, background: color, borderRadius: 'var(--r-bar)' }} />
            </div>
        </>
    )
    return href
        ? <Link href={href} className="block -mx-[var(--s1)] rounded-[var(--r-tile)] px-[var(--s1)] transition-colors hover:bg-[var(--fill-track)]">{body}</Link>
        : <div>{body}</div>
}

function EmptyState() {
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <p style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--ink)' }}>Bu dönemde akış yok.</p>
            <p className="mt-[var(--s2)]" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                Gelir ve gider kaydettikçe bu ekran seçili dönemin para akışını — nereden gelip nereye gittiğini — gösterecek.
            </p>
        </section>
    )
}
