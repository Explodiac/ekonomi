'use client'

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, Check, ChevronDown, X, Plus, Trash2, Pencil, Calendar } from "lucide-react"
import {
    buildUpcoming, getRecurringDetail, monthLabel, monthName,
    type UpcomingItem, type UpcomingKind, type RecurringDetail,
} from "@/lib/upcoming"
import { CategoryPill } from "@/components/dashboard/category-tile"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { PageHeader } from "@/components/ui/page-header"
import { PrimaryButton } from "@/components/ui/primary-button"

function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(amount)))} ₺`
}
const TR_MON = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const TR_MON_LETTER = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A']
const FREQ_LABEL: Record<string, string> = { monthly: 'Her ay', yearly: 'Her yıl', weekly: 'Her hafta' }
const KIND_LABEL: Record<UpcomingKind, string> = { abonelik: 'Aylık', kart_taksidi: 'Taksit', kredi: 'Kredi' }

function todayISO() { return new Date().toISOString().slice(0, 10) }
function longDate(iso: string) { const [y, m, d] = iso.split('-').map(Number); return `${d} ${TR_MON[m - 1]} ${y}` }
function shortDate(iso: string) { const [, m, d] = iso.split('-').map(Number); return `${d} ${TR_MON[m - 1].slice(0, 3)}` }

/** Sayfa içi zenginleştirilmiş kalem. */
type Row = {
    key: string
    date: string
    label: string
    amount: number
    kind: UpcomingKind
    sourceId: string          // abonelik: subId; taksit: installment id (detay için)
    categoryName: string | null
    paid: boolean
}

type Sub = { id: string; name: string; amount: number; frequency: string; next_payment_date: string; status?: string | null; category_id?: string | null }
type Inst = { id: string; description?: string | null; kind: string; category_id?: string | null; payments: { id: string; payment_date: string; amount: number | string }[] }

export default function YaklasanPage() {
    const [txs, setTxs] = useState<any[]>([])
    const [subs, setSubs] = useState<Sub[]>([])
    const [insts, setInsts] = useState<Inst[]>([])
    const [catName, setCatName] = useState<Map<string, string>>(new Map())
    const [accName, setAccName] = useState<Map<string, string>>(new Map())
    const [isLoading, setIsLoading] = useState(true)
    const [selected, setSelected] = useState<Row | null>(null)
    const isDesktop = useIsDesktop()
    const [openFuture, setOpenFuture] = useState(true)

    const fetchAll = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return
            const [txRes, subRes, instRes, catRes, accRes] = await Promise.all([
                supabase.from('transactions').select('id, amount, type, cash_date, description, category_id, account_id, source_type, source_id, transfer_direction').eq('household_id', hhId),
                supabase.from('subscriptions').select('id, name, amount, frequency, next_payment_date, status, category_id').eq('household_id', hhId),
                supabase.from('installments').select('id, description, kind, category_id, installment_payments(id, payment_date, amount)').eq('household_id', hhId),
                supabase.from('categories').select('id, name').eq('household_id', hhId),
                supabase.from('accounts').select('id, name').eq('household_id', hhId),
            ])
            setTxs(txRes.data || [])
            setSubs((subRes.data || []) as Sub[])
            setInsts((instRes.data || []).map((i: any) => ({ ...i, payments: i.installment_payments || [] })))
            setCatName(new Map((catRes.data || []).map((c: any) => [c.id, c.name])))
            setAccName(new Map((accRes.data || []).map((a: any) => [a.id, a.name])))
        } catch (e) {
            console.error('Yaklaşan hesaplanamadı:', e)
        } finally {
            setIsLoading(false)
        }
    }
    useEffect(() => { fetchAll() }, [])

    const asOf = todayISO()
    const curMonth = asOf.slice(0, 7)

    // Taksit ödeme id → installment id (detay için).
    const paymentToInst = useMemo(() => {
        const m = new Map<string, string>()
        for (const i of insts) for (const p of i.payments) m.set(p.id, i.id)
        return m
    }, [insts])
    const subCat = useMemo(() => new Map(subs.map(s => [s.id, s.category_id ? catName.get(s.category_id) ?? null : null])), [subs, catName])
    const instCat = useMemo(() => new Map(insts.map(i => [i.id, i.category_id ? catName.get(i.category_id) ?? null : null])), [insts, catName])

    const upcoming = useMemo(() => buildUpcoming({
        transactions: txs, subscriptions: subs as any,
        installments: insts.map(i => ({ id: i.id, description: i.description, kind: i.kind, payments: i.payments })),
    }, { from: asOf }), [txs, subs, insts, asOf])

    // Kalem → Row (kategori + detay sourceId).
    const toRow = (it: UpcomingItem, paid: boolean): Row => {
        const instId = it.kind === 'abonelik' ? it.sourceId : (paymentToInst.get(it.sourceId) ?? it.sourceId)
        const cat = it.kind === 'abonelik' ? subCat.get(it.sourceId) ?? null : instCat.get(instId) ?? null
        return { key: `${it.sourceId}-${it.date}`, date: it.date, label: it.label, amount: it.amount, kind: it.kind, sourceId: instId, categoryName: cat, paid }
    }

    // BU AY: gelecek (buildUpcoming) + ödenmiş (transactions, source_type dolu, bu ay, <=asOf).
    const thisMonth = useMemo(() => {
        const future = (upcoming.months.find(m => m.month === curMonth)?.items ?? []).map(it => toRow(it, false))
        const paidRows: Row[] = []
        for (const t of txs) {
            if (!t.source_type || !t.cash_date) continue
            if (t.cash_date.slice(0, 7) !== curMonth || t.cash_date > asOf) continue
            const kind: UpcomingKind = t.source_type === 'installment' ? 'kart_taksidi' : 'abonelik'
            const instId = kind === 'abonelik' ? '' : (paymentToInst.get(t.source_id) ?? '')
            const cat = kind === 'abonelik'
                ? null // ödenmiş abonelik hareketi — kategori tx'ten
                : instCat.get(instId) ?? null
            paidRows.push({
                key: `paid-${t.id}`, date: t.cash_date, label: t.description || 'Ödeme', amount: Math.abs(Number(t.amount)),
                kind, sourceId: instId || t.source_id, categoryName: cat ?? (t.category_id ? catName.get(t.category_id) ?? null : null), paid: true,
            })
        }
        return [...paidRows, ...future].sort((a, b) => a.date.localeCompare(b.date))
    }, [upcoming, txs, curMonth, asOf])

    // Özet: bu ay ödenen / kalan.
    const summary = useMemo(() => {
        const paid = thisMonth.filter(r => r.paid).reduce((s, r) => s + r.amount, 0)
        const remaining = thisMonth.filter(r => !r.paid).reduce((s, r) => s + r.amount, 0)
        return { paid: Math.round(paid), remaining: Math.round(remaining), total: Math.round(paid + remaining) }
    }, [thisMonth])

    const futureMonths = useMemo(() => upcoming.months.filter(m => m.month > curMonth && m.total > 0), [upcoming, curMonth])

    const detail = useMemo<RecurringDetail | null>(() => {
        if (!selected) return null
        return getRecurringDetail({
            sourceId: selected.sourceId, kind: selected.kind, label: selected.label,
            transactions: txs, subscriptions: subs as any,
            installments: insts.map(i => ({ id: i.id, description: i.description, kind: i.kind, payments: i.payments })),
            asOf,
        })
    }, [selected, txs, subs, insts, asOf])

    // Açılışta bu ayın ilk kalemi varsayılan seçili (masaüstü; mobilde sheet açılmasın).
    useEffect(() => {
        if (selected || !isDesktop) return
        if (thisMonth.length > 0) setSelected(thisMonth[0])
    }, [thisMonth, selected, isDesktop])

    if (isLoading) {
        return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }

    const hasAny = thisMonth.length > 0 || futureMonths.length > 0
    const sub = selected ? subs.find(s => s.id === selected.sourceId) : null
    const inst = selected ? insts.find(i => i.id === selected.sourceId) : null

    const detailNode = selected && detail && (
        <RecurringDetailPanel row={selected} detail={detail} sub={sub} inst={inst} accName={accName}
            onClose={() => setSelected(null)} onChanged={() => { setSelected(null); fetchAll() }} />
    )

    return (
        <div className="w-full pb-10">
            <div className="mb-[var(--s4)] flex items-center justify-between gap-[var(--s3)]">
                <PageHeader title="Yaklaşan" />
                <Link href="/subscriptions"><PrimaryButton>+ Ekle</PrimaryButton></Link>
            </div>

            {!hasAny ? (
                <EmptyState />
            ) : (
                <div className="flex items-start gap-[var(--s3)]">
                    {/* SOL */}
                    <div className="flex min-w-0 flex-1 flex-col gap-[var(--s3)]">
                        <SummaryCard summary={summary} />

                        {/* BU AY */}
                        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="overflow-hidden py-[var(--s2)]">
                            <div className="px-[22px] pb-[var(--s1)] pt-[var(--s3)]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--ink-3)' }}>
                                BU AY · {monthName(curMonth).toUpperCase()}
                            </div>
                            {thisMonth.length === 0 ? (
                                <p className="px-[22px] pb-[var(--s3)]" style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>Bu ay kalan yükümlülük yok.</p>
                            ) : (
                                <ul>{thisMonth.map(r => <ItemRow key={r.key} row={r} selected={selected?.key === r.key} onSelect={() => setSelected(r)} />)}</ul>
                            )}
                        </section>

                        {/* İLERİDE */}
                        {futureMonths.length > 0 && (
                            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="overflow-hidden py-[var(--s2)]">
                                <button onClick={() => setOpenFuture(o => !o)} className="flex w-full items-center gap-[var(--s2)] px-[22px] pb-[var(--s1)] pt-[var(--s3)]">
                                    <ChevronDown className="h-[13px] w-[13px] transition-transform" style={{ color: 'var(--ink-3)', transform: openFuture ? 'none' : 'rotate(-90deg)' }} />
                                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--ink-3)' }}>İLERİDE</span>
                                </button>
                                {openFuture && futureMonths.map(m => (
                                    <div key={m.month}>
                                        <div className="flex items-baseline justify-between px-[22px] pb-[var(--s1)] pt-[var(--s3)]">
                                            <span className="flex items-center gap-[var(--s2)]" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>
                                                {monthLabel(m.month)}
                                                {m.isHeavy && <span style={{ fontSize: 10.5, color: 'var(--budget-near)' }}>yoğun · {m.heavyReason}</span>}
                                            </span>
                                            <span className="tnum" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{formatTL(m.total)}</span>
                                        </div>
                                        <ul>{m.items.map(it => { const r = toRow(it, false); return <ItemRow key={r.key} row={r} selected={selected?.key === r.key} onSelect={() => setSelected(r)} compact /> })}</ul>
                                    </div>
                                ))}
                            </section>
                        )}
                    </div>

                    {/* SAĞ — masaüstü */}
                    <aside className="hidden w-[420px] shrink-0 lg:block">
                        <div className="sticky top-[var(--s3)]" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                            {detailNode ?? <div className="flex h-[280px] items-center justify-center px-[22px] text-center" style={{ fontSize: 14, color: 'var(--ink-3)' }}>Bir kalem seç</div>}
                        </div>
                    </aside>
                </div>
            )}

            {/* Mobil bottom sheet */}
            {selected && detail && (
                <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setSelected(null)}>
                    <div className="max-h-[90vh] overflow-y-auto" style={{ background: 'var(--surface)', borderTopLeftRadius: 'var(--r-card)', borderTopRightRadius: 'var(--r-card)' }} onClick={e => e.stopPropagation()}>
                        {detailNode}
                    </div>
                </div>
            )}
        </div>
    )
}

function SummaryCard({ summary }: { summary: { paid: number; remaining: number; total: number } }) {
    const pct = summary.total > 0 ? summary.paid / summary.total : 0
    const R = 26, C = 2 * Math.PI * R
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="flex items-center justify-between gap-[var(--s4)] p-[22px]">
            <div>
                <div className="tnum" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{formatTL(summary.paid)} ödendi</div>
                <div className="tnum mt-[2px]" style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>bu ay {formatTL(summary.remaining)} ödenecek kaldı</div>
            </div>
            <svg width={64} height={64} viewBox="0 0 64 64" className="shrink-0">
                <circle cx={32} cy={32} r={R} fill="none" stroke="var(--fill-track)" strokeWidth={6} />
                <circle cx={32} cy={32} r={R} fill="none" stroke="var(--flow-in)" strokeWidth={6} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 32 32)" />
                <text x={32} y={32} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 15, fontWeight: 700, fill: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>%{Math.round(pct * 100)}</text>
            </svg>
        </section>
    )
}

function ItemRow({ row, selected, onSelect, compact }: { row: Row; selected: boolean; onSelect: () => void; compact?: boolean }) {
    const day = Number(row.date.slice(8, 10))
    return (
        <li>
            <button onClick={onSelect} className="flex w-full items-center gap-[var(--s2)] px-[22px] py-[10px] text-left transition-colors"
                style={{ background: selected ? 'var(--surface-2)' : 'transparent', boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : 'none' }}>
                {/* Tek sıra, gap'li: gün · ad · sıklık · pill · tik · tutar — hiçbiri absolute değil */}
                <span className="tnum w-[22px] shrink-0 text-center" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{day}</span>
                <span className="min-w-0 flex-1 truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{row.label}</span>
                <span className="shrink-0" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{KIND_LABEL[row.kind]}</span>
                {!compact && row.categoryName && <span className="shrink-0"><CategoryPill name={row.categoryName} /></span>}
                {row.paid && <Check className="h-[14px] w-[14px] shrink-0" style={{ color: 'var(--flow-in)' }} strokeWidth={3} />}
                <span className="tnum shrink-0 text-right" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{formatTL(row.amount)}</span>
            </button>
        </li>
    )
}

/** Sağ detay — kurallar, ödeme şeridi, key metrics, son hesap. */
function RecurringDetailPanel({ row, detail, sub, inst, accName, onClose, onChanged }: {
    row: Row; detail: RecurringDetail; sub: Sub | null | undefined; inst: Inst | null | undefined
    accName: Map<string, string>; onClose: () => void; onChanged: () => void
}) {
    const rules: string[] = []
    rules.push(`Adı ${row.label}`)
    if (sub) {
        rules.push(`Tutar ${formatTL(Number(sub.amount))}`)
        rules.push(`Ayın ${Number(sub.next_payment_date.slice(8, 10))}'i civarı`)
        rules.push(FREQ_LABEL[sub.frequency] ?? sub.frequency)
    } else if (inst) {
        const n = inst.payments.length
        const paidN = inst.payments.filter(p => p.payment_date <= todayISO()).length
        rules.push(`Tutar ${formatTL(Number(inst.payments[0]?.amount ?? 0))}`)
        rules.push(`${paidN}/${n} taksit ödendi`)
        rules.push('Her ay')
    }

    const remove = async () => {
        if (!confirm('Bu kalemi silmek istiyor musun?')) return
        try {
            if (sub) await supabase.from('subscriptions').delete().eq('id', sub.id)
            else if (inst) await supabase.from('installments').delete().eq('id', inst.id)
            onChanged()
        } catch (e) { console.error('Silinemedi:', e) }
    }

    return (
        <div className="p-[22px]">
            <div className="mb-[var(--s3)] flex items-center justify-between">
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Kalem</span>
                <button onClick={onClose} aria-label="Kapat"><ChevronDown className="h-[18px] w-[18px] lg:hidden" style={{ color: 'var(--ink-3)' }} /><X className="hidden h-[16px] w-[16px] lg:inline" style={{ color: 'var(--ink-3)' }} /></button>
            </div>

            {/* Başlık + sonraki ödeme */}
            <div className="flex items-start justify-between gap-[var(--s3)]">
                <div className="min-w-0">
                    {row.categoryName && <div className="mb-[var(--s2)]"><CategoryPill name={row.categoryName} /></div>}
                    <h2 className="truncate" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{row.label}</h2>
                </div>
                {detail.nextPayment && (
                    <div className="shrink-0 text-right">
                        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Sonraki ödeme</div>
                        <div className="tnum mt-[1px]" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{formatTL(detail.nextPayment.amount)}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{shortDate(detail.nextPayment.date)}{detail.nextPayment.approximate ? ' civarı' : ''}</div>
                    </div>
                )}
            </div>

            {/* Kurallar */}
            <div className="mt-[var(--s4)]">
                <div className="mb-[var(--s2)] flex items-center justify-between">
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Kurallar</span>
                    <Link href="/subscriptions" className="inline-flex items-center gap-[3px]" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}><Pencil className="h-[12px] w-[12px]" /> Düzenle</Link>
                </div>
                <div className="flex flex-wrap gap-[var(--s2)]">
                    {rules.map((r, i) => (
                        <span key={i} className="px-[8px] py-[3px]" style={{ fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--surface-2)', borderRadius: 'var(--r-pill)' }}>{r}</span>
                    ))}
                </div>
            </div>

            {/* Ödeme şeridi */}
            <div className="mt-[var(--s5)]">
                <div className="mb-[var(--s2)]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Ödeme geçmişi</div>
                <div className="flex items-center gap-[3px]">
                    {detail.paymentHistory.map(p => {
                        const cur = p.period.slice(0, 7) === todayISO().slice(0, 7)
                        const future = p.period.slice(0, 7) > todayISO().slice(0, 7)
                        return (
                            <div key={p.period} className="flex flex-1 flex-col items-center gap-[4px]">
                                <span className="inline-flex items-center justify-center rounded-full" style={{
                                    width: 20, height: 20,
                                    background: p.paid ? 'var(--flow-in)' : 'transparent',
                                    border: p.paid ? 'none' : `1.5px ${future ? 'dashed' : 'solid'} var(--ink-4)`,
                                    boxShadow: cur ? '0 0 0 2px var(--accent)' : 'none',
                                }}>{p.paid && <Check className="h-[11px] w-[11px]" style={{ color: '#fff' }} strokeWidth={3} />}</span>
                                <span style={{ fontSize: 9, color: cur ? 'var(--ink)' : 'var(--ink-3)', fontWeight: cur ? 700 : 400 }}>{TR_MON_LETTER[Number(p.period.slice(5, 7)) - 1]}</span>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Key metrics */}
            {detail.yearly.length > 0 && (
                <div className="mt-[var(--s5)]">
                    <div className="mb-[var(--s2)] flex items-baseline" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                        <span className="flex-1">Yıl</span><span className="w-[110px] text-right">Yıllık toplam</span><span className="w-[100px] text-right">Ort. ödeme</span>
                    </div>
                    {detail.yearly.map(y => (
                        <div key={y.year} className="flex items-baseline py-[var(--s2)]" style={{ borderTop: '1px solid var(--border)' }}>
                            <span className="tnum flex-1" style={{ fontSize: 14, color: 'var(--ink)' }}>{y.year}</span>
                            <span className="tnum w-[110px] text-right" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{formatTL(y.total)}</span>
                            <span className="tnum w-[100px] text-right" style={{ fontSize: 14, color: 'var(--ink-2)' }}>{formatTL(y.avg)}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Son kullanılan hesap */}
            {detail.lastAccount && (
                <div className="mt-[var(--s5)] flex items-center justify-between">
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Son hesap</span>
                    <span className="flex items-baseline gap-[var(--s2)]">
                        <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{accName.get(detail.lastAccount) ?? 'Hesap'}</span>
                        {detail.lastAmount != null && <span className="tnum" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{formatTL(detail.lastAmount)}</span>}
                    </span>
                </div>
            )}

            {/* Aksiyonlar */}
            <div className="mt-[var(--s5)] flex items-center gap-[var(--s4)] pt-[var(--s4)]" style={{ borderTop: '1px solid var(--border)' }}>
                <Link href="/subscriptions" className="inline-flex items-center gap-[var(--s2)]" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}><Pencil className="h-[14px] w-[14px]" /> Düzenle</Link>
                <button onClick={remove} className="inline-flex items-center gap-[var(--s2)]" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--flow-out)' }}><Trash2 className="h-[14px] w-[14px]" /> Sil</button>
            </div>
        </div>
    )
}

function EmptyState() {
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Takvime dizilecek yük yok.</p>
            <p className="mt-[var(--s2)]" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                Tarihi belli ödemeler burada takvime dizilir. <Link href="/subscriptions" style={{ color: 'var(--accent)' }}>Abonelik</Link> ya da <Link href="/credit-cards" style={{ color: 'var(--accent)' }}>taksit</Link> ekle.
            </p>
        </section>
    )
}
