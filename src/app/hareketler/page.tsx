'use client'

import { useState, useEffect, useMemo, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, SlidersHorizontal, ArrowUpDown, Search, Plus, X } from "lucide-react"
import { CategoryPill } from "@/components/dashboard/category-tile"
import { AccountIcon, shortAccount } from "@/components/dashboard/account-icon"
import { QuickEntry } from "@/components/dashboard/quick-entry"
import { Segmented } from "@/components/ui/segmented"
import { TransactionDetail } from "@/components/transactions/transaction-detail"
import { useIsDesktop } from "@/hooks/use-is-desktop"

function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(amount)))} ₺`
}
function todayISO() { return new Date().toISOString().slice(0, 10) }

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const TR_DAYS_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']

/** cash_date → "BUGÜN" / "DÜN" / "9 AĞUSTOS PZR" (farklı yılsa yıl eklenir), uppercase. */
function dayLabel(cashDate: string, todayStr: string): string {
    if (cashDate === todayStr) return 'BUGÜN'
    const [ty, tm, td] = todayStr.split('-').map(Number)
    const yst = new Date(ty, tm - 1, td - 1)
    const yStr = `${yst.getFullYear()}-${String(yst.getMonth() + 1).padStart(2, '0')}-${String(yst.getDate()).padStart(2, '0')}`
    if (cashDate === yStr) return 'DÜN'
    const [y, mo, dd] = cashDate.split('-').map(Number)
    const dow = TR_DAYS_SHORT[new Date(y, mo - 1, dd).getDay()]
    const yearPart = y !== ty ? ` ${y}` : ''
    return `${dd} ${TR_MONTHS[mo - 1]}${yearPart} ${dow}`.toUpperCase()
}

type Tx = {
    id: string
    amount: number
    type: string
    transaction_date: string
    cash_date: string
    description?: string | null
    note?: string | null
    category_id?: string | null
    categoryName?: string | null
    account_id: string | null
    source_type?: string | null
    source_id?: string | null
    transfer_group_id?: string | null
    transfer_direction?: string | null
}

type TypeFilter = 'all' | 'expense' | 'income'
type SortKey = 'tarih-yeni' | 'tarih-eski' | 'tutar-buyuk' | 'tutar-kucuk'
const PAGE_SIZE = 40

export default function HareketlerPage() {
    // useSearchParams Suspense sınırı gerektirir.
    return (
        <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>}>
            <HareketlerInner />
        </Suspense>
    )
}

function HareketlerInner() {
    const router = useRouter()
    const params = useSearchParams()

    const [txs, setTxs] = useState<Tx[]>([])
    const [accounts, setAccounts] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [visible, setVisible] = useState(PAGE_SIZE)
    const [budgetPeriods, setBudgetPeriods] = useState<{ categoryId: string; period: string; budgeted: number }[]>([])
    const [negativeCarry, setNegativeCarry] = useState(true)

    const [selectedId, setSelectedId] = useState<string | null>(null)
    const isDesktop = useIsDesktop()
    const [showAdd, setShowAdd] = useState(false)
    const [showSearch, setShowSearch] = useState(false)

    // Filtre + sıralama + arama durumu URL'de: paylaşılabilir, geri-gel çalışır.
    const typeFilter = (params.get('tur') as TypeFilter) || 'all'
    const catFilter = params.get('kategori') || ''
    const accFilter = params.get('hesap') || ''
    const fromDate = params.get('baslangic') || ''
    const toDate = params.get('bitis') || ''
    const sortKey = (params.get('sirala') as SortKey) || 'tarih-yeni'
    const query = params.get('q') || ''
    const showFuture = params.get('gelecek') === '1'

    const setParam = (key: string, value: string) => {
        const next = new URLSearchParams(params.toString())
        if (value) next.set(key, value); else next.delete(key)
        router.replace(`/hareketler?${next.toString()}`, { scroll: false })
        setVisible(PAGE_SIZE)
    }

    const activeFilterCount =
        (typeFilter !== 'all' ? 1 : 0) + (catFilter ? 1 : 0) + (accFilter ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0)

    const fetchData = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return
            const [txRes, accRes, catRes, bpRes, hhRes] = await Promise.all([
                supabase.from('transactions')
                    .select('id, amount, type, transaction_date, cash_date, description, note, category_id, account_id, source_type, spend_nature, source_id, transfer_group_id, transfer_direction, categories(name)')
                    .eq('household_id', hhId),
                supabase.from('accounts').select('id, name, type, balance, cut_date, due_date').eq('household_id', hhId),
                supabase.from('categories').select('id, name, budget_limit, type, default_nature').eq('household_id', hhId),
                supabase.from('budget_periods').select('category_id, period, budgeted').eq('household_id', hhId),
                supabase.from('households').select('negative_carry').eq('id', hhId).single(),
            ])
            setTxs((txRes.data || []).map((t: any) => ({ ...t, categoryName: t.categories?.name ?? null })))
            setAccounts(accRes.data || [])
            setCategories(catRes.data || [])
            setBudgetPeriods((bpRes.data || []).map((b: any) => ({ categoryId: b.category_id, period: b.period, budgeted: Number(b.budgeted) })))
            setNegativeCarry(hhRes.data?.negative_carry ?? true)
        } catch (error) {
            console.error("Hareketler alınamadı:", error)
        } finally {
            setIsLoading(false)
        }
    }
    useEffect(() => { fetchData() }, [])

    const accountById = useMemo(
        () => new Map(accounts.map((a: any) => [a.id, { name: a.name as string, type: a.type as string }])),
        [accounts]
    )

    const filtered = useMemo(() => {
        const q = query.trim().toLocaleLowerCase('tr')
        const rows = txs.filter(t => {
            if (!t.cash_date) return false
            if (typeFilter === 'expense' && t.type !== 'expense') return false
            if (typeFilter === 'income' && t.type !== 'income') return false
            if (catFilter && t.category_id !== catFilter) return false
            if (accFilter && t.account_id !== accFilter) return false
            if (fromDate && t.cash_date < fromDate) return false
            if (toDate && t.cash_date > toDate) return false
            if (q) {
                const hay = `${t.description ?? ''} ${t.categoryName ?? ''}`.toLocaleLowerCase('tr')
                if (!hay.includes(q)) return false
            }
            return true
        })
        rows.sort((a, b) => {
            switch (sortKey) {
                case 'tarih-eski': return a.cash_date.localeCompare(b.cash_date)
                case 'tutar-buyuk': return Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))
                case 'tutar-kucuk': return Math.abs(Number(a.amount)) - Math.abs(Number(b.amount))
                default: return b.cash_date.localeCompare(a.cash_date)
            }
        })
        return rows
    }, [txs, typeFilter, catFilter, accFilter, fromDate, toDate, sortKey, query])

    const todayStr = todayISO()

    // Varsayılan yalnız GERÇEKLEŞMİŞ (cash_date <= bugün). "gelecek=1" → planlananlar da.
    const pastRows = useMemo(() => filtered.filter(t => t.cash_date <= todayStr), [filtered, todayStr])
    const futureRows = useMemo(() => showFuture ? filtered.filter(t => t.cash_date > todayStr) : [], [filtered, showFuture, todayStr])

    // GÜNLÜK grupla (aylık net toplam yok — akıcı liste). Gerçekleşenlerde sayfalama.
    const groupByDay = (rows: Tx[]) => {
        const map = new Map<string, Tx[]>()
        for (const t of rows) {
            const key = t.cash_date.slice(0, 10)
            const g = map.get(key) ?? []
            g.push(t)
            map.set(key, g)
        }
        return [...map.entries()]
    }
    const pastGroups = useMemo(() => groupByDay(pastRows.slice(0, visible)), [pastRows, visible])
    const futureGroups = useMemo(() => groupByDay(futureRows), [futureRows])

    const selectedTx = useMemo(() => txs.find(t => t.id === selectedId) ?? null, [txs, selectedId])

    // Açılışta en yeni hareket varsayılan seçili (masaüstü; mobilde sheet açılmasın).
    useEffect(() => {
        if (selectedId || !isDesktop) return
        const first = pastRows[0] ?? futureRows[0]
        if (first) setSelectedId(first.id)
    }, [pastRows, futureRows, selectedId, isDesktop])

    if (isLoading) {
        return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }

    const totalShown = pastRows.length + futureRows.length

    const listRows = (dateKey: string, rows: Tx[], faded = false) => (
        <div key={`${faded ? 'f' : 'p'}-${dateKey}`}>
            <div className="px-[22px] pb-[var(--s1)] pt-[var(--s3)]"
                style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--ink-3)' }}>
                {dayLabel(dateKey, todayStr)}
            </div>
            <ul>
                {rows.map(t => (
                    <Row
                        key={t.id} t={t}
                        account={t.account_id ? accountById.get(t.account_id) : undefined}
                        selected={t.id === selectedId}
                        onSelect={() => setSelectedId(t.id)}
                        faded={faded}
                    />
                ))}
            </ul>
        </div>
    )

    return (
        <div className="w-full pb-10">
            {/* Üst bar: başlık + Filtre + Sırala + Ara + Ekle */}
            <div className="mb-[var(--s3)] flex items-center gap-[var(--s2)]">
                <h1 className="flex-1" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                    Tüm hareketler
                </h1>

                <FilterButton
                    activeCount={activeFilterCount}
                    typeFilter={typeFilter} catFilter={catFilter} accFilter={accFilter} fromDate={fromDate} toDate={toDate} showFuture={showFuture}
                    categories={categories} accounts={accounts} setParam={setParam}
                />
                <SortButton sortKey={sortKey} setParam={setParam} />
                <IconBtn label="Ara" onClick={() => setShowSearch(s => !s)} active={showSearch || !!query}>
                    <Search className="h-[16px] w-[16px]" />
                </IconBtn>
                <IconBtn label="Ekle" onClick={() => setShowAdd(s => !s)} active={showAdd}>
                    <Plus className="h-[16px] w-[16px]" />
                </IconBtn>
            </div>

            {showSearch && (
                <div className="mb-[var(--s3)] flex items-center gap-[var(--s2)] px-[var(--s3)] py-[var(--s2)]"
                    style={{ background: 'var(--surface)', borderRadius: 'var(--r-button)' }}>
                    <Search className="h-[15px] w-[15px] shrink-0" style={{ color: 'var(--ink-3)' }} />
                    <input
                        autoFocus type="text" value={query} placeholder="Açıklama veya kategori ara…"
                        onChange={e => setParam('q', e.target.value)}
                        className="min-w-0 flex-1 bg-transparent outline-none"
                        style={{ fontSize: 14, color: 'var(--ink)' }}
                    />
                    {query && (
                        <button onClick={() => setParam('q', '')} aria-label="Temizle"><X className="h-[15px] w-[15px]" style={{ color: 'var(--ink-3)' }} /></button>
                    )}
                </div>
            )}

            {showAdd && (
                <div className="mb-[var(--s4)]">
                    <QuickEntry
                        accounts={accounts}
                        categories={categories}
                        transactions={txs}
                        currentMonthKey={todayISO().slice(0, 7)}
                        onSuccess={() => { fetchData(); setShowAdd(false) }}
                        budgetPeriods={budgetPeriods}
                        negativeCarry={negativeCarry}
                    />
                </div>
            )}

            {/* İki panel: liste (esner) + detay (masaüstü sabit 420px) */}
            <div className="flex items-start gap-[var(--s3)]">
                <div className="min-w-0 flex-1">
                    {totalShown === 0 ? (
                        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                            <p style={{ fontSize: 14.5, color: 'var(--ink-3)' }}>Bu filtreyle hareket yok.</p>
                        </section>
                    ) : (
                        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="overflow-hidden py-[var(--s2)]">
                            {/* Planlanan (gelecek) — soluk, ayraçlı */}
                            {futureGroups.length > 0 && (
                                <>
                                    <div className="px-[22px] pb-[var(--s1)] pt-[var(--s2)]"
                                        style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ink-3)' }}>
                                        PLANLANAN
                                    </div>
                                    {futureGroups.map(([dateKey, rows]) => listRows(dateKey, rows, true))}
                                    <div className="mx-[22px] my-[var(--s2)] h-px" style={{ background: 'var(--border)' }} />
                                </>
                            )}

                            {pastGroups.map(([dateKey, rows]) => listRows(dateKey, rows, false))}

                            {visible < pastRows.length && (
                                <div className="px-[22px] pt-[var(--s2)]">
                                    <button
                                        onClick={() => setVisible(v => v + PAGE_SIZE)}
                                        style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--accent)' }}
                                    >
                                        Daha fazla göster ({pastRows.length - visible})
                                    </button>
                                </div>
                            )}
                        </section>
                    )}
                </div>

                {/* Masaüstü yan panel */}
                <aside className="hidden w-[420px] shrink-0 lg:block">
                    <div className="sticky top-[var(--s3)]" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                        {selectedTx ? (
                            <TransactionDetail
                                key={selectedTx.id}
                                tx={selectedTx} accounts={accounts} categories={categories} allTxs={txs}
                                onChanged={fetchData} onClose={() => setSelectedId(null)}
                            />
                        ) : (
                            <div className="flex h-[280px] items-center justify-center px-[22px] text-center" style={{ fontSize: 14, color: 'var(--ink-3)' }}>
                                Bir hareket seç
                            </div>
                        )}
                    </div>
                </aside>
            </div>

            {/* Mobil: tam ekran bottom sheet */}
            {selectedTx && (
                <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setSelectedId(null)}>
                    <div className="max-h-[90vh] overflow-y-auto" style={{ background: 'var(--surface)', borderTopLeftRadius: 'var(--r-card)', borderTopRightRadius: 'var(--r-card)' }} onClick={e => e.stopPropagation()}>
                        <TransactionDetail
                            key={selectedTx.id}
                            tx={selectedTx} accounts={accounts} categories={categories} allTxs={txs}
                            onChanged={fetchData} onClose={() => setSelectedId(null)}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}

/** Aboneliğe/taksite bağlı hareket rozeti (source_type dolu). Küçük, nötr. */
function RecurringBadge() {
    return (
        <span
            className="inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center"
            style={{ background: 'var(--fill-track)', color: 'var(--ink-3)', borderRadius: 5, fontSize: 10, fontWeight: 700 }}
            title="Düzenli / taksitli hareket"
            aria-hidden
        >
            R
        </span>
    )
}

/** Liste satırı: [hesap ikonu] [R] Açıklama · hesap — [PILL] — tutar. Seçili: --surface-2 + accent kenar.
 *  faded: gelecek planlı satır (soluk). */
function Row({ t, account, selected, onSelect, faded }: {
    t: Tx
    account?: { name: string; type: string }
    selected: boolean
    onSelect: () => void
    faded?: boolean
}) {
    const isTransfer = t.type === 'transfer'
    const accShort = shortAccount(account?.name)
    return (
        <li>
            <button
                type="button" onClick={onSelect}
                className="flex w-full items-center gap-[var(--s3)] px-[22px] py-[11px] text-left transition-colors"
                style={{
                    background: selected ? 'var(--surface-2)' : 'transparent',
                    boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : 'none',
                    opacity: faded ? 0.5 : 1,
                }}
            >
                <AccountIcon type={account?.type} />
                <div className="flex min-w-0 flex-1 items-center gap-[var(--s2)]">
                    {t.source_type && <RecurringBadge />}
                    <span className="shrink-0 truncate" style={{ fontSize: 14.5, color: 'var(--ink)', maxWidth: '60%' }}>
                        {t.description || t.categoryName || 'Hareket'}
                    </span>
                    {accShort && <span className="truncate" style={{ fontSize: 13, color: 'var(--ink-3)' }}>{accShort}</span>}
                </div>
                {!isTransfer && t.categoryName && <CategoryPill name={t.categoryName} />}
                <span className="tnum shrink-0" style={{ fontSize: 14.5, fontWeight: 600, color: isTransfer ? 'var(--ink-3)' : 'var(--ink)' }}>
                    {t.type === 'income' ? '+' : ''}{formatTL(Number(t.amount))}
                </span>
            </button>
        </li>
    )
}

/** Üst bar ikon düğmesi. */
function IconBtn({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
    return (
        <button
            type="button" onClick={onClick} aria-label={label}
            className="inline-flex h-[34px] w-[34px] items-center justify-center transition-colors"
            style={{ background: active ? 'var(--accent-bg)' : 'var(--surface)', color: active ? 'var(--accent)' : 'var(--ink-2)', borderRadius: 'var(--r-button)' }}
        >
            {children}
        </button>
    )
}

/** Popover sarmalayıcı — dışına tıklayınca kapanır. */
function Popover({ open, onClose, children, align = 'right' }: { open: boolean; onClose: () => void; children: React.ReactNode; align?: 'left' | 'right' }) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return
        const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
    }, [open, onClose])
    if (!open) return null
    return (
        <div
            ref={ref}
            className="absolute top-[calc(100%+6px)] z-30 w-[280px] p-[var(--s4)]"
            style={{ [align]: 0, background: 'var(--surface-2)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', boxShadow: '0 12px 32px rgba(0,0,0,0.35)' }}
        >
            {children}
        </div>
    )
}

function FilterButton({ activeCount, typeFilter, catFilter, accFilter, fromDate, toDate, showFuture, categories, accounts, setParam }: {
    activeCount: number
    typeFilter: TypeFilter; catFilter: string; accFilter: string; fromDate: string; toDate: string; showFuture: boolean
    categories: any[]; accounts: any[]
    setParam: (k: string, v: string) => void
}) {
    const [open, setOpen] = useState(false)
    const expenseCats = categories.filter(c => c.type === 'expense')
    const selectStyle = { fontSize: 13, borderRadius: 'var(--r-button)', background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)' } as const

    return (
        <div className="relative">
            <button
                type="button" onClick={() => setOpen(o => !o)}
                className="inline-flex h-[34px] items-center gap-[var(--s2)] px-[var(--s3)] transition-colors"
                style={{ background: activeCount ? 'var(--accent-bg)' : 'var(--surface)', color: activeCount ? 'var(--accent)' : 'var(--ink-2)', borderRadius: 'var(--r-button)', fontSize: 13, fontWeight: 500 }}
            >
                <SlidersHorizontal className="h-[15px] w-[15px]" />
                Filtre
                {activeCount > 0 && (
                    <span className="tnum inline-flex h-[17px] min-w-[17px] items-center justify-center px-[4px]"
                        style={{ background: 'var(--accent)', color: '#fff', borderRadius: 999, fontSize: 10.5, fontWeight: 700 }}>
                        {activeCount}
                    </span>
                )}
            </button>

            <Popover open={open} onClose={() => setOpen(false)}>
                <div className="flex flex-col gap-[var(--s4)]">
                    <div>
                        <FilterLabel>Tür</FilterLabel>
                        <Segmented
                            options={[{ value: 'all', label: 'Tümü' }, { value: 'expense', label: 'Gider' }, { value: 'income', label: 'Gelir' }]}
                            value={typeFilter}
                            onChange={(v) => setParam('tur', v === 'all' ? '' : v)}
                        />
                    </div>
                    <div>
                        <FilterLabel>Kategori</FilterLabel>
                        <select value={catFilter} onChange={e => setParam('kategori', e.target.value)}
                            className="w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={selectStyle}>
                            <option value="">Tüm kategoriler</option>
                            {expenseCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <FilterLabel>Hesap</FilterLabel>
                        <select value={accFilter} onChange={e => setParam('hesap', e.target.value)}
                            className="w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={selectStyle}>
                            <option value="">Tüm hesaplar</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <FilterLabel>Tarih aralığı</FilterLabel>
                        <div className="flex items-center gap-[var(--s2)]">
                            <input type="date" value={fromDate} onChange={e => setParam('baslangic', e.target.value)}
                                className="min-w-0 flex-1 px-[var(--s2)] py-[var(--s2)] outline-none" style={selectStyle} />
                            <span style={{ color: 'var(--ink-3)' }}>–</span>
                            <input type="date" value={toDate} onChange={e => setParam('bitis', e.target.value)}
                                className="min-w-0 flex-1 px-[var(--s2)] py-[var(--s2)] outline-none" style={selectStyle} />
                        </div>
                    </div>
                    <label className="flex cursor-pointer items-center justify-between gap-[var(--s2)]" style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                        Gelecek planlı ödemeleri göster
                        <input type="checkbox" checked={showFuture} onChange={e => setParam('gelecek', e.target.checked ? '1' : '')} className="h-[16px] w-[16px]" style={{ accentColor: 'var(--accent)' }} />
                    </label>
                    {activeCount > 0 && (
                        <button
                            onClick={() => { setParam('tur', ''); setParam('kategori', ''); setParam('hesap', ''); setParam('baslangic', ''); setParam('bitis', '') }}
                            className="self-start" style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}
                        >
                            Filtreleri temizle
                        </button>
                    )}
                </div>
            </Popover>
        </div>
    )
}

function FilterLabel({ children }: { children: React.ReactNode }) {
    return <div className="mb-[var(--s2)]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{children}</div>
}

function SortButton({ sortKey, setParam }: { sortKey: SortKey; setParam: (k: string, v: string) => void }) {
    const [open, setOpen] = useState(false)
    const options: { key: SortKey; label: string }[] = [
        { key: 'tarih-yeni', label: 'Tarih (yeni → eski)' },
        { key: 'tarih-eski', label: 'Tarih (eski → yeni)' },
        { key: 'tutar-buyuk', label: 'Tutar (büyük → küçük)' },
        { key: 'tutar-kucuk', label: 'Tutar (küçük → büyük)' },
    ]
    return (
        <div className="relative">
            <button
                type="button" onClick={() => setOpen(o => !o)}
                className="inline-flex h-[34px] items-center gap-[var(--s2)] px-[var(--s3)] transition-colors"
                style={{ background: 'var(--surface)', color: 'var(--ink-2)', borderRadius: 'var(--r-button)', fontSize: 13, fontWeight: 500 }}
            >
                <ArrowUpDown className="h-[15px] w-[15px]" />
                Sırala
            </button>
            <Popover open={open} onClose={() => setOpen(false)}>
                <div className="flex flex-col gap-[2px]">
                    {options.map(o => {
                        const on = o.key === sortKey
                        return (
                            <button
                                key={o.key}
                                onClick={() => { setParam('sirala', o.key === 'tarih-yeni' ? '' : o.key); setOpen(false) }}
                                className="px-[var(--s3)] py-[var(--s2)] text-left transition-colors"
                                style={{ fontSize: 13.5, borderRadius: 'var(--r-button)', background: on ? 'var(--accent-bg)' : 'transparent', color: on ? 'var(--accent)' : 'var(--ink-2)', fontWeight: on ? 600 : 400 }}
                            >
                                {o.label}
                            </button>
                        )
                    })}
                </div>
            </Popover>
        </div>
    )
}
