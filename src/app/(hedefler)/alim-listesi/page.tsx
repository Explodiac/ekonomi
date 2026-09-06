'use client'

import { useState, useEffect, useMemo, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, X, ChevronDown, GripVertical, Plus } from "lucide-react"
import { buildProjection, type ProjectionInput } from "@/lib/projection"
import { buildUpcoming } from "@/lib/upcoming"
import { monthName, monthLocative, monthLabel } from "@/lib/upcoming"
import {
    buildPurchasePlan,
    type PurchasePlanItem,
    type ScheduledPurchase,
    type TimelineMonth,
    type PurchasePlanResult,
} from "@/lib/purchase-plan"
import { computePurchasePlanContext, type PurchasePlanContext } from "@/lib/purchase-plan-data"
import { computeInterest } from "@/lib/interest"
import { deriveAccountBalances } from "@/lib/balance"
import { PageHeader } from "@/components/ui/page-header"
import { PrimaryButton } from "@/components/ui/primary-button"

// ─── yardımcılar ─────────────────────────────────────────────────────────────

function formatTL(amount: number): string {
    const abs = Math.abs(Math.round(amount))
    const s = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs)
    return `${amount < 0 ? '−' : ''}${s} ₺`
}
function currentMonth(): string { return new Date().toISOString().slice(0, 7) }
function diffMonths(a: string, b: string): number {
    const [ay, am] = a.split('-').map(Number)
    const [by, bm] = b.split('-').map(Number)
    return (by - ay) * 12 + (bm - am)
}
const HORIZON = 24

// ─── DB tipleri ──────────────────────────────────────────────────────────────

type PlanRow = {
    id: string
    name: string
    amount: number
    priority: number
    desired_by: string | null
    monthly_extra: number | null
    payment_plan: 'pesin' | 'taksit'
    installment_count: number | null
    status: 'planli' | 'alindi' | 'vazgecildi'
    category_id: string | null
    note: string | null
}
type Category = { id: string; name: string; color: string | null; icon: string | null }

// ─── veri + motor ──────────────────────────────────────────────────────────────

function AlimListesiInner() {
    const searchParams = useSearchParams()
    const [rows, setRows] = useState<PlanRow[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [extras, setExtras] = useState<PurchasePlanContext | null>(null)
    // Faizli borç uyarısı: en yüksek borçlu hesap + kapatınca açılan aylık nefes payı.
    const [debtWarn, setDebtWarn] = useState<{ name: string; rate: number; debt: number; savedPerMonth: number; totalSaved: number } | null>(null)
    const [hhId, setHhId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [modalOpen, setModalOpen] = useState(false)
    const [editRow, setEditRow] = useState<PlanRow | null>(null)
    const [goalShare, setGoalShare] = useState<number | null>(null) // takas kaydırıcı; null = varsayılan
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ planli: true, alindi: false, vazgecildi: false })
    const [dragId, setDragId] = useState<string | null>(null)
    const [prefill, setPrefill] = useState<Partial<PlanRow> | null>(null)

    const load = useCallback(async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const id = await ensureHouseholdExists(user.id)
            if (!id) return
            setHhId(id)

            const [planRes, catRes, accRes, txRes, subRes, instRes, goalRes] = await Promise.all([
                supabase.from('purchase_plans').select('*').eq('household_id', id).order('priority', { ascending: true }),
                supabase.from('categories').select('id, name, type, color, icon, is_base_income').eq('household_id', id),
                supabase.from('accounts').select('id, name, type, opening_balance, balance, interest_rate').eq('household_id', id),
                supabase.from('transactions')
                    .select('id, account_id, category_id, amount, type, cash_date, description, source_type, spend_nature, source_id, transfer_direction')
                    .eq('household_id', id),
                supabase.from('subscriptions').select('id, name, amount, frequency, next_payment_date, status, end_date').eq('household_id', id),
                supabase.from('installments').select('id, description, kind, installment_payments(id, payment_date, amount)').eq('household_id', id),
                supabase.from('goals').select('id, name, monthly_alloc, status').eq('household_id', id),
            ])

            setRows((planRes.data || []) as PlanRow[])
            setCategories((catRes.data || []) as Category[])

            const transactions = (txRes.data || []) as any[]
            const installments = (instRes.data || []).map((i: any) => ({ ...i, payments: i.installment_payments || [] }))
            const subscriptions = (subRes.data || []) as any[]

            // Motor girdileri — tek yardımcı (dashboard ile ortak reçete).
            const projInput: ProjectionInput = {
                accounts: accRes.data || [], transactions, subscriptions, installments, contractPayments: [],
                goalAllocations: (goalRes.data || []).map((g: any) => ({ name: g.name, monthlyAlloc: g.monthly_alloc, status: g.status })),
            }
            const proj = buildProjection(projInput)
            const up = buildUpcoming({ transactions, subscriptions, installments }, { months: HORIZON })
            const cats = (catRes.data || []) as any[]
            const baseIncomeCategoryIds = cats.filter(c => c.type === 'income' && c.is_base_income).map(c => c.id)
            setExtras(computePurchasePlanContext({
                projection: proj, upcoming: up, transactions,
                goals: (goalRes.data || []) as any, currentMonth: currentMonth(),
                baseIncomeCategoryIds,
            }))

            // Faizli borç uyarısı — türetilmiş bakiye + hesap faiz oranından. Ödenen
            // faiz (varsa) source_type='faiz' hareketlerinden; uyarı ifPaidOff'a dayanır.
            const accts = accRes.data || []
            const interestTx = transactions.filter((t: any) => t.source_type === 'faiz')
            const derived = deriveAccountBalances(accts as any, transactions as any, { warn: false })
            const interest = computeInterest({
                accounts: accts.map((a: any) => ({ id: a.id, name: a.name, type: a.type, balance: derived.get(a.id) ?? a.balance, interest_rate: a.interest_rate })),
                transactions: interestTx, today: new Date().toISOString().slice(0, 10),
            })
            const top = interest.paidByAccount.find(p => p.debt > 0 && p.ifPaidOff)
            setDebtWarn(top && top.ifPaidOff
                ? { name: top.name || 'Hesap', rate: top.interestRate ?? 0, debt: top.debt, savedPerMonth: top.ifPaidOff.savedPerMonth, totalSaved: interest.ifPaidOff.savedPerMonth }
                : null)
        } catch (e) {
            console.error('Alım listesi verisi alınamadı:', e)
        } finally {
            setIsLoading(false)
        }
    }, [])
    useEffect(() => { load() }, [load])

    // Simülasyondan "listeye ekle": ?add=1&amount=&count=&extra=
    useEffect(() => {
        if (searchParams.get('add') !== '1') return
        const amount = Number(searchParams.get('amount')) || 0
        const count = Number(searchParams.get('count')) || 0
        setPrefill({
            amount,
            payment_plan: count > 1 ? 'taksit' : 'pesin',
            installment_count: count > 1 ? count : null,
            monthly_extra: Number(searchParams.get('extra')) || 0,
        })
        setEditRow(null)
        setModalOpen(true)
    }, [searchParams])

    // Takas: paylaşılan havuz = mevcut nefes payı + aktif hedef payı.
    const sharedPool = extras ? Math.round(extras.monthlyRoomBase + extras.goalAllocTotal) : 0
    const effectiveGoalShare = goalShare == null ? (extras?.goalAllocTotal ?? 0) : goalShare
    const monthlyRoom = Math.max(0, sharedPool - effectiveGoalShare)

    const plan: PurchasePlanResult | null = useMemo(() => {
        if (!extras) return null
        const items: PurchasePlanItem[] = rows.map(r => ({
            id: r.id, name: r.name, amount: Number(r.amount), priority: r.priority,
            paymentPlan: r.payment_plan, installmentCount: r.installment_count,
            desiredBy: r.desired_by, categoryId: r.category_id, status: r.status,
        }))
        return buildPurchasePlan({
            from: currentMonth(), months: HORIZON, monthlyRoom,
            reliefs: extras.reliefs, loads: extras.loads, plans: items,
        })
    }, [rows, extras, monthlyRoom])

    const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
    const scheduledById = useMemo(
        () => new Map((plan?.scheduled ?? []).map(s => [s.id, s])),
        [plan]
    )

    // Gruplar.
    const groups = useMemo(() => {
        const g = { planli: [] as PlanRow[], alindi: [] as PlanRow[], vazgecildi: [] as PlanRow[] }
        for (const r of rows) g[r.status].push(r)
        g.planli.sort((a, b) => a.priority - b.priority)
        return g
    }, [rows])

    // ── mutasyonlar ──
    const persistOrder = async (ordered: PlanRow[]) => {
        const updates = ordered.map((r, i) => ({ id: r.id, priority: i }))
        setRows(prev => prev.map(r => {
            const u = updates.find(x => x.id === r.id)
            return u ? { ...r, priority: u.priority } : r
        }))
        await Promise.all(updates.map(u => supabase.from('purchase_plans').update({ priority: u.priority }).eq('id', u.id)))
    }
    const onDrop = async (targetId: string) => {
        if (!dragId || dragId === targetId) { setDragId(null); return }
        const list = [...groups.planli]
        const from = list.findIndex(r => r.id === dragId)
        const to = list.findIndex(r => r.id === targetId)
        if (from < 0 || to < 0) { setDragId(null); return }
        const [moved] = list.splice(from, 1)
        list.splice(to, 0, moved)
        setDragId(null)
        await persistOrder(list)
    }
    const setStatus = async (id: string, status: PlanRow['status']) => {
        setRows(prev => prev.map(r => r.id === id ? { ...r, status } : r))
        await supabase.from('purchase_plans').update({ status }).eq('id', id)
    }
    const removeRow = async (id: string) => {
        if (!confirm('Bu alımı listeden kaldırmak istiyor musun?')) return
        setRows(prev => prev.filter(r => r.id !== id))
        if (selectedId === id) setSelectedId(null)
        await supabase.from('purchase_plans').delete().eq('id', id)
    }

    if (isLoading) {
        return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }

    const selected = selectedId ? scheduledById.get(selectedId) ?? null : null
    const loadMonths = extras?.loads ?? []
    const openEdit = (r: PlanRow) => { setEditRow(r); setPrefill(null); setModalOpen(true) }

    const rightPanel = (
        <div className="p-[22px]">
            {selected
                ? <SelectedDetail selected={selected} plan={plan!} rows={rows} horizon={HORIZON} loadMonths={loadMonths}
                    onClose={() => setSelectedId(null)}
                    onEdit={openEdit} onStatus={setStatus} onRemove={removeRow} />
                : <TimelineHeader monthlyRoom={monthlyRoom} summary={plan?.summary} />}
            {plan && (
                <Timeline timeline={plan.timeline} catById={catById} selected={selected} scheduledById={scheduledById} />
            )}
        </div>
    )

    return (
        <div className="w-full pb-10">
            <div className="mb-[var(--s4)] flex items-center justify-between gap-[var(--s3)]">
                <PageHeader title="Alım listesi" subtitle="Planladığın alımları sıraya diz; nefes payına göre ne zaman alınacağını gör." />
                <PrimaryButton onClick={() => { setEditRow(null); setPrefill(null); setModalOpen(true) }} className="flex shrink-0 items-center gap-[6px]">
                    <Plus className="h-4 w-4" /> Alım ekle
                </PrimaryButton>
            </div>

            {rows.length === 0 ? (
                <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                    <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>İlk alımını ekle</p>
                    <p className="mt-[var(--s2)]" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                        Almak istediğin şeyleri öncelik sırasıyla ekle; nefes payın hepsini ne zaman kaldırır, zaman çizelgesinde gör.{' '}
                        <Link href="/simulations/asset-purchase" className="hover:underline" style={{ color: 'var(--accent)' }}>Tek bir alımı önce simüle et.</Link>
                    </p>
                    <div className="mt-[var(--s4)]"><PrimaryButton onClick={() => { setEditRow(null); setModalOpen(true) }}>İlk alımını ekle</PrimaryButton></div>
                </section>
            ) : (
                <div className="flex items-start gap-[var(--s3)]">
                    {/* SOL PANEL */}
                    <div className="flex min-w-0 flex-1 flex-col gap-[var(--s3)]">
                        {plan && <SummaryCard summary={plan.summary} />}
                        {extras && !extras.hasBaseIncome && (
                            <section className="p-[var(--s4)]" style={{ background: 'color-mix(in srgb, var(--flow-out) 10%, var(--surface))', borderRadius: 'var(--r-card)', border: '1px solid color-mix(in srgb, var(--flow-out) 30%, transparent)' }}>
                                <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                                    Hiçbir gelir kategorisi <b style={{ color: 'var(--ink)' }}>&quot;düzenli&quot;</b> işaretli değil — nefes payı hesaplanamıyor.{' '}
                                    <Link href="/settings" className="hover:underline" style={{ color: 'var(--accent)' }}>Ayarlar &gt; Kategoriler</Link>&apos;den maaşını işaretle.
                                </p>
                            </section>
                        )}
                        {extras && extras.hasBaseIncome && (
                            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-3)' }}>
                                Aylık düzenli gelir <b className="tnum" style={{ color: 'var(--ink-2)' }}>{formatTL(extras.baseIncome)}</b> üzerinden. Prim ve ek gelir dahil değil.
                            </p>
                        )}
                        {extras && sharedPool > 0 && (
                            <TakasBar sharedPool={sharedPool} goalShare={effectiveGoalShare} monthlyRoom={monthlyRoom}
                                isDefault={goalShare == null}
                                onChange={setGoalShare} onReset={() => setGoalShare(null)}
                                hhId={hhId} />
                        )}
                        {debtWarn && debtWarn.savedPerMonth > 0 && <DebtWarning w={debtWarn} />}
                        {plan && plan.warnings.length > 0 && <WarningsCard warnings={plan.warnings} />}

                        <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="overflow-hidden py-[var(--s2)]">
                            <PlanGroup title="Planlı" gkey="planli" rows={groups.planli} sortable
                                open={openGroups.planli} onToggle={() => setOpenGroups(s => ({ ...s, planli: !s.planli }))}
                                scheduledById={scheduledById} catById={catById} rowsAll={rows} horizon={HORIZON} loadMonths={loadMonths}
                                selectedId={selectedId} onSelect={setSelectedId}
                                dragId={dragId} onDragStart={setDragId} onDropRow={onDrop} />
                            <PlanGroup title="Alındı" gkey="alindi" rows={groups.alindi}
                                open={openGroups.alindi} onToggle={() => setOpenGroups(s => ({ ...s, alindi: !s.alindi }))}
                                scheduledById={scheduledById} catById={catById} rowsAll={rows} horizon={HORIZON} loadMonths={loadMonths} faded
                                selectedId={selectedId} onSelect={setSelectedId} />
                            <PlanGroup title="Vazgeçildi" gkey="vazgecildi" rows={groups.vazgecildi}
                                open={openGroups.vazgecildi} onToggle={() => setOpenGroups(s => ({ ...s, vazgecildi: !s.vazgecildi }))}
                                scheduledById={scheduledById} catById={catById} rowsAll={rows} horizon={HORIZON} loadMonths={loadMonths} faded
                                selectedId={selectedId} onSelect={setSelectedId} />
                        </div>
                    </div>

                    {/* SAĞ PANEL — masaüstü sticky */}
                    <aside className="hidden w-[420px] shrink-0 lg:block">
                        <div className="sticky top-[var(--s3)] overflow-hidden" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                            {rightPanel}
                        </div>
                    </aside>
                </div>
            )}

            {/* Mobil bottom sheet — seçili alım detayı */}
            {selected && (
                <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setSelectedId(null)}>
                    <div className="max-h-[90vh] overflow-y-auto" style={{ background: 'var(--surface)', borderTopLeftRadius: 'var(--r-card)', borderTopRightRadius: 'var(--r-card)' }} onClick={e => e.stopPropagation()}>
                        {rightPanel}
                    </div>
                </div>
            )}

            {modalOpen && hhId && (
                <PlanModal
                    hhId={hhId} categories={categories} editRow={editRow} prefill={prefill}
                    nextPriority={groups.planli.length}
                    onClose={() => { setModalOpen(false); setEditRow(null); setPrefill(null) }}
                    onSaved={() => { setModalOpen(false); setEditRow(null); setPrefill(null); load() }}
                />
            )}

        </div>
    )
}

// ─── üst özet ────────────────────────────────────────────────────────────────

function SummaryCard({ summary }: { summary: PurchasePlanResult['summary'] }) {
    const done = summary.completionMonth
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div className="tnum" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                {summary.count} alım planı · toplam {formatTL(summary.totalAmount)}
            </div>
            <div className="mt-[2px]" style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
                {done && summary.allPlaced
                    ? <>Mevcut nefes payınla <span className="tnum" style={{ color: 'var(--ink-2)' }}>{summary.completionInMonths} ayda</span> ({monthLabel(done)}) tamamlanır.</>
                    : done
                        ? <>Bazıları ufka sığmıyor; sığanlar {monthLabel(done)}&apos;e kadar tamamlanır.</>
                        : <>Nefes payın bu alımları {HORIZON} ay içinde kaldırmıyor.</>}
            </div>
        </section>
    )
}

// ─── takas kaydırıcısı ───────────────────────────────────────────────────────

function TakasBar({ sharedPool, goalShare, monthlyRoom, isDefault, onChange, onReset, hhId }: {
    sharedPool: number; goalShare: number; monthlyRoom: number; isDefault: boolean
    onChange: (v: number) => void; onReset: () => void; hhId: string | null
}) {
    const step = 500
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div className="mb-[var(--s3)]" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Hedef / alım dağılımı</div>
            <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                Nefes payın <b className="tnum" style={{ color: 'var(--ink)' }}>{formatTL(sharedPool)}</b>. Hedeflere{' '}
                <b className="tnum" style={{ color: 'var(--ink)' }}>{formatTL(goalShare)}</b>, alımlara{' '}
                <b className="tnum" style={{ color: 'var(--accent)' }}>{formatTL(monthlyRoom)}</b> kalıyor.
            </p>
            <input type="range" min={0} max={sharedPool} step={step} value={goalShare}
                onChange={e => onChange(Number(e.target.value))}
                className="mt-[var(--s3)] w-full" style={{ accentColor: 'var(--accent)' }} />
            <div className="mt-[var(--s2)] flex items-center justify-between" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                <span>Hepsi alıma</span>
                <span>Hepsi hedefe</span>
            </div>
            {!isDefault && (
                <p className="mt-[var(--s3)] flex items-center justify-between gap-[var(--s2)]" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    <span>Bu sadece simülasyon — hedeflerin aylık payını değiştirmez.</span>
                    <button onClick={onReset} style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Sıfırla</button>
                </p>
            )}
        </section>
    )
}

// ─── uyarılar ────────────────────────────────────────────────────────────────

function DebtWarning({ w }: { w: { name: string; rate: number; debt: number; savedPerMonth: number } }) {
    return (
        <section style={{ background: 'color-mix(in srgb, var(--flow-out) 8%, var(--surface))', borderRadius: 'var(--r-card)', border: '1px solid color-mix(in srgb, var(--flow-out) 30%, transparent)' }} className="p-[var(--s4)]">
            <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>
                <b style={{ color: 'var(--ink)' }}>{w.name}</b>&apos;da{w.rate > 0 ? <> %<span className="tnum">{Math.round(w.rate)}</span> faizle</> : ''}{' '}
                <b className="tnum" style={{ color: 'var(--ink)' }}>{formatTL(w.debt)}</b> borcun var. Bu borcu kapatmak aylık{' '}
                <b className="tnum" style={{ color: 'var(--flow-out)' }}>{formatTL(w.savedPerMonth)}</b> nefes payı açar — alımlardan önce değerlendir.
            </p>
        </section>
    )
}

function WarningsCard({ warnings }: { warnings: string[] }) {
    return (
        <section style={{ background: 'color-mix(in srgb, var(--budget-near) 10%, var(--surface))', borderRadius: 'var(--r-card)', border: '1px solid color-mix(in srgb, var(--budget-near) 30%, transparent)' }} className="space-y-[var(--s2)] p-[var(--s4)]">
            {warnings.map((w, i) => (
                <p key={i} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>{w}</p>
            ))}
        </section>
    )
}

// ─── liste grubu + satır ─────────────────────────────────────────────────────

function PlanGroup({ title, gkey, rows, open, onToggle, scheduledById, catById, rowsAll, horizon, loadMonths, selectedId, onSelect, sortable, faded, dragId, onDragStart, onDropRow }: {
    title: string; gkey: string; rows: PlanRow[]; open: boolean; onToggle: () => void
    scheduledById: Map<string, ScheduledPurchase>; catById: Map<string, Category>; rowsAll: PlanRow[]; horizon: number
    loadMonths: { month: string; reason?: string }[]
    selectedId: string | null; onSelect: (id: string) => void
    sortable?: boolean; faded?: boolean; dragId?: string | null
    onDragStart?: (id: string) => void; onDropRow?: (id: string) => void
}) {
    if (rows.length === 0) return null
    return (
        <div>
            <button onClick={onToggle} className="flex w-full items-center gap-[var(--s2)] px-[22px] pb-[var(--s1)] pt-[var(--s3)]">
                <ChevronDown className="h-[13px] w-[13px] transition-transform" style={{ color: 'var(--ink-3)', transform: open ? 'none' : 'rotate(-90deg)' }} />
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{title}</span>
                <span className="tnum" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{rows.length}</span>
            </button>
            {open && (
                <ul>
                    {rows.map((r, i) => (
                        <PlanRowItem key={r.id} row={r} order={i + 1} sched={scheduledById.get(r.id)}
                            cat={r.category_id ? catById.get(r.category_id) : undefined}
                            rowsAll={rowsAll} horizon={horizon} loadMonths={loadMonths}
                            selected={r.id === selectedId} onSelect={() => onSelect(r.id)} faded={faded}
                            sortable={sortable} dragging={dragId === r.id}
                            onDragStart={onDragStart} onDropRow={onDropRow} />
                    ))}
                </ul>
            )}
        </div>
    )
}

function PlanRowItem({ row, order, sched, cat, rowsAll, horizon, loadMonths, selected, onSelect, faded, sortable, dragging, onDragStart, onDropRow }: {
    row: PlanRow; order: number; sched?: ScheduledPurchase; cat?: Category; rowsAll: PlanRow[]; horizon: number
    loadMonths: { month: string; reason?: string }[]
    selected: boolean; onSelect: () => void; faded?: boolean
    sortable?: boolean; dragging?: boolean; onDragStart?: (id: string) => void; onDropRow?: (id: string) => void
}) {
    const planLabel = row.payment_plan === 'taksit' ? `${row.installment_count ?? '?'} taksit` : 'peşin'
    const reason = sched ? reasonSentence(sched, rowsAll, horizon, loadMonths) : null
    const late = sched?.reasonCode === 'gec_kaldi' || sched?.reasonCode === 'ufukta_yok'

    return (
        <li
            draggable={sortable}
            onDragStart={() => onDragStart?.(row.id)}
            onDragOver={e => { if (sortable) e.preventDefault() }}
            onDrop={() => onDropRow?.(row.id)}
            style={{ opacity: dragging ? 0.4 : 1 }}
        >
            <button onClick={onSelect}
                className="flex w-full items-center gap-[var(--s3)] px-[22px] py-[11px] text-left transition-colors"
                style={{ background: selected ? 'var(--surface-2)' : 'transparent', boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : 'none', opacity: faded ? 0.6 : 1 }}>
                {sortable && (
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab" style={{ color: 'var(--ink-4)' }} aria-hidden />
                )}
                <span className="tnum shrink-0 text-center" style={{ width: 18, fontSize: 12.5, color: 'var(--ink-3)' }}>{order}</span>
                <span className="inline-block h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: cat?.color || 'var(--ink-4)' }} aria-hidden />
                <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: 14, color: 'var(--ink)' }}>{row.name}</div>
                    <div className="tnum mt-[2px]" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        {formatTL(Number(row.amount))} · {planLabel}
                        {sched?.recommendedLabel && <> · <span style={{ color: late ? 'var(--flow-out)' : 'var(--ink-2)' }}>{sched.recommendedLabel}</span></>}
                        {sched && !sched.recommendedMonth && <> · <span style={{ color: 'var(--flow-out)' }}>sığmıyor</span></>}
                    </div>
                    {reason && <div className="truncate" style={{ fontSize: 11.5, color: late ? 'var(--flow-out)' : 'var(--ink-4)' }}>{reason}</div>}
                </div>
            </button>
        </li>
    )
}

// ─── reasonCode → cümle ──────────────────────────────────────────────────────

function reasonSentence(s: ScheduledPurchase, rowsAll: PlanRow[], horizon: number, loadMonths: { month: string; reason?: string }[] = []): string {
    const from = currentMonth()
    switch (s.reasonCode) {
        case 'yeterli': return 'nefes payı yetiyor'
        case 'relief': {
            const m = s.recommendedMonth!
            const rel = s.reason.match(/^(.+) taksidi/) // motor gerekçesinde etiket taşır
            const label = rel ? rel[1] : null
            return label ? `${cap(monthLocative(m))} ${label.toLocaleLowerCase('tr')} taksidi bitiyor` : `${cap(monthLocative(m))} bir taksit bitiyor`
        }
        case 'birikim': {
            const n = s.recommendedMonth ? diffMonths(from, s.recommendedMonth) : 0
            return `${n} ay birikim gerekiyor`
        }
        case 'taksit_bekledi': return 'önceki taksitler bitene kadar bekliyor'
        case 'yuk_atlandi': {
            // recommendedMonth'tan önceki en yakın lumpy yük ayını adlandır.
            const before = loadMonths.filter(l => s.recommendedMonth && l.month < s.recommendedMonth!).sort((a, b) => b.month.localeCompare(a.month))[0]
            if (before) return `${cap(monthName(before.month))} dar${before.reason ? ` (${before.reason})` : ''}, atlandı`
            return 'dar ay atlandı'
        }
        case 'gec_kaldi': {
            const row = rowsAll.find(r => r.id === s.id)
            if (row?.desired_by && s.recommendedMonth) {
                const x = diffMonths(row.desired_by.slice(0, 7), s.recommendedMonth)
                return `istediğin tarihten ${x} ay sonra`
            }
            return 'istenen tarihe yetişmiyor'
        }
        case 'ufukta_yok': return `${horizon} ay içinde sığmıyor`
    }
}
function cap(s: string): string { return s.charAt(0).toLocaleUpperCase('tr') + s.slice(1) }

// ─── sağ panel başlığı (seçim yokken) ────────────────────────────────────────

function TimelineHeader({ monthlyRoom, summary }: { monthlyRoom: number; summary?: PurchasePlanResult['summary'] }) {
    return (
        <div className="mb-[var(--s4)]">
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Zaman çizelgesi</div>
            <p className="mt-[var(--s2)] tnum" style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                Aylık akış <b style={{ color: 'var(--ink)' }}>{formatTL(monthlyRoom)}</b>. Bir alıma dokun, detayını gör.
            </p>
        </div>
    )
}

// ─── zaman çizelgesi şeridi ──────────────────────────────────────────────────

function Timeline({ timeline, catById, selected, scheduledById }: {
    timeline: TimelineMonth[]; catById: Map<string, Category>
    selected: ScheduledPurchase | null; scheduledById: Map<string, ScheduledPurchase>
}) {
    const maxBase = Math.max(1, ...timeline.map(m => m.baseRoom))
    const BAR = 108
    const h = (v: number) => Math.max(0, (v / maxBase) * BAR)

    // Seçili alımın meşgul ettiği aylar (vurgulama için).
    const occ = new Set<string>()
    if (selected?.recommendedMonth) {
        if (selected.paymentPlan === 'taksit' && selected.completionMonth) {
            for (const m of timeline) if (m.month >= selected.recommendedMonth && m.month <= selected.completionMonth) occ.add(m.month)
        } else {
            // peşin: birikim ayları (baştan tamamlanma ayına) + alım ayı
            for (const m of timeline) if (m.month <= selected.recommendedMonth) occ.add(m.month)
        }
    }

    return (
        <div>
            {/* Lejant */}
            <div className="mb-[var(--s2)] flex flex-wrap items-center gap-x-[var(--s3)] gap-y-[4px]" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                <Legend color="var(--ink)" label="taksit taahhüdü" />
                <Legend color="var(--ink-3)" label="birikim rezervi" />
                <Legend color="var(--fill-track)" label="serbest" />
                <Legend color="var(--flow-out)" label="yük (kasko/MTV)" />
                <span className="flex items-center gap-[4px]"><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)' }} /> taksit bitişi</span>
            </div>

            <div className="overflow-x-auto pb-[var(--s2)]">
                <div className="flex items-end gap-[3px]" style={{ minWidth: timeline.length * 22 }}>
                    {timeline.map(m => {
                        const dim = selected != null && !occ.has(m.month)
                        const startsHere = m.placements.filter(p => p.isStart)
                        return (
                            <div key={m.month} className="flex flex-1 flex-col items-center" style={{ minWidth: 19, opacity: dim ? 0.35 : 1 }}>
                                {/* alım başlangıç noktaları — kategori renginde */}
                                <div className="mb-[3px] flex min-h-[10px] flex-col items-center gap-[2px]">
                                    {startsHere.map(p => {
                                        const c = p.categoryId ? catById.get(p.categoryId) : undefined
                                        const isSel = selected?.id === p.id
                                        return <span key={p.id} title={p.name}
                                            className="inline-block rounded-full"
                                            style={{ width: isSel ? 9 : 7, height: isSel ? 9 : 7, background: c?.color || 'var(--accent)', boxShadow: isSel ? '0 0 0 2px var(--surface), 0 0 0 3px var(--accent)' : 'none' }} />
                                    })}
                                </div>
                                {/* yığılmış bar */}
                                <div className="relative flex w-full flex-col justify-end overflow-hidden" style={{ height: BAR, borderRadius: 3 }}>
                                    {m.load > 0 && <div style={{ height: h(m.load), background: 'var(--flow-out)' }} title={m.loads.map(l => l.reason).filter(Boolean).join(', ')} />}
                                    <div style={{ height: h(m.freeFlow), background: 'var(--fill-track)' }} />
                                    <div style={{ height: h(m.reservedSavings), background: 'var(--ink-3)' }} />
                                    <div style={{ height: h(m.committedInstallments), background: 'var(--ink)' }} />
                                </div>
                                {/* relief işareti */}
                                <div className="mt-[3px] flex h-[8px] items-center justify-center">
                                    {m.reliefs.length > 0 && <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--accent)' }} title={m.reliefs.map(r => r.label).filter(Boolean).join(', ')} />}
                                </div>
                                {/* ay harfi */}
                                <span style={{ fontSize: 9, color: m.isTight ? 'var(--flow-out)' : 'var(--ink-4)' }}>{monthName(m.month).slice(0, 1)}</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
function Legend({ color, label }: { color: string; label: string }) {
    return <span className="flex items-center gap-[4px]"><span style={{ width: 8, height: 8, borderRadius: 2, background: color }} /> {label}</span>
}

// ─── seçili alım detayı ──────────────────────────────────────────────────────

function SelectedDetail({ selected, plan, rows, horizon, loadMonths, onClose, onEdit, onStatus, onRemove }: {
    selected: ScheduledPurchase; plan: PurchasePlanResult; rows: PlanRow[]; horizon: number
    loadMonths: { month: string; reason?: string }[]
    onClose: () => void
    onEdit: (r: PlanRow) => void; onStatus: (id: string, s: PlanRow['status']) => void; onRemove: (id: string) => void
}) {
    const s = selected
    const row = rows.find(r => r.id === s.id)
    const late = s.reasonCode === 'gec_kaldi' || s.reasonCode === 'ufukta_yok'

    // Ardında bekleyenler: daha düşük öncelikli, bu alımın bitişinden sonra yerleşen planlılar.
    const behind = plan.scheduled.filter(o =>
        o.id !== s.id && o.recommendedMonth && s.completionMonth &&
        o.recommendedMonth >= s.completionMonth &&
        plan.scheduled.indexOf(o) > plan.scheduled.indexOf(s)
    )

    return (
        <div className="mb-[var(--s4)]">
            <div className="mb-[var(--s3)] flex items-center justify-between">
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Alım</span>
                <button onClick={onClose} aria-label="Kapat">
                    <ChevronDown className="h-[18px] w-[18px] lg:hidden" style={{ color: 'var(--ink-3)' }} />
                    <X className="hidden h-[16px] w-[16px] lg:inline" style={{ color: 'var(--ink-3)' }} />
                </button>
            </div>

            <div className="flex items-start justify-between gap-[var(--s3)]">
                <h2 className="min-w-0 truncate" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{s.name}</h2>
                <div className="shrink-0 text-right">
                    <div className="tnum" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>{formatTL(s.amount)}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.paymentPlan === 'taksit' ? `${s.installmentCount} taksit` : 'peşin'}</div>
                </div>
            </div>

            {/* Önerilen ay + gerekçe */}
            <div className="mt-[var(--s4)] rounded-[var(--r-button)] p-[var(--s3)]" style={{ background: 'var(--surface-2)' }}>
                {s.recommendedMonth ? (
                    <>
                        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Önerilen ay</div>
                        <div className="tnum" style={{ fontSize: 16, fontWeight: 600, color: late ? 'var(--flow-out)' : 'var(--ink)' }}>{s.recommendedLabel}</div>
                        <div className="mt-[2px]" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{reasonSentence(s, rows, horizon, loadMonths)}</div>
                    </>
                ) : (
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--flow-out)' }}>{horizon} ay içinde sığmıyor</div>
                )}
            </div>

            {/* Aylık çekiş + bitiş */}
            <dl className="mt-[var(--s3)] space-y-[var(--s2)]">
                <Fact k="Aylık çekiş" v={s.paymentPlan === 'taksit' ? `${formatTL(s.monthlyAmount)} × ${s.installmentCount} ay` : `${formatTL(s.amount)} (birikimle)`} />
                {s.completionMonth && s.paymentPlan === 'taksit' && <Fact k="Biter" v={monthLabel(s.completionMonth)} />}
                {row?.monthly_extra ? <Fact k="Aylık ek maliyet" v={formatTL(Number(row.monthly_extra))} /> : null}
            </dl>

            {/* Ardında bekleyenler */}
            {behind.length > 0 && (
                <p className="mt-[var(--s3)]" style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>
                    Ardında bekleyenler: <span style={{ color: 'var(--ink-2)' }}>{behind.map(b => b.name).join(', ')}</span>. Bu alım öne alınırsa onlar kayar.
                </p>
            )}

            {/* 'Alındı' işaretlenince taksit/hareket önerisi */}
            {row?.status === 'alindi' && (
                <p className="mt-[var(--s4)] rounded-[var(--r-button)] p-[var(--s3)]" style={{ background: 'var(--accent-bg)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)' }}>
                    Bunu gerçek bir kayda dönüştür: {row.payment_plan === 'taksit'
                        ? <>bir <b>taksit</b> planı olarak ekle,</>
                        : <>bir <b>harcama</b> olarak gir,</>} böylece nefes payı ve yaklaşan yüklere yansısın.
                </p>
            )}

            {/* Aksiyonlar */}
            {row && (
                <div className="mt-[var(--s4)] flex flex-wrap items-center gap-[var(--s2)] pt-[var(--s3)]" style={{ borderTop: '1px solid var(--border)' }}>
                    <button onClick={() => onEdit(row)} className="px-[var(--s3)] py-[6px]" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', borderRadius: 'var(--r-button)', fontSize: 12.5, fontWeight: 600 }}>Düzenle</button>
                    {row.status !== 'alindi' && (
                        <button onClick={() => onStatus(row.id, 'alindi')} className="px-[var(--s3)] py-[6px]" style={{ background: 'color-mix(in srgb, var(--flow-in) 16%, transparent)', color: 'var(--flow-in)', borderRadius: 'var(--r-button)', fontSize: 12.5, fontWeight: 600 }}>Alındı</button>
                    )}
                    {row.status !== 'planli' && (
                        <button onClick={() => onStatus(row.id, 'planli')} className="px-[var(--s3)] py-[6px]" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', borderRadius: 'var(--r-button)', fontSize: 12.5, fontWeight: 600 }}>Planlıya al</button>
                    )}
                    {row.status !== 'vazgecildi' && (
                        <button onClick={() => onStatus(row.id, 'vazgecildi')} className="px-[var(--s3)] py-[6px]" style={{ background: 'var(--surface-2)', color: 'var(--ink-3)', borderRadius: 'var(--r-button)', fontSize: 12.5 }}>Vazgeç</button>
                    )}
                    <button onClick={() => onRemove(row.id)} className="ml-auto px-[var(--s3)] py-[6px]" style={{ color: 'var(--flow-out)', fontSize: 12.5, fontWeight: 600 }}>Kaldır</button>
                </div>
            )}
        </div>
    )
}
function Fact({ k, v }: { k: string; v: string }) {
    return (
        <div className="flex items-baseline justify-between gap-[var(--s3)]">
            <dt style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{k}</dt>
            <dd className="tnum" style={{ fontSize: 13, color: 'var(--ink)' }}>{v}</dd>
        </div>
    )
}

// ─── ekle / düzenle modalı ───────────────────────────────────────────────────

function PlanModal({ hhId, categories, editRow, prefill, nextPriority, onClose, onSaved }: {
    hhId: string; categories: Category[]; editRow: PlanRow | null; prefill: Partial<PlanRow> | null
    nextPriority: number; onClose: () => void; onSaved: () => void
}) {
    const src = editRow ?? prefill
    const [name, setName] = useState(src?.name ?? '')
    const [amount, setAmount] = useState<number>(Number(src?.amount) || 0)
    const [paymentPlan, setPaymentPlan] = useState<'pesin' | 'taksit'>(src?.payment_plan ?? 'pesin')
    const [count, setCount] = useState<number>(src?.installment_count ?? 3)
    const [desiredBy, setDesiredBy] = useState<string>(src?.desired_by ? src.desired_by.slice(0, 7) : '')
    const [monthlyExtra, setMonthlyExtra] = useState<number>(Number(src?.monthly_extra) || 0)
    const [categoryId, setCategoryId] = useState<string>(src?.category_id ?? '')
    const [note, setNote] = useState<string>(src?.note ?? '')
    const [saving, setSaving] = useState(false)

    const canSave = name.trim().length > 0 && amount > 0 && (paymentPlan === 'pesin' || count >= 2)

    const save = async () => {
        if (!canSave) return
        setSaving(true)
        try {
            const payload = {
                household_id: hhId,
                name: name.trim(),
                amount,
                payment_plan: paymentPlan,
                installment_count: paymentPlan === 'taksit' ? count : null,
                desired_by: desiredBy ? `${desiredBy}-01` : null,
                monthly_extra: monthlyExtra || 0,
                category_id: categoryId || null,
                note: note.trim() || null,
            }
            if (editRow) {
                await supabase.from('purchase_plans').update(payload).eq('id', editRow.id)
            } else {
                await supabase.from('purchase_plans').insert({ ...payload, priority: nextPriority, status: 'planli' })
            }
            onSaved()
        } catch (e) { console.error('Alım kaydedilemedi:', e) } finally { setSaving(false) }
    }

    const inputStyle = { background: 'var(--bg)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 15 } as const

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
            <div className="w-full max-w-md rounded-[var(--r-card)] p-[var(--s5)]" style={{ background: 'var(--surface)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                <div className="mb-[var(--s4)] flex items-center justify-between">
                    <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{editRow ? 'Alımı düzenle' : 'Alım ekle'}</span>
                    <button onClick={onClose} aria-label="Kapat"><X className="h-5 w-5" style={{ color: 'var(--ink-3)' }} /></button>
                </div>

                <div className="space-y-[var(--s4)]">
                    <Field label="Ne alınacak">
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="Buzdolabı"
                            className="w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={inputStyle} />
                    </Field>
                    <Field label="Tutar">
                        <input type="number" min={0} step={1000} value={amount || ''} onChange={e => setAmount(Number(e.target.value) || 0)}
                            className="tnum w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={inputStyle} />
                    </Field>
                    <Field label="Ödeme planı">
                        <div className="flex gap-[var(--s2)]">
                            {(['pesin', 'taksit'] as const).map(pp => (
                                <button key={pp} onClick={() => setPaymentPlan(pp)}
                                    className="flex-1 py-[var(--s2)]" style={{
                                        background: paymentPlan === pp ? 'var(--accent-bg)' : 'var(--bg)',
                                        color: paymentPlan === pp ? 'var(--accent)' : 'var(--ink-2)',
                                        borderRadius: 'var(--r-button)', fontSize: 14, fontWeight: paymentPlan === pp ? 600 : 400,
                                    }}>{pp === 'pesin' ? 'Peşin' : 'Taksit'}</button>
                            ))}
                        </div>
                    </Field>
                    {paymentPlan === 'taksit' && (
                        <Field label={`Taksit sayısı: ${count}`}>
                            <input type="range" min={2} max={24} step={1} value={count} onChange={e => setCount(Number(e.target.value))} className="w-full" style={{ accentColor: 'var(--accent)' }} />
                        </Field>
                    )}
                    <Field label="İstenen tarih (opsiyonel)">
                        <input type="month" value={desiredBy} onChange={e => setDesiredBy(e.target.value)}
                            className="w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={inputStyle} />
                    </Field>
                    <Field label="Aylık ek maliyet (sahip olma — opsiyonel)">
                        <input type="number" min={0} step={100} value={monthlyExtra || ''} placeholder="0" onChange={e => setMonthlyExtra(Number(e.target.value) || 0)}
                            className="tnum w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={inputStyle} />
                    </Field>
                    <Field label="Kategori (opsiyonel)">
                        <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
                            className="w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={inputStyle}>
                            <option value="">—</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </Field>
                    <Field label="Not (opsiyonel)">
                        <input value={note} onChange={e => setNote(e.target.value)}
                            className="w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={inputStyle} />
                    </Field>
                </div>

                <div className="mt-[var(--s5)] flex justify-end gap-[var(--s2)]">
                    <button onClick={onClose} className="px-[var(--s4)] py-[var(--s2)]" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', borderRadius: 'var(--r-button)', fontSize: 14 }}>Vazgeç</button>
                    <PrimaryButton onClick={save} disabled={!canSave || saving}>{saving ? 'Kaydediliyor…' : editRow ? 'Kaydet' : 'Ekle'}</PrimaryButton>
                </div>
            </div>
        </div>
    )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-[var(--s2)]" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>{label}</div>
            {children}
        </div>
    )
}

export default function AlimListesiPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>}>
            <AlimListesiInner />
        </Suspense>
    )
}
