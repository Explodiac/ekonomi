'use client'

import { useState, useEffect, useMemo } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, Pencil, Check, X, Plus } from "lucide-react"
import { categoryInk } from "@/components/dashboard/category-tile"
import { AccountIcon, shortAccount } from "@/components/dashboard/account-icon"
import { buildCategoryDetail, DETAIL_MONTHS, type CategoryDetail, type CategoryDetailTransaction, type ChildSeries } from "@/lib/category-detail"
import { fetchSettings } from "@/lib/settings"
import { KeyMetricsTable } from "@/components/categories/key-metrics"
import { TransactionModal } from "@/components/transactions/TransactionModal"

const TR_MONTH_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const TR_MONTH_LETTER = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A']

function formatTL(amount: number): string {
    const abs = Math.abs(Math.round(amount))
    const s = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs)
    return `${amount < 0 ? '−' : ''}${s} ₺`
}
function todayStr() { return new Date().toISOString().slice(0, 10) }
function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type FutureLoad = { month: string; total: number }

/**
 * Kategori detay paneli — /kategoriler sağ panelinde (ve mobil bottom sheet'te)
 * kullanılır. categoryId'ye göre kendi verisini çeker. Alt kategori pill'i ya da
 * lejant tıklanınca onSelectCategory ile seçim değişir (tek sayfa kuralı).
 * "Bütçeyi düzenle" satır içi giriş açar, budget_periods'a yazar, onChanged'ı çağırır.
 */
export function CategoryDetailPanel({
    categoryId,
    onSelectCategory,
    onChanged,
    bare,
}: {
    categoryId: string
    onSelectCategory?: (id: string) => void
    onChanged?: () => void
    bare?: boolean
}) {
    const [detail, setDetail] = useState<CategoryDetail | null>(null)
    const [future, setFuture] = useState<FutureLoad[]>([])
    const [accountById, setAccountById] = useState<Map<string, { name: string; type: string }>>(new Map())
    const [hhId, setHhId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [addOpen, setAddOpen] = useState(false)
    const currentMonth = todayStr().slice(0, 7)

    const load = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hh = await ensureHouseholdExists(user.id)
            if (!hh) return
            setHhId(hh)

            const [txRes, catRes, accRes, bpRes, hhRes] = await Promise.all([
                supabase.from('transactions')
                    .select('id, amount, type, cash_date, transaction_date, description, category_id, account_id, source_type, transfer_direction, categories(name)')
                    .eq('household_id', hh),
                supabase.from('categories').select('id, name, budget_limit, type, parent_id').eq('household_id', hh),
                supabase.from('accounts').select('id, name, type').eq('household_id', hh),
                supabase.from('budget_periods').select('category_id, period, budgeted').eq('household_id', hh),
                supabase.from('households').select('negative_carry').eq('id', hh).single(),
            ])
            const appSettings = await fetchSettings(supabase, hh)

            const transactions: CategoryDetailTransaction[] = (txRes.data || []).map((t: any) => ({ ...t, categoryName: t.categories?.name ?? null }))
            const cats = (catRes.data || []) as any[]
            const category = cats.find(c => c.id === categoryId) ?? null
            setAccountById(new Map((accRes.data || []).map((a: any) => [a.id, { name: a.name, type: a.type }])))

            const asOf = todayStr()
            setDetail(buildCategoryDetail({
                categoryId, category, transactions, currentMonth, asOf,
                categories: cats.map(c => ({ id: c.id, parent_id: c.parent_id, name: c.name })),
                budgetPeriods: (bpRes.data || []).map((b: any) => ({ categoryId: b.category_id, period: b.period, budgeted: Number(b.budgeted) })),
                negativeCarry: hhRes.data?.negative_carry ?? true,
                budgetInfoThreshold: appSettings ? appSettings.budgetAlertPct / 100 : undefined,
            }))

            const catSet = new Set<string>([categoryId, ...cats.filter(c => c.parent_id === categoryId).map(c => c.id)])
            const fmap = new Map<string, number>()
            for (const t of transactions) {
                if (t.type !== 'expense' || !t.cash_date || t.cash_date <= asOf) continue
                if (!t.category_id || !catSet.has(t.category_id)) continue
                const mk = t.cash_date.slice(0, 7)
                fmap.set(mk, (fmap.get(mk) ?? 0) + Math.abs(Number(t.amount)))
            }
            const fut: FutureLoad[] = []
            for (let i = 1; i <= 6; i++) {
                const mk = shiftMonth(currentMonth, i)
                fut.push({ month: mk, total: Math.round(fmap.get(mk) ?? 0) })
            }
            while (fut.length && fut[fut.length - 1].total === 0) fut.pop()
            setFuture(fut)
        } catch (e) {
            console.error('Kategori detayı hesaplanamadı:', e)
        } finally {
            setIsLoading(false)
        }
    }
    useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [categoryId])

    const saveBudget = async (value: number) => {
        if (!hhId) return
        try {
            await supabase.from('budget_periods').upsert(
                { household_id: hhId, category_id: categoryId, period: `${currentMonth}-01`, budgeted: value },
                { onConflict: 'household_id,category_id,period' },
            )
            await load()
            onChanged?.()
        } catch (e) {
            console.error('Bütçe kaydedilemedi:', e)
        }
    }

    const wrapCls = bare ? '' : 'rounded-[var(--r-card)]'
    const wrapStyle = bare ? {} : { background: 'transparent' }

    if (isLoading) {
        return <div className="flex items-center justify-center py-[var(--s7)]"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }
    if (!detail) {
        return <div className="rounded-[var(--r-card)] p-[22px]" style={{ background: 'var(--surface)', fontSize: 14, color: 'var(--ink-3)' }}>Bu kategori için veri bulunamadı.</div>
    }

    return (
        <div className={`flex flex-col gap-[var(--s3)] ${wrapCls}`} style={wrapStyle}>
            <TopBlock detail={detail} onSelectCategory={onSelectCategory} onSaveBudget={saveBudget} onAddExpense={() => setAddOpen(true)} />
            <SpendingChart detail={detail} future={future} onSelectCategory={onSelectCategory} />
            {detail.hasEnoughData && detail.yearly.length > 0 && <KeyMetricsTable yearly={detail.yearly} />}
            <TransactionsCard detail={detail} accountById={accountById} />

            {/* "Bu kategoriye harcama ekle" — kategori ön-seçili gider formu. */}
            <TransactionModal
                isOpen={addOpen}
                type="expense"
                initialCategoryId={categoryId}
                onClose={() => setAddOpen(false)}
                onSuccess={() => { setAddOpen(false); load(); onChanged?.() }}
            />
        </div>
    )
}

/** Üst blok: kimlik noktası + ad, sağda bu ay harcanan + kaldı, bütçe düzenle, parent pill'leri. */
function TopBlock({ detail, onSelectCategory, onSaveBudget, onAddExpense }: {
    detail: CategoryDetail
    onSelectCategory?: (id: string) => void
    onSaveBudget: (v: number) => void
    onAddExpense: () => void
}) {
    const monthName = TR_MONTH_SHORT[new Date().getMonth()]
    const budget = detail.budgetThisMonth
    const remaining = budget != null ? budget - detail.soFar : null
    const [editing, setEditing] = useState(false)
    const [value, setValue] = useState(String(budget ?? ''))
    useEffect(() => { setValue(String(budget ?? '')); setEditing(false) }, [detail.label, budget])

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div className="flex items-start justify-between gap-[var(--s4)]">
                <div className="flex min-w-0 items-center gap-[var(--s3)]">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: categoryInk(detail.label) }} aria-hidden />
                    <div className="min-w-0 truncate" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{detail.label}</div>
                </div>
                <div className="shrink-0 text-right">
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{monthName}&apos;ta harcanan</div>
                    <div className="tnum mt-[1px]" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>{formatTL(detail.soFar)}</div>
                    {remaining != null && (
                        <div className="tnum mt-[1px]" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                            {remaining >= 0 ? `${formatTL(remaining)} kaldı` : `${formatTL(Math.abs(remaining))} aşıldı`}
                        </div>
                    )}
                </div>
            </div>

            {/* Bütçeyi düzenle — satır içi */}
            <div className="mt-[var(--s3)]">
                {editing ? (
                    <div className="flex items-center gap-[var(--s2)]">
                        <div className="relative">
                            <input
                                autoFocus type="number" value={value} onChange={e => setValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { onSaveBudget(parseFloat(value) || 0); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
                                className="tnum h-8 w-32 pr-7 text-right outline-none"
                                style={{ background: 'var(--bg)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 13.5, border: '1px solid var(--border)' }}
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ fontSize: 12, color: 'var(--ink-3)' }}>₺</span>
                        </div>
                        <button onClick={() => { onSaveBudget(parseFloat(value) || 0); setEditing(false) }} className="icon-btn p-1.5" style={{ color: 'var(--flow-in)' }} aria-label="Kaydet"><Check className="h-4 w-4" /></button>
                        <button onClick={() => setEditing(false)} className="icon-btn p-1.5" aria-label="Vazgeç"><X className="h-4 w-4" /></button>
                    </div>
                ) : (
                    <button onClick={() => setEditing(true)} className="inline-flex items-center gap-[5px] transition-colors hover:text-[var(--accent)]" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                        <Pencil className="h-[13px] w-[13px]" /> {budget != null ? 'Bütçeyi düzenle' : 'Bütçe ekle'}
                    </button>
                )}
            </div>

            {/* Parent ise: alt kategori pill'leri */}
            {detail.isParent && detail.children.length > 0 && (
                <div className="mt-[var(--s3)] flex flex-wrap gap-[var(--s2)]">
                    {detail.children.map(c => {
                        const ink = categoryInk(c.label)
                        return (
                            <button
                                key={c.categoryId}
                                onClick={() => onSelectCategory?.(c.categoryId)}
                                className="inline-flex items-center gap-[5px] px-[9px] py-[4px]"
                                style={{ background: `color-mix(in srgb, ${ink} 15%, transparent)`, color: ink, borderRadius: 'var(--r-pill)', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase' }}
                            >
                                <span className="h-[7px] w-[7px] rounded-full" style={{ background: ink }} />
                                {c.label}
                            </button>
                        )
                    })}
                </div>
            )}

            {/* Birincil aksiyon: bu kategoriye doğrudan harcama ekle (kategori ön-seçili). */}
            <button
                onClick={onAddExpense}
                className="mt-[var(--s4)] flex w-full items-center justify-center gap-[6px] py-[var(--s3)] transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', borderRadius: 'var(--r-button)', color: '#fff', fontSize: 14, fontWeight: 600 }}
            >
                <Plus className="h-4 w-4" /> Bu kategoriye harcama ekle
            </button>
        </section>
    )
}

/** Zaman serisi bar grafik: geçmiş dolu, bu ay dikey imleçle, gelecek kesikli.
 *  Üstte bütçe çizgisi + sağ ucunda bayrak etiketi. Parent'ta yığılmış + lejant. */
function SpendingChart({ detail, future, onSelectCategory }: {
    detail: CategoryDetail
    future: FutureLoad[]
    onSelectCategory?: (id: string) => void
}) {
    const [visibleMonths, setVisibleMonths] = useState(DETAIL_MONTHS)
    useEffect(() => {
        const apply = () => setVisibleMonths(window.innerWidth < 640 ? 12 : DETAIL_MONTHS)
        apply()
        window.addEventListener('resize', apply)
        return () => window.removeEventListener('resize', apply)
    }, [])

    const H = 128
    const start = Math.max(0, DETAIL_MONTHS - visibleMonths)
    const past = detail.byMonth.slice(start)
    const identityColor = categoryInk(detail.label)

    const segmentsOf = (monthAbsIdx: number): { color: string; amount: number }[] => {
        if (!detail.isParent) return [{ color: identityColor, amount: detail.byMonth[monthAbsIdx].total }]
        const segs = detail.children.map(c => ({ color: categoryInk(c.label), amount: c.byMonth[monthAbsIdx] }))
        const own = detail.ownByMonth[monthAbsIdx]
        if (own > 0) segs.push({ color: categoryInk(detail.label), amount: own })
        return segs.filter(s => s.amount > 0)
    }

    const budget = detail.budgetThisMonth
    const maxV = Math.max(1, ...past.map(m => m.total), ...future.map(f => f.total), budget ?? 0)
    const nBars = past.length + future.length
    const curBarIdx = past.findIndex(m => m.isCurrent)

    const legend: (ChildSeries & { windowTotal: number })[] = detail.isParent
        ? detail.children.map(c => ({ ...c, windowTotal: c.byMonth.slice(start).reduce((s, v) => s + v, 0) })).filter(c => c.windowTotal > 0)
        : []

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div className="mb-[var(--s4)] flex items-baseline justify-between">
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Zaman içinde</span>
            </div>

            <div className="relative" style={{ height: H }}>
                {/* Bütçe çizgisi + sağ uç bayrağı */}
                {budget != null && budget > 0 && (
                    <>
                        <div className="absolute inset-x-0" style={{ top: (1 - budget / maxV) * H, borderTop: '1px dashed var(--ink-3)' }} aria-hidden />
                        <div
                            className="tnum absolute -translate-y-1/2 whitespace-nowrap py-[2px] pl-[8px] pr-[6px]"
                            style={{
                                right: 0, top: (1 - budget / maxV) * H,
                                fontSize: 10.5, fontWeight: 600, color: 'var(--surface)', background: 'var(--ink-3)',
                                borderRadius: '3px', clipPath: 'polygon(8px 0, 100% 0, 100% 100%, 8px 100%, 0 50%)',
                            }}
                        >
                            {formatTL(budget)}
                        </div>
                    </>
                )}

                {/* Bu ay dikey imleci — beyaz çerçeve */}
                {curBarIdx >= 0 && (
                    <div
                        className="absolute top-0 bottom-0 rounded-[3px]"
                        style={{ left: `${(curBarIdx / nBars) * 100}%`, width: `${(1 / nBars) * 100}%`, border: '1.5px solid var(--ink)', opacity: 0.5 }}
                        aria-hidden
                    />
                )}

                <div className="flex h-full items-end gap-[3px]">
                    {past.map((m, i) => {
                        const segs = segmentsOf(start + i)
                        return (
                            <div key={m.month} className="flex flex-1 flex-col-reverse overflow-hidden"
                                style={{ height: `${Math.max(m.total > 0 ? 3 : 0, (m.total / maxV) * 100)}%`, borderRadius: '2px' }}>
                                {segs.map((s, si) => (
                                    <div key={si} style={{ height: `${(s.amount / Math.max(1, m.total)) * 100}%`, background: s.color }} />
                                ))}
                            </div>
                        )
                    })}
                    {future.map(f => (
                        <div key={f.month} className="flex-1"
                            style={{ height: `${Math.max(3, (f.total / maxV) * 100)}%`, border: '1px dashed var(--ink-4)', borderRadius: '2px' }}
                            title={`Planlı ${formatTL(f.total)}`} />
                    ))}
                </div>
            </div>

            {/* Ay ekseni */}
            <div className="mt-[var(--s2)] flex gap-[3px]">
                {past.map(m => (
                    <span key={m.month} className="flex-1 text-center" style={{ fontSize: 10, fontWeight: m.isCurrent ? 700 : 400, color: m.isCurrent ? 'var(--ink)' : 'var(--ink-3)' }}>
                        {TR_MONTH_LETTER[Number(m.month.slice(5, 7)) - 1]}
                    </span>
                ))}
                {future.map(f => (
                    <span key={f.month} className="flex-1 text-center" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                        {TR_MONTH_LETTER[Number(f.month.slice(5, 7)) - 1]}
                    </span>
                ))}
            </div>

            {/* Lejant — alt kategoriler; tıklanınca panelde o kategoriye geç */}
            {legend.length > 0 && (
                <div className="mt-[var(--s4)] flex flex-col gap-[var(--s2)] pt-[var(--s3)]" style={{ borderTop: '1px solid var(--border)' }}>
                    {legend.map(c => (
                        <button key={c.categoryId} onClick={() => onSelectCategory?.(c.categoryId)} className="flex items-center justify-between gap-[var(--s2)] transition-opacity hover:opacity-80">
                            <span className="flex min-w-0 items-center gap-[var(--s2)]">
                                <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: categoryInk(c.label) }} aria-hidden />
                                <span className="truncate" style={{ fontSize: 13.5, color: 'var(--ink)' }}>{c.label}</span>
                            </span>
                            <span className="tnum shrink-0" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{formatTL(c.windowTotal)}</span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    )
}

function TransactionsCard({ detail, accountById }: { detail: CategoryDetail; accountById: Map<string, { name: string; type: string }> }) {
    const groups = useMemo(() => {
        const map = new Map<string, CategoryDetailTransaction[]>()
        for (const t of detail.recentTransactions) {
            const mk = (t.transaction_date || t.cash_date).slice(0, 7)
            const g = map.get(mk) ?? []
            g.push(t); map.set(mk, g)
        }
        return [...map.entries()]
    }, [detail.recentTransactions])

    if (detail.recentTransactions.length === 0) {
        return <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]"><p style={{ fontSize: 14.5, color: 'var(--ink-3)' }}>Bu kategoride hareket yok.</p></section>
    }
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="overflow-hidden py-[var(--s2)]">
            {groups.map(([mk, rows]) => (
                <div key={mk}>
                    <div className="px-[22px] pb-[var(--s1)] pt-[var(--s3)]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--ink-3)' }}>
                        {TR_MONTH_SHORT[Number(mk.slice(5, 7)) - 1].toUpperCase()} {mk.slice(0, 4)}
                    </div>
                    <ul>
                        {rows.map((t, i) => <Row key={String(t.id ?? i)} t={t} account={t.account_id ? accountById.get(t.account_id) : undefined} />)}
                    </ul>
                </div>
            ))}
        </section>
    )
}

function Row({ t, account }: { t: CategoryDetailTransaction; account?: { name: string; type: string } }) {
    const shownDate = (t.transaction_date || t.cash_date)
    const day = Number(shownDate.slice(8, 10))
    const monthShort = TR_MONTH_SHORT[Number(shownDate.slice(5, 7)) - 1]
    const isIncome = t.type === 'income'
    const isTransfer = t.type === 'transfer'
    const sub = [`${day} ${monthShort}`, shortAccount(account?.name)].filter(Boolean).join(' · ')
    return (
        <li className="flex items-center gap-[var(--s3)] px-[22px] py-[11px]">
            <AccountIcon type={account?.type} />
            <div className="flex min-w-0 flex-1 items-center gap-[var(--s2)]">
                {t.source_type && (
                    <span className="inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center" style={{ background: 'var(--fill-track)', color: 'var(--ink-3)', borderRadius: 5, fontSize: 10, fontWeight: 700 }} title="Düzenli / taksitli">R</span>
                )}
                <span className="shrink-0 truncate" style={{ fontSize: 14.5, color: 'var(--ink)', maxWidth: '55%' }}>{t.description || 'Hareket'}</span>
                <span className="truncate" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{sub}</span>
            </div>
            <span className="tnum shrink-0" style={{ fontSize: 14.5, fontWeight: 600, color: isTransfer ? 'var(--ink-3)' : 'var(--ink)' }}>
                {isIncome ? '+' : ''}{formatTL(Number(t.amount))}
            </span>
        </li>
    )
}
