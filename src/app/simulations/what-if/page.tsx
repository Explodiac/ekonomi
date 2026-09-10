'use client'

import { useState, useEffect, useMemo } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2 } from "lucide-react"
import { buildProjection, type ProjectionInput } from "@/lib/projection"
import { estimateAllCategories, type EstimateTransaction } from "@/lib/estimate"

function formatTL(amount: number): string {
    const abs = Math.abs(Math.round(amount))
    const s = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs)
    return `${amount < 0 ? '−' : ''}${s} ₺`
}

export default function WhatIfPage() {
    const [input, setInput] = useState<ProjectionInput | null>(null)
    const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
    const [selectedId, setSelectedId] = useState<string>("")
    const [reduction, setReduction] = useState<number>(30)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return
                const hhId = await ensureHouseholdExists(user.id)
                if (!hhId) return

                const [accRes, txRes, subRes, instRes, catRes, goalRes, conRes] = await Promise.all([
                    supabase.from('accounts').select('id, type, opening_balance, balance').eq('household_id', hhId),
                    supabase.from('transactions')
                        .select('id, account_id, category_id, amount, type, cash_date, description, source_type, source_id, transfer_direction, categories(name)')
                        .eq('household_id', hhId),
                    supabase.from('subscriptions').select('id, name, amount, frequency, next_payment_date, status, end_date').eq('household_id', hhId),
                    supabase.from('installments').select('id, description, kind, installment_payments(id, payment_date, amount)').eq('household_id', hhId),
                    supabase.from('categories').select('id, name').eq('household_id', hhId).eq('type', 'expense'),
                    supabase.from('goals').select('name, monthly_alloc, status').eq('household_id', hhId),
                    supabase.from('contracts').select('id, name, contract_payments(id, amount, expected_date, status)').eq('household_id', hhId),
                ])

                const transactions = (txRes.data || []).map((t: any) => ({ ...t, categoryName: t.categories?.name ?? null }))
                const contractPayments = (conRes.data || []).flatMap((c: any) =>
                    (c.contract_payments || [])
                        .filter((p: any) => p.status === 'pending')
                        .map((p: any) => ({ ...p, contract_id: c.id, contractName: c.name })))
                setInput({
                    accounts: accRes.data || [],
                    transactions,
                    subscriptions: subRes.data || [],
                    installments: (instRes.data || []).map((i: any) => ({ ...i, payments: i.installment_payments || [] })),
                    contractPayments,
                    goalAllocations: (goalRes.data || []).map((g: any) => ({ name: g.name, monthlyAlloc: g.monthly_alloc, status: g.status })),
                })
                setCategories(catRes.data || [])
            } catch (error) {
                console.error("What-if verisi alınamadı:", error)
            } finally {
                setIsLoading(false)
            }
        }
        load()
    }, [])

    // Yalnızca 3 ay kuralını geçen (tahmin üreten) kategoriler kısılabilir.
    const estimable = useMemo(() => {
        if (!input) return []
        const estimates = estimateAllCategories(input.transactions as EstimateTransaction[],
            new Date().toISOString().slice(0, 7))
        const byId = new Map(estimates.map(e => [e.categoryId, e]))
        return categories
            .filter(c => byId.has(c.id))
            .map(c => ({ ...c, estimate: byId.get(c.id)! }))
    }, [input, categories])

    useEffect(() => {
        if (estimable.length && !selectedId) setSelectedId(estimable[0].id)
    }, [estimable, selectedId])

    const result = useMemo(() => {
        if (!input || !selectedId) return null
        const currentMonth = new Date().toISOString().slice(0, 7)
        const baseEstimates = estimateAllCategories(input.transactions as EstimateTransaction[], currentMonth)

        // Seçili kategoriyi ölçekle — gerçek veri değişmez, kopya üstünde hesaplanır.
        const factor = 1 - reduction / 100
        const override = baseEstimates.map(e =>
            e.categoryId === selectedId ? { ...e, amount: Math.round(e.amount * factor * 100) / 100 } : e
        )

        const base = buildProjection(input, { from: undefined })
        const scenario = buildProjection(input, { spendOverride: override })

        const baseClosing = base.months[base.months.length - 1].closingBalance
        const scenarioClosing = scenario.months[scenario.months.length - 1].closingBalance
        const monthlySaving = (baseEstimates.find(e => e.categoryId === selectedId)?.amount ?? 0) * (reduction / 100)

        return {
            categoryName: categories.find(c => c.id === selectedId)?.name ?? 'Kategori',
            baseClosing,
            scenarioClosing,
            diff: scenarioClosing - baseClosing,
            monthlySaving,
        }
    }, [input, selectedId, reduction, categories])

    if (isLoading) {
        return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }

    return (
        <div className="w-full pb-10">
            <div className="mb-[var(--s4)] space-y-1">
                <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Şunu kısarsam</h1>
                <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                    Bir kategoriyi kısmanın önümüzdeki 3 ayın kapanış bakiyesine etkisi.
                </p>
            </div>

            {estimable.length === 0 ? (
                <EmptyState />
            ) : (
                <div className="flex flex-col gap-[var(--s3)]">
                    <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px] space-y-[var(--s4)]">
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }} className="mb-[var(--s2)]">Kategori</div>
                            {/* Kategori seçici: seçili --ink + --ink-4 zemin (dolu mavi değil), menüyle tutarlı. */}
                            <div className="flex flex-wrap gap-[var(--s2)]">
                                {estimable.map(c => {
                                    const active = c.id === selectedId
                                    return (
                                        <button
                                            key={c.id}
                                            onClick={() => setSelectedId(c.id)}
                                            className="px-[var(--s3)] py-[var(--s2)]"
                                            style={{
                                                fontSize: 13.5,
                                                borderRadius: 'var(--r-button)',
                                                background: active ? 'var(--ink-4)' : 'transparent',
                                                color: active ? 'var(--ink)' : 'var(--ink-3)',
                                                fontWeight: active ? 600 : 400,
                                            }}
                                        >
                                            {c.name}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <div>
                            <div className="flex items-baseline justify-between mb-[var(--s2)]">
                                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>Kısma oranı</span>
                                <span className="tnum" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>%{reduction}</span>
                            </div>
                            <input
                                type="range" min={5} max={100} step={5}
                                value={reduction}
                                onChange={(e) => setReduction(Number(e.target.value))}
                                className="w-full"
                                style={{ accentColor: 'var(--accent)' }}
                            />
                        </div>
                    </section>

                    {result && (
                        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px] space-y-[var(--s3)]">
                            <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--ink)' }}>
                                {result.categoryName}&apos;i %{reduction} kısarsan 3 aylık kapanış bakiyen{' '}
                                <span className="tnum" style={{ color: 'var(--ink-3)' }}>{formatTL(result.baseClosing)}</span>&apos;ten{' '}
                                <span className="tnum" style={{ fontWeight: 600 }}>{formatTL(result.scenarioClosing)}</span>&apos;e çıkıyor.
                            </p>
                            <p className="tnum" style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
                                Ayda ~{formatTL(result.monthlySaving)} tasarruf · üç ayda {formatTL(result.diff)} fark
                            </p>
                        </section>
                    )}
                </div>
            )}
        </div>
    )
}

function EmptyState() {
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <p style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--ink)' }}>Kısılabilecek kategori yok.</p>
            <p className="mt-[var(--s2)]" style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                Bir kategorinin kısma etkisini görmek için o kategoride son üç ayın hepsinde
                harcama olması gerekir. Yeterli geçmiş biriktikçe burada görünecek.
            </p>
        </section>
    )
}
