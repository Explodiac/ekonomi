'use client'

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, ArrowUpRight } from "lucide-react"
import { buildProjection, type ProjectionInput, type ProjectionResult, type ProjectionMonth, type ProjectionLine } from "@/lib/projection"
import { monthLabel, monthName } from "@/lib/upcoming"
import { CategoryPill } from "@/components/dashboard/category-tile"
import { Segmented } from "@/components/ui/segmented"
import { PageHeader } from "@/components/ui/page-header"

function formatTL(amount: number): string {
    const abs = Math.abs(Math.round(amount))
    const s = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs)
    return `${amount < 0 ? '−' : ''}${s} ₺`
}
function monthEnd(mk: string) { const [y, m] = mk.split('-').map(Number); return `${mk}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }

type Scenario = 'temkinli' | 'beklenen'

export default function NakitPage() {
    const [input, setInput] = useState<ProjectionInput | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [scenario, setScenario] = useState<Scenario>('temkinli')

    useEffect(() => {
        const load = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return
                const hhId = await ensureHouseholdExists(user.id)
                if (!hhId) return
                const [accRes, txRes, subRes, instRes, contractRes, goalRes] = await Promise.all([
                    supabase.from('accounts').select('id, type, opening_balance, balance').eq('household_id', hhId),
                    supabase.from('transactions').select('id, account_id, category_id, amount, type, cash_date, description, source_type, source_id, transfer_direction, categories(name)').eq('household_id', hhId),
                    supabase.from('subscriptions').select('id, name, amount, frequency, next_payment_date, status').eq('household_id', hhId),
                    supabase.from('installments').select('id, description, kind, installment_payments(id, payment_date, amount)').eq('household_id', hhId),
                    supabase.from('contracts').select('id, name, contract_payments(id, amount, expected_date, status)').eq('household_id', hhId),
                    supabase.from('goals').select('name, monthly_alloc, status').eq('household_id', hhId),
                ])
                const transactions = (txRes.data || []).map((t: any) => ({ ...t, categoryName: t.categories?.name ?? null }))
                const contractPayments = (contractRes.data || []).flatMap((c: any) =>
                    (c.contract_payments || []).filter((p: any) => p.status === 'pending').map((p: any) => ({ ...p, contract_id: c.id, contractName: c.name })))
                setInput({
                    accounts: accRes.data || [],
                    transactions,
                    subscriptions: subRes.data || [],
                    installments: (instRes.data || []).map((i: any) => ({ ...i, payments: i.installment_payments || [] })),
                    contractPayments,
                    goalAllocations: (goalRes.data || []).map((g: any) => ({ name: g.name, monthlyAlloc: g.monthly_alloc, status: g.status })),
                })
            } catch (e) {
                console.error('Nakit görünümü hesaplanamadı:', e)
            } finally {
                setIsLoading(false)
            }
        }
        load()
    }, [])

    const result = useMemo<ProjectionResult | null>(
        () => input ? buildProjection(input, { conservative: scenario === 'temkinli' }) : null,
        [input, scenario])

    if (isLoading) {
        return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }

    const hasData = result && result.months.some(m => m.lines.length > 0)

    return (
        <div className="w-full pb-10">
            <PageHeader title="Nakit" />
            {!hasData ? (
                <EmptyState />
            ) : (
                <div className="flex flex-col gap-[var(--s3)]">
                    <SummaryCard result={result!} scenario={scenario} onScenario={setScenario} />
                    <div className="grid grid-cols-1 gap-[var(--s3)] md:grid-cols-3">
                        {result!.months.map(m => <MonthCard key={m.month} month={m} />)}
                    </div>
                </div>
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

/** Üst özet: en düşük bakiye + hangi ay + kapanış seyri çizgisi + senaryo seçici. */
function SummaryCard({ result, scenario, onScenario }: { result: ProjectionResult; scenario: Scenario; onScenario: (s: Scenario) => void }) {
    const months = result.months
    const lowest = months.reduce((a, b) => (b.closingBalance < a.closingBalance ? b : a))
    const W = 320, H = 48
    const vals = months.map(m => m.closingBalance)
    const min = Math.min(...vals), max = Math.max(...vals)
    const span = Math.max(1, max - min)
    const x = (i: number) => months.length > 1 ? (i / (months.length - 1)) * W : W / 2
    const y = (v: number) => H - ((v - min) / span) * H
    const linePts = months.map((m, i) => `${x(i).toFixed(1)},${y(m.closingBalance).toFixed(1)}`).join(' ')
    const lowIdx = months.indexOf(lowest)

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div className="flex flex-wrap items-start justify-between gap-[var(--s3)]">
                <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Önümüzdeki 3 ay</div>
                    <div className="mt-[var(--s2)]" style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                        En düşük bakiye <span className="tnum" style={{ color: lowest.closingBalance < 0 ? 'var(--flow-out)' : 'var(--ink)' }}>{formatTL(lowest.closingBalance)}</span>
                        <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}> · {monthName(lowest.month)}</span>
                    </div>
                </div>
                <Segmented
                    options={[{ value: 'temkinli', label: 'Temkinli' }, { value: 'beklenen', label: 'Beklenen' }]}
                    value={scenario} onChange={(v) => onScenario(v as Scenario)}
                />
            </div>

            {/* Kapanış seyri */}
            <div className="relative mt-[var(--s4)]" style={{ height: H + 16 }}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-x-0 top-0 w-full" style={{ height: H }}>
                    {min < 0 && <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="var(--flow-out)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
                    <polyline points={linePts} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </svg>
                {/* En düşük nokta + ay etiketleri */}
                {months.map((m, i) => (
                    <div key={m.month} className="absolute -translate-x-1/2" style={{ left: `${(x(i) / W) * 100}%`, top: y(m.closingBalance) - 4 }}>
                        <span className="block h-[7px] w-[7px] rounded-full" style={{ background: i === lowIdx ? (m.closingBalance < 0 ? 'var(--flow-out)' : 'var(--accent)') : 'var(--ink-4)' }} />
                    </div>
                ))}
                <div className="absolute inset-x-0 bottom-0 flex">
                    {months.map(m => <span key={m.month} className="flex-1 text-center" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{monthName(m.month).slice(0, 3)}</span>)}
                </div>
            </div>
        </section>
    )
}

function MonthCard({ month }: { month: ProjectionMonth }) {
    const income = month.lines.filter(l => l.amount > 0)
    const knownOut = month.lines.filter(l => l.amount < 0 && !l.isEstimated)
    const estOut = month.lines.filter(l => l.amount < 0 && l.isEstimated)
    const estTotal = Math.round(month.incomeEstimated + month.outflowEstimated)
    const knownTotal = Math.round(month.incomeKnown + month.outflowKnown)

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="flex flex-col p-[22px]">
            <div className="flex items-baseline justify-between gap-[var(--s2)]">
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{monthLabel(month.month)}</span>
                <CardLink href={`/hareketler?baslangic=${month.month}-01&bitis=${monthEnd(month.month)}`} label="Hareketler" />
            </div>
            <div className="tnum mt-[2px]" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>açılış {formatTL(month.openingBalance)}</div>

            {income.length > 0 && <Group title="Gelirler">{income.map((l, i) => <LineRow key={`i${i}`} line={l} />)}</Group>}
            {knownOut.length > 0 && <Group title="Bilinen yükler">{knownOut.map((l, i) => <LineRow key={`k${i}`} line={l} />)}</Group>}
            {estOut.length > 0 && <Group title="Değişken harcama tahmini">{estOut.map((l, i) => <LineRow key={`e${i}`} line={l} category />)}</Group>}

            <div className="mt-auto pt-[var(--s4)]">
                <div className="flex items-baseline justify-between border-t pt-[var(--s3)]" style={{ borderColor: 'var(--border)' }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-2)' }}>Ay sonu tahmini</span>
                    <span className="tnum" style={{ fontSize: 18, fontWeight: 600, color: month.isNegative ? 'var(--flow-out)' : 'var(--ink)' }}>{formatTL(month.closingBalance)}</span>
                </div>
                <div className="tnum mt-[var(--s2)]" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                    {formatTL(knownTotal)} kesin{estTotal > 0 ? ` · ${formatTL(estTotal)} tahmin` : ''}
                </div>
            </div>
        </section>
    )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="mt-[var(--s4)]">
            <div className="mb-[var(--s2)]" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{title}</div>
            <div className="flex flex-col gap-[var(--s2)]">{children}</div>
        </div>
    )
}

/** Kesin --ink; tahmini --ink-3 + italik + ~. Kategori kaleminde CategoryPill.
 *  Rakam yön rengi taşır: gelir --flow-in, gider --flow-out. */
function LineRow({ line, category }: { line: ProjectionLine; category?: boolean }) {
    const est = line.isEstimated
    const labelColor = est ? 'var(--ink-3)' : 'var(--ink)'
    const amtColor = line.amount >= 0 ? 'var(--flow-in)' : 'var(--flow-out)'
    return (
        <div className="flex items-baseline justify-between gap-[var(--s2)]">
            <span className="flex min-w-0 items-center gap-[var(--s2)]">
                {/* Tahmin işareti tek yerde: etikette "~". Rakam normal işaretiyle kalır. */}
                {est && <span className="shrink-0" style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>~</span>}
                {category ? <CategoryPill name={line.label.replace(/\s*(tahmini|harcaması)$/i, '')} /> : (
                    <span className="truncate" style={{ fontSize: 13.5, color: labelColor, fontWeight: est ? 400 : 500, fontStyle: est ? 'italic' : 'normal' }}>{line.label}</span>
                )}
                {line.basis && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>· {line.basis}</span>}
            </span>
            <span className="tnum shrink-0" style={{ fontSize: 13.5, fontWeight: est ? 400 : 600, fontStyle: est ? 'italic' : 'normal', color: amtColor }}>
                {line.amount > 0 ? '+' : '−'}{formatTL(Math.abs(line.amount))}
            </span>
        </div>
    )
}

function EmptyState() {
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Nakit görünümü için veri yok.</p>
            <p className="mt-[var(--s2)]" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                Hesap, gelir ve düzenli ödeme girdikçe önümüzdeki üç ayın açılış bakiyesi, giriş/çıkışları ve ay sonu tahmini burada görünür.
            </p>
        </section>
    )
}
