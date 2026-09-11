"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { NetWorthSummary } from "@/components/varlik/net-worth-summary"
import { PageHeader } from "@/components/ui/page-header"
import { PrimaryButton } from "@/components/ui/primary-button"
import { Segmented } from "@/components/ui/segmented"
import { DeltaChip } from "@/components/ui/delta-chip"
import { AccountIcon } from "@/components/dashboard/account-icon"
import { AccountModal } from "@/components/accounts/AccountModal"
import { ReconcileModal } from "@/components/accounts/ReconcileModal"
import { LoanModal } from "@/components/loans/LoanModal"
import { DeleteConfirmModal } from "@/components/ui/DeleteConfirmModal"
import { accountBalanceSeries, deriveAccountBalances, transactionEffect, today } from "@/lib/balance"
import { ChevronDown, ChevronRight, Plus, X, Pencil, Trash2, Wallet } from "lucide-react"
import { useIsDesktop } from "@/hooks/use-is-desktop"

// ── Biçimlendirme ────────────────────────────────────────────────
function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(amount)))} ₺`
}
const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
function monthLabel(iso: string): string {
    const [y, m] = iso.split('-')
    return `${TR_MONTHS[Number(m) - 1]} ${y}`
}
function formatDate(iso?: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    return `${d.getDate()} ${TR_MONTHS[d.getMonth()]}`
}

// ── Bütçe rampası: kart kullanım oranına renk ────────────────────
function rampColor(ratio: number): string {
    if (ratio < 0.4) return 'var(--budget-ok)'
    if (ratio < 0.7) return 'var(--budget-mid)'
    if (ratio < 0.9) return 'var(--budget-near)'
    return 'var(--budget-over)'
}

// ── Bakiye seyri aralıkları ──────────────────────────────────────
type Range = '1H' | '1A' | '3A' | 'YBB' | '1Y' | 'TÜMÜ'
const RANGES: { value: Range; label: string; since: string }[] = [
    { value: '1H', label: '1H', since: '1 haftada' },
    { value: '1A', label: '1A', since: '1 ayda' },
    { value: '3A', label: '3A', since: '3 ayda' },
    { value: 'YBB', label: 'YBB', since: 'yıl başından' },
    { value: '1Y', label: '1Y', since: '1 yılda' },
    { value: 'TÜMÜ', label: 'TÜMÜ', since: 'tüm zamanda' },
]

function isoAddDays(iso: string, days: number): string {
    const d = new Date(iso + 'T00:00:00')
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
}
/** Aralık için ~28 eşit aralıklı tarih noktası üretir. */
function rangePoints(range: Range, todayISO: string, earliestISO: string): string[] {
    let startISO: string
    const d = new Date(todayISO + 'T00:00:00')
    if (range === '1H') { d.setDate(d.getDate() - 7); startISO = d.toISOString().slice(0, 10) }
    else if (range === '1A') { d.setMonth(d.getMonth() - 1); startISO = d.toISOString().slice(0, 10) }
    else if (range === '3A') { d.setMonth(d.getMonth() - 3); startISO = d.toISOString().slice(0, 10) }
    else if (range === 'YBB') { startISO = `${todayISO.slice(0, 4)}-01-01` }
    else if (range === '1Y') { d.setFullYear(d.getFullYear() - 1); startISO = d.toISOString().slice(0, 10) }
    else { startISO = earliestISO < todayISO ? earliestISO : isoAddDays(todayISO, -30) }
    if (startISO > todayISO) startISO = todayISO
    const start = new Date(startISO + 'T00:00:00').getTime()
    const end = new Date(todayISO + 'T00:00:00').getTime()
    const N = 28
    const span = Math.max(end - start, 1)
    const pts: string[] = []
    for (let i = 0; i < N; i++) {
        const t = start + (span * i) / (N - 1)
        pts.push(new Date(t).toISOString().slice(0, 10))
    }
    return pts
}

// ── Mini bakiye seyri grafiği ────────────────────────────────────
function BalanceChart({ series, negativeOk }: { series: number[]; negativeOk?: boolean }) {
    if (series.length < 2) return null
    const W = 300, H = 64, pad = 4
    const min = Math.min(...series), max = Math.max(...series)
    const span = max - min || 1
    const x = (i: number) => pad + (i * (W - 2 * pad)) / (series.length - 1)
    const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad)
    const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    const up = series[series.length - 1] >= series[0]
    const stroke = negativeOk && series[series.length - 1] < 0 ? 'var(--flow-out)' : up ? 'var(--flow-in)' : 'var(--flow-out)'
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 64 }} preserveAspectRatio="none">
            <polyline points={pts} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx={x(series.length - 1)} cy={y(series[series.length - 1])} r={3} fill={stroke} />
        </svg>
    )
}

// ── Rampa doluluk barı ──────────────────────────────────────────
function FillBar({ ratio }: { ratio: number }) {
    const clamped = Math.max(0, Math.min(1, ratio))
    return (
        <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--fill-track)' }}>
            <div className="h-full rounded-full" style={{ width: `${clamped * 100}%`, background: rampColor(ratio) }} />
        </div>
    )
}

// ── Kullanım rozeti ──────────────────────────────────────────────
function UsageBadge({ ratio }: { ratio: number }) {
    const color = rampColor(ratio)
    return (
        <span
            className="tnum inline-flex items-center px-[7px] py-[2px]"
            style={{ fontSize: 12, fontWeight: 600, color, background: `color-mix(in srgb, ${color} 15%, transparent)`, borderRadius: 'var(--r-pill)' }}
        >
            %{Math.round(ratio * 100)}
        </span>
    )
}

const ASSET_EMOJI = (type: string) => type === 'Emtia' ? '🪙' : type === 'Kripto' ? '₿' : '📈'

/** investments symbol'ünü canlidoviz kur anahtarına eşler (NetWorthSummary ile aynı). */
const RATE_KEY: Record<string, string> = {
    ALTIN: 'ALTIN', GRAM: 'ALTIN', 'HAS ALTIN': 'ALTIN',
    USD: 'USD', DOLAR: 'USD', EUR: 'EUR', EURO: 'EUR', GBP: 'GBP', GUMUS: 'GUMUS',
}

// ── Tipler ──────────────────────────────────────────────────────
type Account = { id: string; name: string; type: string; balance: number; opening_balance: number; currency: string; credit_limit: number; cut_date?: number; due_date?: number; interest_rate?: number | null }
type Tx = { id: string; account_id: string | null; category_id?: string | null; amount: number; type: string; cash_date: string; transaction_date: string; description?: string; transfer_direction?: string | null; source_type?: string | null; categories?: { name: string } | null }
type Installment = { id: string; description: string; account_id: string; kind: string; total_amount: number; installments_count: number; payments: { id: string; amount: number; payment_date: string; status: string }[] }
type Selection = { kind: 'card' | 'account' | 'investment' | 'loan'; id: string } | null

export default function VarlikPage() {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [txs, setTxs] = useState<Tx[]>([])
    const [installments, setInstallments] = useState<Installment[]>([])
    const [investments, setInvestments] = useState<any[]>([])
    const [goals, setGoals] = useState<any[]>([])
    const [contribByGoal, setContribByGoal] = useState<Map<string, number>>(new Map())
    const [subscriptions, setSubscriptions] = useState<any[]>([])
    const [derived, setDerived] = useState<Map<string, number>>(new Map())
    const [rates, setRates] = useState<{ status: 'ok' | 'failed' | 'loading'; updatedAt?: string }>({ status: 'loading' })
    const [ratesMap, setRatesMap] = useState<Record<string, number>>({})
    const [isLoading, setIsLoading] = useState(true)

    const [selected, setSelected] = useState<Selection>(null)
    const isDesktop = useIsDesktop()
    const [range, setRange] = useState<Range>('1A')
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

    // Modallar
    const [accountModalOpen, setAccountModalOpen] = useState(false)
    const [editingAccount, setEditingAccount] = useState<Account | null>(null)
    const [loanModalOpen, setLoanModalOpen] = useState(false)
    const [reconcileAcc, setReconcileAcc] = useState<Account | null>(null)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<{ table: string; id: string; label: string } | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    const todayISO = today()

    const fetchAll = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return

            const [accRes, txRes, instRes, invRes, goalRes, contribRes, subRes, ratesRes] = await Promise.all([
                supabase.from('accounts').select('*').eq('household_id', hhId),
                supabase.from('transactions').select('id, account_id, category_id, amount, type, cash_date, transaction_date, description, transfer_direction, source_type, categories(name)').eq('household_id', hhId),
                supabase.from('installments').select('*, installment_payments(*)').eq('household_id', hhId),
                supabase.from('investments').select('*').eq('household_id', hhId),
                supabase.from('goals').select('id, name, saved_tl, source_account_id, status').eq('household_id', hhId),
                supabase.from('goal_contributions').select('goal_id, amount').eq('household_id', hhId),
                supabase.from('subscriptions').select('*').eq('household_id', hhId),
                fetch('/api/rates').then(r => r.json()).catch(() => ({ success: false })),
            ])

            const accs = (accRes.data || []) as Account[]
            const allTx = (txRes.data || []) as any as Tx[]
            const insts = (instRes.data || []).map((i: any) => ({ ...i, payments: i.installment_payments || [] })) as Installment[]

            setAccounts(accs)
            setTxs(allTx)
            setInstallments(insts)
            setInvestments(invRes.data || [])
            setGoals(goalRes.data || [])
            setSubscriptions(subRes.data || [])
            setDerived(deriveAccountBalances(accs, allTx, { warn: false }))

            const cmap = new Map<string, number>()
            for (const c of contribRes.data || []) cmap.set(c.goal_id, (cmap.get(c.goal_id) || 0) + Number(c.amount || 0))
            setContribByGoal(cmap)

            if (ratesRes?.success) { setRates({ status: 'ok', updatedAt: ratesRes.lastUpdate }); setRatesMap(ratesRes.rates || {}) }
            else setRates({ status: 'failed' })
        } catch (e: any) {
            console.error('Varlık yüklenemedi:', e)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => { fetchAll() }, [])

    // Kenar çubuğundan gelen ?hesap=<id> — o hesabı seçili aç. (window: Suspense gerektirmez)
    useEffect(() => {
        if (accounts.length === 0 || typeof window === 'undefined') return
        const hesap = new URLSearchParams(window.location.search).get('hesap')
        if (!hesap) return
        const acc = accounts.find(a => a.id === hesap)
        if (acc) setSelected({ kind: acc.type === 'credit_card' ? 'card' : 'account', id: acc.id })
    }, [accounts])

    // ── Gruplar ──────────────────────────────────────────────────
    const cards = useMemo(() => accounts.filter(a => a.type === 'credit_card'), [accounts])
    // Esnek hesap (KMH) TÜRE göre sabit kendi grubunda — bakiye işareti grup
    // değiştirmez (yalnız varlık/borç tarafını belirler). Bkz. karar notu.
    const esnek = useMemo(() => accounts.filter(a => a.type === 'esnek_hesap'), [accounts])
    const banks = useMemo(() => accounts.filter(a => a.type !== 'credit_card' && a.type !== 'investment' && a.type !== 'esnek_hesap'), [accounts])
    const loans = useMemo(() => installments.filter(i => i.kind === 'kredi'), [installments])

    const bal = (id: string) => derived.get(id) ?? 0

    // Yatırım değerleme (mevcut Yatırımlar ekranı mantığı)
    const invEnriched = useMemo(() => investments.map(a => {
        const qty = Number(a.quantity)
        const cost = qty * Number(a.average_cost)
        // Değerleme: sembol kur anahtarına eşleşirse canlı kur, aksi halde kayıtlı
        // güncel fiyat, o da yoksa maliyet (net değer ekranıyla aynı mantık).
        const rateKey = RATE_KEY[(a.symbol || '').toUpperCase()]
        const live = rateKey ? Number(ratesMap[rateKey]) : NaN
        const unit = Number.isFinite(live) && live > 0 ? live : (Number(a.current_price) || Number(a.average_cost))
        const val = qty * unit
        return { ...a, cost, val, profit: val - cost }
    }), [investments, ratesMap])

    // Açılışta ilk hesap varsayılan seçili (masaüstü; mobilde sheet açılmasın).
    // URL'de ?hesap varsa dokunma.
    useEffect(() => {
        if (selected || !isDesktop) return
        if (new URLSearchParams(window.location.search).get('hesap')) return
        if (cards.length) setSelected({ kind: 'card', id: cards[0].id })
        else if (banks.length) setSelected({ kind: 'account', id: banks[0].id })
        else if (invEnriched.length) setSelected({ kind: 'investment', id: invEnriched[0].id })
        else if (loans.length) setSelected({ kind: 'loan', id: loans[0].id })
    }, [cards, banks, invEnriched, loans, selected, isDesktop])

    // Kredi: kalan borç = ödenmemiş taksitler toplamı, aylık = ilk bekleyen tutar
    const loanInfo = (l: Installment) => {
        const pending = l.payments.filter(p => p.status !== 'paid')
        const remaining = pending.reduce((s, p) => s + Number(p.amount), 0)
        const monthly = pending.length ? Number(pending.sort((a, b) => a.payment_date < b.payment_date ? -1 : 1)[0].amount) : 0
        return { remaining, monthly, count: pending.length }
    }

    // Grup toplamları
    const totalCardDebt = cards.reduce((s, c) => s + Math.abs(Math.min(0, bal(c.id))), 0)
    const totalCardLimit = cards.reduce((s, c) => s + Number(c.credit_limit || 0), 0)
    const cardUsage = totalCardLimit > 0 ? totalCardDebt / totalCardLimit : 0
    const totalBank = banks.reduce((s, a) => s + bal(a.id), 0)
    const totalInvVal = invEnriched.reduce((s, a) => s + a.val, 0)
    const totalInvProfit = invEnriched.reduce((s, a) => s + a.profit, 0)
    const totalLoan = loans.reduce((s, l) => s + loanInfo(l).remaining, 0)

    const earliestTx = useMemo(() => {
        let e = todayISO
        for (const t of txs) if (t.cash_date && t.cash_date < e) e = t.cash_date
        return e
    }, [txs, todayISO])

    const toggle = (key: string) => setCollapsed(c => ({ ...c, [key]: !c[key] }))

    const goalSaved = (g: any) => Number(g.saved_tl || 0) + (contribByGoal.get(g.id) || 0)

    const requestDelete = () => {
        if (!selected) return
        if (selected.kind === 'card' || selected.kind === 'account') {
            const a = accounts.find(x => x.id === selected.id)
            setDeleteTarget({ table: 'accounts', id: selected.id, label: a?.name || 'Hesap' })
        } else if (selected.kind === 'investment') {
            const a = investments.find(x => x.id === selected.id)
            setDeleteTarget({ table: 'investments', id: selected.id, label: a?.symbol || 'Varlık' })
        } else {
            const a = loans.find(x => x.id === selected.id)
            setDeleteTarget({ table: 'installments', id: selected.id, label: a?.description || 'Kredi' })
        }
        setDeleteOpen(true)
    }
    const confirmDelete = async () => {
        if (!deleteTarget) return
        setIsDeleting(true)
        try {
            const { error } = await supabase.from(deleteTarget.table).delete().eq('id', deleteTarget.id)
            if (error) throw error
            setDeleteOpen(false); setDeleteTarget(null); setSelected(null)
            await fetchAll()
        } catch (e: any) {
            alert('Silinemedi: ' + (e.message || 'bilinmeyen hata'))
        } finally {
            setIsDeleting(false)
        }
    }
    const requestEdit = () => {
        if (!selected) return
        if (selected.kind === 'card' || selected.kind === 'account') {
            setEditingAccount(accounts.find(a => a.id === selected.id) || null)
            setAccountModalOpen(true)
        } else if (selected.kind === 'loan') {
            setLoanModalOpen(true)
        }
    }
    const requestReconcile = () => {
        if (!selected || (selected.kind !== 'card' && selected.kind !== 'account')) return
        setReconcileAcc(accounts.find(a => a.id === selected.id) || null)
    }

    if (isLoading) {
        return (
            <div>
                <div className="w-full"><NetWorthSummary /></div>
                <div className="py-[var(--s6)] text-center" style={{ color: 'var(--ink-3)', fontSize: 14 }}>Yükleniyor…</div>
            </div>
        )
    }

    return (
        <div>
            {/* 1 · Üst özet (mevcut, korunuyor) */}
            <div className="w-full"><NetWorthSummary /></div>

            {/* Üst bar: başlık + hesap ekle + alım simüle et */}
            <div className="mb-[var(--s4)] mt-[var(--s5)] flex items-center justify-between gap-[var(--s3)]">
                <PageHeader title="Hesaplar" subtitle="Kartlar, hesaplar, yatırımlar ve krediler" />
                <div className="flex shrink-0 items-center gap-[var(--s3)]">
                    <Link href="/simulations/asset-purchase" style={{ fontSize: 13, color: 'var(--accent)' }}>Alım simüle et</Link>
                    <PrimaryButton onClick={() => { setEditingAccount(null); setAccountModalOpen(true) }}>
                        <Plus className="h-4 w-4" /> Hesap ekle
                    </PrimaryButton>
                </div>
            </div>

            <div className="flex gap-[var(--s5)]">
                {/* 2 · Sol panel — türe göre gruplu liste */}
                <div className="min-w-0 flex-1 space-y-[var(--s5)]">
                    {cards.length > 0 && (
                        <Group
                            id="cards" title="Kredi kartları" collapsed={!!collapsed.cards} onToggle={() => toggle('cards')}
                            footer={<span className="tnum">Toplam borç {formatTL(totalCardDebt)} · kullanım %{Math.round(cardUsage * 100)}</span>}
                        >
                            {cards.map(c => {
                                const debt = Math.abs(Math.min(0, bal(c.id)))
                                const ratio = c.credit_limit > 0 ? debt / c.credit_limit : 0
                                return (
                                    <Row key={c.id} active={selected?.kind === 'card' && selected.id === c.id} onClick={() => setSelected({ kind: 'card', id: c.id })}>
                                        <AccountIcon type="credit_card" size={30} />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{c.name}</div>
                                        </div>
                                        <UsageBadge ratio={ratio} />
                                        <div className="tnum shrink-0 text-right" style={{ fontSize: 14.5, color: 'var(--flow-out)' }}>{formatTL(debt)}</div>
                                    </Row>
                                )
                            })}
                        </Group>
                    )}

                    {esnek.length > 0 && (
                        <Group
                            id="esnek" title="Esnek hesap" collapsed={!!collapsed.esnek} onToggle={() => toggle('esnek')}
                            footer={<span className="tnum">Toplam {formatTL(esnek.reduce((s, a) => s + bal(a.id), 0))}</span>}
                        >
                            {esnek.map(a => {
                                const b = bal(a.id)
                                const used = Math.max(0, -b)
                                const ratio = a.credit_limit > 0 ? used / a.credit_limit : 0
                                return (
                                    <Row key={a.id} active={selected?.kind === 'account' && selected.id === a.id} onClick={() => setSelected({ kind: 'account', id: a.id })}>
                                        <AccountIcon type={a.type} size={30} />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{a.name}</div>
                                            {used > 0 && <div className="tnum" style={{ fontSize: 12, color: 'var(--ink-3)' }}>kullanılan kredi</div>}
                                        </div>
                                        {used > 0 && <UsageBadge ratio={ratio} />}
                                        <div className="tnum shrink-0 text-right" style={{ fontSize: 14.5, color: b < 0 ? 'var(--flow-out)' : 'var(--ink)' }}>{formatTL(b)}</div>
                                    </Row>
                                )
                            })}
                        </Group>
                    )}

                    {banks.length > 0 && (
                        <Group
                            id="banks" title="Hesaplar" collapsed={!!collapsed.banks} onToggle={() => toggle('banks')}
                            footer={<span className="tnum">Toplam {formatTL(totalBank)}</span>}
                        >
                            {banks.map(a => (
                                <Row key={a.id} active={selected?.kind === 'account' && selected.id === a.id} onClick={() => setSelected({ kind: 'account', id: a.id })}>
                                    <AccountIcon type={a.type} size={30} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{a.name}</div>
                                    </div>
                                    <div className="tnum shrink-0 text-right" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{formatTL(bal(a.id))}</div>
                                </Row>
                            ))}
                        </Group>
                    )}

                    {invEnriched.length > 0 && (
                        <Group
                            id="inv" title="Yatırımlar" collapsed={!!collapsed.inv} onToggle={() => toggle('inv')}
                            footer={
                                <span className="tnum inline-flex items-center gap-[var(--s2)]">
                                    Toplam {formatTL(totalInvVal)} <DeltaChip value={totalInvProfit} />
                                </span>
                            }
                        >
                            {invEnriched.map(a => (
                                <Row key={a.id} active={selected?.kind === 'investment' && selected.id === a.id} onClick={() => setSelected({ kind: 'investment', id: a.id })}>
                                    <span style={{ fontSize: 20 }} aria-hidden>{ASSET_EMOJI(a.type)}</span>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{a.symbol}</div>
                                        <div className="truncate tnum" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{a.name} · {a.quantity} {a.unit}</div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <div className="tnum" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{formatTL(a.val)}</div>
                                        <DeltaChip value={a.profit} />
                                    </div>
                                </Row>
                            ))}
                            {rates.status === 'ok' && <RateNote text={`Kur ${formatDate(rates.updatedAt)} güncellendi.`} />}
                            {rates.status === 'failed' && <RateNote text="Kur güncellenemedi — değerler kayıtlı fiyatla." />}
                        </Group>
                    )}

                    {loans.length > 0 && (
                        <Group
                            id="loans" title="Krediler" collapsed={!!collapsed.loans} onToggle={() => toggle('loans')}
                            footer={<span className="tnum">Toplam kalan {formatTL(totalLoan)}</span>}
                        >
                            {loans.map(l => {
                                const info = loanInfo(l)
                                return (
                                    <Row key={l.id} active={selected?.kind === 'loan' && selected.id === l.id} onClick={() => setSelected({ kind: 'loan', id: l.id })}>
                                        <AccountIcon type="loan" size={30} />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{l.description}</div>
                                            <div className="truncate tnum" style={{ fontSize: 12, color: 'var(--ink-3)' }}>aylık {formatTL(info.monthly)} · {info.count} taksit kaldı</div>
                                        </div>
                                        <div className="tnum shrink-0 text-right" style={{ fontSize: 14.5, color: 'var(--flow-out)' }}>{formatTL(info.remaining)}</div>
                                    </Row>
                                )
                            })}
                        </Group>
                    )}

                    {accounts.length === 0 && invEnriched.length === 0 && (
                        <div className="rounded-[var(--r-card)] p-[var(--s6)] text-center" style={{ background: 'var(--surface)', color: 'var(--ink-3)', fontSize: 14 }}>
                            Henüz hesap yok. “Hesap ekle” ile başla.
                        </div>
                    )}
                </div>

                {/* 3 · Sağ panel — masaüstü sticky */}
                <aside className="hidden w-[420px] shrink-0 lg:block">
                    <div className="sticky top-[var(--s3)]">
                        {selected ? (
                            <DetailPanel
                                selected={selected} accounts={accounts} cards={cards} banks={banks} loans={loans}
                                invEnriched={invEnriched} txs={txs} installments={installments} subscriptions={subscriptions}
                                goals={goals} goalSaved={goalSaved} bal={bal} range={range} setRange={setRange}
                                todayISO={todayISO} earliestTx={earliestTx} rates={rates}
                                onEdit={requestEdit} onDelete={requestDelete} onReconcile={requestReconcile} loanInfo={loanInfo}
                            />
                        ) : (
                            <div className="rounded-[var(--r-card)] p-[var(--s6)] text-center" style={{ background: 'var(--surface)', color: 'var(--ink-3)', fontSize: 14 }}>
                                <Wallet className="mx-auto mb-[var(--s3)] h-6 w-6" style={{ opacity: 0.5 }} />
                                Detay için bir hesap seç.
                            </div>
                        )}
                    </div>
                </aside>
            </div>

            {/* Mobil bottom sheet */}
            {selected && (
                <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" onClick={() => setSelected(null)}>
                    <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.4)' }} />
                    <div className="relative max-h-[90vh] overflow-y-auto rounded-t-[var(--r-card)] p-[var(--s4)]" style={{ background: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
                        <div className="mb-[var(--s3)] flex justify-end">
                            <button onClick={() => setSelected(null)} className="icon-btn p-1" aria-label="Kapat"><X className="h-5 w-5" /></button>
                        </div>
                        <DetailPanel
                            selected={selected} accounts={accounts} cards={cards} banks={banks} loans={loans}
                            invEnriched={invEnriched} txs={txs} installments={installments} subscriptions={subscriptions}
                            goals={goals} goalSaved={goalSaved} bal={bal} range={range} setRange={setRange}
                            todayISO={todayISO} earliestTx={earliestTx} rates={rates}
                            onEdit={requestEdit} onDelete={requestDelete} onReconcile={requestReconcile} loanInfo={loanInfo} bare
                        />
                    </div>
                </div>
            )}

            <AccountModal isOpen={accountModalOpen} onClose={() => setAccountModalOpen(false)} onSuccess={() => { setAccountModalOpen(false); fetchAll() }} account={editingAccount as any} />
            <ReconcileModal
                isOpen={!!reconcileAcc}
                account={reconcileAcc as any}
                currentBalance={reconcileAcc ? bal(reconcileAcc.id) : 0}
                onClose={() => setReconcileAcc(null)}
                onSuccess={() => { setReconcileAcc(null); fetchAll() }}
            />
            <LoanModal isOpen={loanModalOpen} onClose={() => setLoanModalOpen(false)} onSuccess={() => { setLoanModalOpen(false); fetchAll() }} />
            <DeleteConfirmModal
                isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={confirmDelete}
                title={`${deleteTarget?.label ?? ''} sil`}
                description="Bu kaydı silmek istediğine emin misin? Bağlı hareketler varsa işlem başarısız olabilir."
                isLoading={isDeleting}
            />
        </div>
    )
}

// ── Grup (açılır/kapanır) ────────────────────────────────────────
function Group({ title, collapsed, onToggle, footer, children }: { id: string; title: string; collapsed: boolean; onToggle: () => void; footer: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="overflow-hidden rounded-[var(--r-card)]" style={{ background: 'var(--surface)' }}>
            <button onClick={onToggle} className="flex w-full items-center gap-[var(--s2)] px-[var(--s4)] py-[var(--s3)]">
                {collapsed ? <ChevronRight className="h-4 w-4" style={{ color: 'var(--ink-3)' }} /> : <ChevronDown className="h-4 w-4" style={{ color: 'var(--ink-3)' }} />}
                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{title}</span>
            </button>
            {!collapsed && <div className="px-[var(--s2)] pb-[var(--s2)]">{children}</div>}
            <div className="px-[var(--s4)] py-[var(--s3)] text-right" style={{ borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--ink-2)' }}>{footer}</div>
        </section>
    )
}

// ── Liste satırı ─────────────────────────────────────────────────
function Row({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className="flex w-full items-center gap-[var(--s3)] rounded-[var(--r-button)] px-[var(--s3)] py-[var(--s3)] text-left transition-colors"
            style={{ background: active ? 'var(--surface-2)' : 'transparent', boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none' }}
        >
            {children}
        </button>
    )
}

function RateNote({ text }: { text: string }) {
    return <div className="px-[var(--s3)] pt-[var(--s2)]" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{text}</div>
}

// ── Detay bölüm başlığı ──────────────────────────────────────────
function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="pt-[var(--s4)]">
            <div className="mb-[var(--s2)]" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{title}</div>
            {children}
        </div>
    )
}

// ── Sağ panel — hesap detayı ─────────────────────────────────────
function DetailPanel(props: any) {
    const { selected, accounts, cards, loans, invEnriched, txs, installments, subscriptions, goals, goalSaved, bal, range, setRange, todayISO, earliestTx, rates, onEdit, onDelete, onReconcile, loanInfo, bare } = props

    // Ortak: seçili varlık
    const account: Account | undefined = accounts.find((a: Account) => a.id === selected.id)
    const inv = invEnriched.find((a: any) => a.id === selected.id)
    const loan = loans.find((l: Installment) => l.id === selected.id)

    const isAccountLike = selected.kind === 'card' || selected.kind === 'account'

    // Bakiye serisi (hesap/kart)
    const points = useMemo(() => rangePoints(range, todayISO, earliestTx), [range, todayISO, earliestTx])
    const series = useMemo(() => {
        if (!isAccountLike || !account) return [] as number[]
        const accTx = txs.filter((t: Tx) => t.account_id === account.id)
        return accountBalanceSeries(account.opening_balance ?? 0, accTx as any, points)
    }, [isAccountLike, account, txs, points])

    // Bu hesaba ödenen faiz — bu yıl + son 12 ay şeridi (kart/KMH detayında).
    const interestPaid = useMemo(() => {
        if (!isAccountLike || !account) return null
        const year = todayISO.slice(0, 4)
        const months: { month: string; amount: number }[] = []
        for (let i = 11; i >= 0; i--) { const d = new Date(todayISO + 'T00:00:00'); d.setMonth(d.getMonth() - i); months.push({ month: d.toISOString().slice(0, 7), amount: 0 }) }
        let paidThisYear = 0
        for (const t of txs as Tx[]) {
            if (t.account_id !== account.id || t.source_type !== 'faiz' || t.type !== 'expense') continue
            // Faiz "işletildiği" ay esas (transaction_date), ödendiği gün değil.
            const d = (t.transaction_date || t.cash_date || '').slice(0, 10)
            if (!d || d > todayISO) continue
            const amt = Math.abs(Number(t.amount))
            if (d.slice(0, 4) === year) paidThisYear += amt
            const slot = months.find(x => x.month === d.slice(0, 7))
            if (slot) slot.amount += amt
        }
        return paidThisYear > 0 ? { paidThisYear, months } : null
    }, [isAccountLike, account, txs, todayISO])

    // Bağlı hedefler
    const linkedGoals = isAccountLike && account ? goals.filter((g: any) => g.source_account_id === account.id) : []

    // Son 10 hareket (hesap/kart), aya gruplu
    const recent = useMemo(() => {
        if (!isAccountLike || !account) return [] as Tx[]
        return txs.filter((t: Tx) => t.account_id === account.id)
            .slice().sort((a: Tx, b: Tx) => (a.transaction_date < b.transaction_date ? 1 : -1)).slice(0, 10)
    }, [isAccountLike, account, txs])

    const wrapCls = bare ? '' : 'rounded-[var(--r-card)] p-[var(--s4)]'
    const wrapStyle = bare ? {} : { background: 'var(--surface)' }

    // ── Başlık verisi ─────────────────────────────────────────────
    let name = '', typeLabel = '', bigValue = 0, bigColor = 'var(--ink)', delta = 0
    if (selected.kind === 'card' && account) {
        name = account.name; typeLabel = 'Kredi kartı'
        bigValue = Math.abs(Math.min(0, bal(account.id))); bigColor = 'var(--flow-out)'
        delta = series.length >= 2 ? series[series.length - 1] - series[0] : 0
    } else if (selected.kind === 'account' && account) {
        name = account.name; typeLabel = account.type === 'cash' ? 'Nakit' : account.type === 'savings' ? 'Birikim' : 'Vadesiz hesap'
        bigValue = bal(account.id); bigColor = 'var(--ink)'
        delta = series.length >= 2 ? series[series.length - 1] - series[0] : 0
    } else if (selected.kind === 'investment' && inv) {
        name = inv.symbol; typeLabel = inv.name; bigValue = inv.val; bigColor = 'var(--ink)'; delta = inv.profit
    } else if (selected.kind === 'loan' && loan) {
        const info = loanInfo(loan); name = loan.description; typeLabel = 'Kredi'; bigValue = info.remaining; bigColor = 'var(--flow-out)'
    }

    const sinceLabel = RANGES.find(r => r.value === range)?.since

    // ── Kart ekstra verisi ────────────────────────────────────────
    const cardInstallments = selected.kind === 'card' && account
        ? installments.filter((i: Installment) => i.kind === 'kart_taksidi' && i.account_id === account.id)
        : []
    // Kart harcamasının YAPILDIĞI gün (transaction_date) esas. İki ayrı rakam:
    // 1) Bu ay harcanan: takvim ayı içinde yapılan tüm kart harcaması.
    // 2) Açık ekstre: son kesim gününden bugüne yapılanlar = sonraki son ödemede ödenecek.
    const cardTxDay = (t: Tx) => (t.transaction_date || t.cash_date || '').slice(0, 10)
    const thisMonthSpent = selected.kind === 'card' && account
        ? txs.filter((t: Tx) => t.account_id === account.id && t.type === 'expense' && cardTxDay(t).slice(0, 7) === todayISO.slice(0, 7))
            .reduce((s: number, t: Tx) => s + Number(t.amount), 0)
        : 0
    const openStatementTotal = selected.kind === 'card' && account && account.cut_date
        ? (() => {
            const cut = Number(account.cut_date)
            const [ty, tm, td] = todayISO.split('-').map(Number)
            let cy = ty, cm = tm
            if (td < cut) { cm -= 1; if (cm < 1) { cm = 12; cy -= 1 } } // kesim henüz geçmediyse önceki ayın kesimi
            const lastDay = new Date(cy, cm, 0).getDate()
            const cutDate = `${cy}-${String(cm).padStart(2, '0')}-${String(Math.min(cut, lastDay)).padStart(2, '0')}`
            return txs.filter((t: Tx) => t.account_id === account.id && t.type === 'expense'
                && cardTxDay(t) >= cutDate && cardTxDay(t) <= todayISO)
                .reduce((s: number, t: Tx) => s + Number(t.amount), 0)
        })()
        : 0
    // Karta bağlı 12 aylık yük (taksit ödemeleri, ay ay)
    const cardLoad12 = useMemo(() => {
        if (selected.kind !== 'card' || !account) return [] as { month: string; amount: number }[]
        const months: { month: string; amount: number }[] = []
        for (let i = 0; i < 12; i++) {
            const d = new Date(todayISO + 'T00:00:00'); d.setMonth(d.getMonth() + i)
            months.push({ month: d.toISOString().slice(0, 7), amount: 0 })
        }
        for (const inst of cardInstallments) for (const p of inst.payments) {
            const m = p.payment_date.slice(0, 7)
            const slot = months.find(x => x.month === m)
            if (slot) slot.amount += Number(p.amount)
        }
        return months
    }, [selected.kind, account, cardInstallments, todayISO])
    const maxLoad = Math.max(1, ...cardLoad12.map(m => m.amount))

    // Hesaptan çıkan düzenli ödemeler (abonelik)
    const accountSubs = selected.kind === 'account' && account
        ? subscriptions.filter((s: any) => s.account_id === account.id && (s.status ?? 'active') === 'active')
        : []

    const dueDay = account?.due_date, cutDay = account?.cut_date

    return (
        <div className={wrapCls} style={wrapStyle}>
            {/* Başlık */}
            <div className="flex items-start justify-between gap-[var(--s3)]">
                <div className="flex items-center gap-[var(--s3)]">
                    {selected.kind === 'investment'
                        ? <span style={{ fontSize: 24 }} aria-hidden>{ASSET_EMOJI(inv?.type)}</span>
                        : <AccountIcon type={selected.kind === 'card' ? 'credit_card' : selected.kind === 'loan' ? 'loan' : account?.type} size={34} />}
                    <div className="min-w-0">
                        <div className="truncate" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{name}</div>
                        <div className="truncate" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{typeLabel}</div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-[var(--s1)]">
                    {isAccountLike && (
                        <button
                            onClick={onReconcile}
                            className="inline-flex items-center px-[8px] py-[4px]"
                            style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', borderRadius: 'var(--r-pill)', fontSize: 11.5, fontWeight: 600 }}
                        >
                            Bakiye eşitle
                        </button>
                    )}
                    {(isAccountLike || selected.kind === 'loan') && (
                        <button onClick={onEdit} className="icon-btn p-1" aria-label="Düzenle"><Pencil className="h-4 w-4" /></button>
                    )}
                    <button onClick={onDelete} className="icon-btn p-1" aria-label="Sil"><Trash2 className="h-4 w-4" /></button>
                </div>
            </div>

            <div className="mt-[var(--s3)] flex items-baseline gap-[var(--s3)]">
                <div className="tnum" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: bigColor }}>{formatTL(bigValue)}</div>
                {(isAccountLike && series.length >= 2) && <DeltaChip value={delta} context={sinceLabel} />}
                {selected.kind === 'investment' && <DeltaChip value={inv.profit} context="kâr/zarar" />}
            </div>

            {/* Bakiye seyri (hesap/kart) */}
            {isAccountLike && series.length >= 2 && (
                <div className="mt-[var(--s3)]">
                    <BalanceChart series={series} negativeOk={selected.kind === 'account'} />
                    <div className="mt-[var(--s2)]">
                        <Segmented options={RANGES.map(r => ({ value: r.value, label: r.label }))} value={range} onChange={setRange} />
                    </div>
                </div>
            )}

            {/* Bu hesaba ödenen faiz — bu yıl + aylık şerit */}
            {interestPaid && (() => {
                const max = Math.max(1, ...interestPaid.months.map(m => m.amount))
                return (
                    <DetailSection title="Faiz">
                        <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                            Bu yıl bu hesaba <b className="tnum" style={{ color: 'var(--flow-out)' }}>{formatTL(interestPaid.paidThisYear)}</b> faiz ödedin.
                        </p>
                        <div className="mt-[var(--s3)] flex items-end gap-[3px]" style={{ height: 40 }}>
                            {interestPaid.months.map(m => (
                                <div key={m.month} className="flex-1" title={`${m.month}: ${formatTL(m.amount)}`}
                                    style={{ height: `${Math.max(2, (m.amount / max) * 100)}%`, background: m.amount > 0 ? 'var(--flow-out)' : 'var(--fill-track)', borderRadius: 2, opacity: m.amount > 0 ? 1 : 0.5 }} />
                            ))}
                        </div>
                    </DetailSection>
                )
            })()}

            {/* Faiz oranı girilmemiş borçlu hesap → ipucu (faiz hesaplanamaz/sorulamaz). */}
            {isAccountLike && account && (account.type === 'credit_card' || account.type === 'esnek_hesap')
                && (account.interest_rate == null || Number(account.interest_rate) <= 0) && bal(account.id) < 0 && (
                <DetailSection title="Faiz">
                    <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>
                        Faiz oranı girilmemiş.{' '}
                        <button onClick={onEdit} className="hover:underline" style={{ color: 'var(--accent)', fontWeight: 500 }}>Faiz oranını gir</button>
                        {' '}→ dönem sonunda işleyen faizi hesaplayıp onayına sunayım.
                    </p>
                </DetailSection>
            )}

            {/* Yatırım kırılımı */}
            {selected.kind === 'investment' && inv && (
                <div className="mt-[var(--s3)] space-y-[var(--s2)]" style={{ fontSize: 13.5 }}>
                    <DetailRow label="Maliyet" value={formatTL(inv.cost)} />
                    <DetailRow label="Güncel değer" value={formatTL(inv.val)} />
                    <DetailRow label="Kâr / zarar" value={<DeltaChip value={inv.profit} />} />
                    {rates.status === 'ok' && <RateNote text={`Kur ${formatDate(rates.updatedAt)} güncellendi.`} />}
                    {rates.status === 'failed' && <RateNote text="Kur güncellenemedi — kayıtlı fiyatla değerlendi." />}
                </div>
            )}

            {/* Kredi kırılımı */}
            {selected.kind === 'loan' && loan && (
                <div className="mt-[var(--s3)] space-y-[var(--s2)]" style={{ fontSize: 13.5 }}>
                    <DetailRow label="Kalan borç" value={<span className="tnum" style={{ color: 'var(--flow-out)' }}>{formatTL(loanInfo(loan).remaining)}</span>} />
                    <DetailRow label="Aylık ödeme" value={<span className="tnum">{formatTL(loanInfo(loan).monthly)}</span>} />
                    <DetailRow label="Kalan taksit" value={<span className="tnum">{loanInfo(loan).count}</span>} />
                </div>
            )}

            {/* Bağlı hedefler */}
            {linkedGoals.length > 0 && (
                <DetailSection title="Bu hesaba bağlı hedefler">
                    <div className="space-y-[var(--s1)]">
                        {linkedGoals.map((g: any) => (
                            <Link key={g.id} href="/hedefler" className="flex items-center justify-between rounded-[var(--r-button)] px-[var(--s2)] py-[var(--s2)]" style={{ background: 'var(--surface-2)' }}>
                                <span className="truncate" style={{ fontSize: 13.5, color: 'var(--ink)' }}>{g.name}</span>
                                <span className="tnum shrink-0" style={{ fontSize: 13.5, color: 'var(--flow-in)' }}>{formatTL(goalSaved(g))}</span>
                            </Link>
                        ))}
                    </div>
                </DetailSection>
            )}

            {/* Kart ekstraları */}
            {selected.kind === 'card' && account && (
                <>
                    <DetailSection title="Limit kullanımı">
                        <div className="mb-[var(--s2)] flex items-center justify-between" style={{ fontSize: 13 }}>
                            <span className="tnum" style={{ color: 'var(--ink-3)' }}>Kullanılan {formatTL(bigValue)}</span>
                            <span className="tnum" style={{ color: 'var(--ink-3)' }}>Kalan {formatTL(Math.max(0, (account.credit_limit || 0) - bigValue))}</span>
                        </div>
                        <FillBar ratio={account.credit_limit > 0 ? bigValue / account.credit_limit : 0} />
                        <div className="mt-[var(--s1)] tnum text-right" style={{ fontSize: 12, color: 'var(--ink-4)' }}>Limit {formatTL(account.credit_limit || 0)}</div>
                    </DetailSection>

                    {(cutDay || dueDay) && (
                        <DetailSection title="Ekstre">
                            <div className="space-y-[var(--s2)]" style={{ fontSize: 13.5 }}>
                                {cutDay ? <DetailRow label="Kesim günü" value={<span className="tnum">Her ayın {cutDay}’i</span>} /> : null}
                                {dueDay ? <DetailRow label="Son ödeme günü" value={<span className="tnum">Her ayın {dueDay}’i</span>} /> : null}
                                <DetailRow label="Bu ay harcanan" value={<span className="tnum" style={{ color: 'var(--flow-out)' }}>{formatTL(thisMonthSpent)}</span>} />
                                {account?.cut_date ? <DetailRow label="Açık ekstre" value={<span className="tnum" style={{ color: 'var(--flow-out)' }}>{formatTL(openStatementTotal)}</span>} /> : null}
                            </div>
                        </DetailSection>
                    )}

                    {cardInstallments.length > 0 && (
                        <DetailSection title="Aktif taksitler">
                            <div className="space-y-[var(--s1)]">
                                {cardInstallments.map((inst: Installment) => {
                                    const pend = inst.payments.filter(p => p.status !== 'paid').sort((a, b) => a.payment_date < b.payment_date ? -1 : 1)
                                    const last = inst.payments.slice().sort((a, b) => a.payment_date < b.payment_date ? 1 : -1)[0]
                                    return (
                                        <div key={inst.id} className="flex items-center justify-between rounded-[var(--r-button)] px-[var(--s2)] py-[var(--s2)]" style={{ background: 'var(--surface-2)' }}>
                                            <div className="min-w-0">
                                                <div className="truncate" style={{ fontSize: 13.5, color: 'var(--ink)' }}>{inst.description}</div>
                                                <div className="tnum" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{pend.length} taksit · bitiş {last ? monthLabel(last.payment_date.slice(0, 7)) : '—'}</div>
                                            </div>
                                            <div className="tnum shrink-0" style={{ fontSize: 13.5, color: 'var(--ink)' }}>{formatTL(pend[0] ? Number(pend[0].amount) : 0)}</div>
                                        </div>
                                    )
                                })}
                            </div>
                        </DetailSection>
                    )}

                    {cardLoad12.some(m => m.amount > 0) && (
                        <DetailSection title="12 aylık yük">
                            <div className="flex items-end gap-[3px]" style={{ height: 40 }}>
                                {cardLoad12.map((m, i) => (
                                    <div key={i} className="flex-1 rounded-t-[2px]" title={`${monthLabel(m.month)}: ${formatTL(m.amount)}`}
                                        style={{ height: `${Math.max(2, (m.amount / maxLoad) * 100)}%`, background: m.amount > 0 ? 'var(--flow-out)' : 'var(--fill-track)', opacity: m.amount > 0 ? 0.85 : 1 }} />
                                ))}
                            </div>
                            <div className="mt-[var(--s1)] flex justify-between" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                                <span>{TR_MONTHS[Number(cardLoad12[0].month.slice(5)) - 1].slice(0, 3)}</span>
                                <span>{TR_MONTHS[Number(cardLoad12[11].month.slice(5)) - 1].slice(0, 3)}</span>
                            </div>
                        </DetailSection>
                    )}
                </>
            )}

            {/* Banka hesabı: çıkan düzenli ödemeler */}
            {selected.kind === 'account' && accountSubs.length > 0 && (
                <DetailSection title="Bu hesaptan çıkan düzenli ödemeler">
                    <div className="space-y-[var(--s1)]">
                        {accountSubs.map((s: any) => (
                            <div key={s.id} className="flex items-center justify-between rounded-[var(--r-button)] px-[var(--s2)] py-[var(--s2)]" style={{ background: 'var(--surface-2)' }}>
                                <span className="truncate" style={{ fontSize: 13.5, color: 'var(--ink)' }}>{s.name}</span>
                                <span className="tnum shrink-0" style={{ fontSize: 13.5, color: 'var(--flow-out)' }}>{formatTL(Number(s.amount))}</span>
                            </div>
                        ))}
                    </div>
                </DetailSection>
            )}

            {/* Son hareketler (hesap/kart) */}
            {isAccountLike && recent.length > 0 && (
                <DetailSection title="Son hareketler">
                    <RecentList txs={recent} />
                </DetailSection>
            )}
        </div>
    )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between">
            <span style={{ color: 'var(--ink-3)' }}>{label}</span>
            <span style={{ color: 'var(--ink)' }}>{value}</span>
        </div>
    )
}

// Son hareketler — Hareketler satır dili, aya gruplu
function RecentList({ txs }: { txs: Tx[] }) {
    const groups: { month: string; items: Tx[] }[] = []
    for (const t of txs) {
        const m = (t.transaction_date || t.cash_date).slice(0, 7)
        let g = groups.find(x => x.month === m)
        if (!g) { g = { month: m, items: [] }; groups.push(g) }
        g.items.push(t)
    }
    return (
        <div className="space-y-[var(--s3)]">
            {groups.map(g => (
                <div key={g.month}>
                    <div className="mb-[var(--s1)]" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{monthLabel(g.month)}</div>
                    <div className="space-y-[2px]">
                        {g.items.map(t => {
                            const eff = transactionEffect(t as any)
                            const color = eff >= 0 ? 'var(--flow-in)' : 'var(--flow-out)'
                            return (
                                <div key={t.id} className="flex items-center justify-between gap-[var(--s2)] py-[3px]">
                                    <div className="min-w-0">
                                        <div className="truncate" style={{ fontSize: 13, color: 'var(--ink)' }}>{t.description || t.categories?.name || 'Hareket'}</div>
                                        <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{formatDate(t.transaction_date)}{t.categories?.name ? ` · ${t.categories.name}` : ''}</div>
                                    </div>
                                    <div className="tnum shrink-0" style={{ fontSize: 13, color }}>{eff >= 0 ? '+' : '−'}{formatTL(eff)}</div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
}
