'use client'

import { useState, useEffect, useMemo } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, RefreshCw } from "lucide-react"
import { AssetModal } from "@/components/investments/AssetModal"
import { AssetSellModal } from "@/components/investments/AssetSellModal"
import { PageHeader } from "@/components/ui/page-header"
import { PrimaryButton } from "@/components/ui/primary-button"

export default function InvestmentsPage() {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isSellModalOpen, setIsSellModalOpen] = useState(false)
    const [selectedAsset, setSelectedAsset] = useState<any>(null)
    const [investments, setInvestments] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const fetchInvestments = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return

            const { data, error } = await supabase
                .from('investments')
                .select('*')
                .eq('household_id', hhId)
                .order('created_at', { ascending: false })

            if (error) throw error
            setInvestments(data || [])
        } catch (error) {
            console.error("Error fetching investments:", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchInvestments()
    }, [])

    const simulatePrices = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const updatedInvestments = investments.map(asset => {
            // Simulate -2% to +2% fluctuation
            const drift = 1 + (Math.random() * 0.04 - 0.02)
            return {
                ...asset,
                current_price: asset.current_price * drift
            }
        })

        setInvestments(updatedInvestments)

        // Optional: Update DB (for demo, maybe just local state is enough, but user might want it saved)
        // For now, let's keep it local or just update one for realism
        if (investments.length > 0) {
            const first = updatedInvestments[0]
            await supabase.from('investments').update({ current_price: first.current_price }).eq('id', first.id)
        }
    }

    const calculateStats = useMemo(() => {
        let totalCost = 0
        let currentValue = 0

        const enriched = investments.map(asset => {
            const cost = asset.quantity * asset.average_cost
            const val = asset.quantity * asset.current_price
            totalCost += cost
            currentValue += val

            const profitAmount = val - cost
            const profitPercent = cost > 0 ? (profitAmount / cost) * 100 : 0

            return {
                ...asset,
                total_cost: cost,
                current_total_value: val,
                profit_amount: profitAmount,
                profit_percent: profitPercent,
                is_profit: profitAmount >= 0
            }
        })

        const totalProfit = currentValue - totalCost
        const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0

        // Group by type for chart
        const typeDataMap: Record<string, number> = {}
        enriched.forEach(asset => {
            typeDataMap[asset.type] = (typeDataMap[asset.type] || 0) + asset.current_total_value
        })

        const chartData = Object.entries(typeDataMap).map(([name, value]) => ({ name, value }))

        return {
            enrichedAssets: enriched,
            totalCost,
            currentValue,
            totalProfit,
            totalProfitPercent,
            chartData
        }
    }, [investments])

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(val)
    }

    const ASSET_EMOJI = (type: string) => type === 'Emtia' ? '🪙' : type === 'Kripto' ? '₿' : '📈'

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-32">
                <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} />
            </div>
        )
    }

    const best = calculateStats.enrichedAssets.length > 0
        ? [...calculateStats.enrichedAssets].sort((a, b) => b.profit_percent - a.profit_percent)[0]
        : null
    const alloc = [...calculateStats.chartData].sort((a, b) => b.value - a.value)

    return (
        <div className="flex flex-col gap-[var(--s3)] pb-10">
            <AssetModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={() => { fetchInvestments() }}
            />

            <AssetSellModal
                isOpen={isSellModalOpen}
                asset={selectedAsset}
                onClose={() => { setIsSellModalOpen(false); setSelectedAsset(null) }}
                onSuccess={() => { fetchInvestments() }}
            />

            <PageHeader title="Yatırımlar" subtitle="Portföy değeri, dağılım ve varlık performansı." />

            {/* Özet — sade token satırları, renk yok */}
            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>Toplam portföy değeri</div>
                <div className="tnum mt-[var(--s2)]" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                    {formatCurrency(calculateStats.currentValue)}
                </div>

                <div className="mt-[var(--s5)] flex flex-col gap-[var(--s2)]">
                    <div className="flex items-baseline justify-between">
                        <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Toplam maliyet</span>
                        <span className="tnum" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{formatCurrency(calculateStats.totalCost)}</span>
                    </div>
                    <div className="h-px" style={{ background: 'var(--border)' }} />
                    <div className="flex items-baseline justify-between">
                        <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Kâr / zarar</span>
                        {/* Kâr/zarar: --ink + işaret; --flow-out sadece gerçek negatif net değerde. */}
                        <span className="tnum" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                            {calculateStats.totalProfit >= 0 ? '+' : '−'}{formatCurrency(Math.abs(calculateStats.totalProfit))} · {calculateStats.totalProfit >= 0 ? '+' : '−'}%{Math.abs(calculateStats.totalProfitPercent).toFixed(2)}
                        </span>
                    </div>
                    <div className="h-px" style={{ background: 'var(--border)' }} />
                    <div className="flex items-baseline justify-between">
                        <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Varlık sayısı</span>
                        <span className="tnum" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{investments.length}</span>
                    </div>
                    {best && (
                        <>
                            <div className="h-px" style={{ background: 'var(--border)' }} />
                            <div className="flex items-baseline justify-between">
                                <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>En çok kazandıran</span>
                                <span className="tnum" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                                    {best.symbol} {best.is_profit ? '+' : '−'}%{Math.abs(best.profit_percent).toFixed(1)}
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {/* Fiyat şeffaflığı — networth diliyle tutarlı: değerler bayat gösterilmez. */}
                <div className="mt-[var(--s4)] flex items-center justify-between">
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Değerler en son kaydedilen fiyatlarla hesaplandı.</span>
                    <button onClick={fetchInvestments} className="icon-btn p-1" title="Yenile">
                        <RefreshCw className="h-[15px] w-[15px]" />
                    </button>
                </div>
            </section>

            {/* Dağılım — token yatay barlar (renk yok, --ink üstünde --fill-track) */}
            {alloc.length > 0 && (
                <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }} className="mb-[var(--s4)]">Varlık dağılımı</div>
                    <div className="flex flex-col gap-[var(--s3)]">
                        {alloc.map(a => {
                            const pct = calculateStats.currentValue > 0 ? (a.value / calculateStats.currentValue) * 100 : 0
                            return (
                                <div key={a.name}>
                                    <div className="flex items-baseline justify-between mb-[3px]">
                                        <span style={{ fontSize: 14, color: 'var(--ink)' }}>{a.name}</span>
                                        <span className="tnum" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                                            {formatCurrency(a.value)} · %{Math.round(pct)}
                                        </span>
                                    </div>
                                    <div className="h-[6px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                                        <div className="h-full" style={{ width: `${pct}%`, background: 'var(--ink)', borderRadius: 'var(--r-bar)' }} />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </section>
            )}

            {/* Varlık listesi — sade satır dili */}
            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="py-[var(--s2)]">
                <div className="px-[22px] pb-[var(--s2)] pt-[var(--s2)]" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>
                    Varlıklar
                </div>
                {calculateStats.enrichedAssets.length === 0 ? (
                    <p className="px-[22px] pb-[var(--s3)]" style={{ fontSize: 14.5, color: 'var(--ink-3)' }}>Henüz varlık yok.</p>
                ) : (
                    <ul>
                        {calculateStats.enrichedAssets.map((asset, i) => (
                            <li
                                key={asset.id}
                                className="flex items-center gap-[var(--s3)] px-[22px] py-[13px]"
                                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
                            >
                                <span style={{ fontSize: 20 }} aria-hidden>{ASSET_EMOJI(asset.type)}</span>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{asset.symbol}</div>
                                    <div className="truncate" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                                        {asset.name} · {asset.quantity} {asset.unit}
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="tnum" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{formatCurrency(asset.current_total_value)}</div>
                                    {/* Kâr/zarar: --ink + işaret, renk yok */}
                                    <div className="tnum" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                                        {asset.is_profit ? '+' : '−'}%{Math.abs(asset.profit_percent).toFixed(1)} · {asset.is_profit ? '+' : '−'}{formatCurrency(Math.abs(asset.profit_amount))}
                                    </div>
                                </div>
                                <button
                                    onClick={() => { setSelectedAsset(asset); setIsSellModalOpen(true) }}
                                    className="shrink-0 px-[var(--s2)]"
                                    style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--accent)' }}
                                >
                                    Sat
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <div className="flex items-center gap-[var(--s3)]">
                <PrimaryButton onClick={() => setIsModalOpen(true)}>Varlık ekle</PrimaryButton>
                <button onClick={simulatePrices} style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--accent)' }}>Fiyatları simüle et</button>
            </div>
        </div>
    )
}
