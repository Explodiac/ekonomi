'use client'

import { useState, useEffect, useMemo, useRef } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { buildNetWorth, type NetWorthResult, type NetWorthRange, type NetWorthAccount, type NetWorthTransaction, type NetWorthInstallment } from "@/lib/networth"
import { DeltaChip } from "@/components/ui/delta-chip"

function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(amount)))} ₺`
}

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

/** investments symbol'ünü canlidoviz kur anahtarına eşler. */
const RATE_KEY: Record<string, string> = {
    ALTIN: 'ALTIN', GRAM: 'ALTIN', 'HAS ALTIN': 'ALTIN',
    USD: 'USD', DOLAR: 'USD',
    EUR: 'EUR', EURO: 'EUR',
    GBP: 'GBP', GUMUS: 'GUMUS',
}

type RatesInfo =
    | { status: 'ok'; updatedAt: string }
    | { status: 'failed' }
    | { status: 'loading' }

/** Trend aralığı seçenekleri ve delta etiketi için okunur ad. */
const RANGES: { key: NetWorthRange; label: string; since: string }[] = [
    { key: '1H', label: '1H', since: '1 haftada' },
    { key: '1A', label: '1A', since: '1 ayda' },
    { key: '3A', label: '3A', since: '3 ayda' },
    { key: 'YBB', label: 'YBB', since: 'yıl başından' },
    { key: '1Y', label: '1Y', since: '1 yılda' },
    { key: 'TÜMÜ', label: 'TÜMÜ', since: 'tüm zamanda' },
]

type RawData = {
    accounts: NetWorthAccount[]
    transactions: NetWorthTransaction[]
    installments: NetWorthInstallment[]
    investmentValue: number | null
}

export function NetWorthSummary() {
    const [raw, setRaw] = useState<RawData | null>(null)
    const [range, setRange] = useState<NetWorthRange>('1A')
    const [rates, setRates] = useState<RatesInfo>({ status: 'loading' })
    // Grafik imleci: fare/parmak konumundaki nokta indeksi (null = imleç yok).
    const [hoverIdx, setHoverIdx] = useState<number | null>(null)

    useEffect(() => {
        const load = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return
                const hhId = await ensureHouseholdExists(user.id)
                if (!hhId) return

                const [accRes, txRes, instRes, invRes, ratesRes] = await Promise.all([
                    supabase.from('accounts').select('id, type, opening_balance').eq('household_id', hhId),
                    supabase.from('transactions').select('account_id, amount, type, cash_date, transfer_direction').eq('household_id', hhId),
                    supabase.from('installments').select('kind, installment_payments(payment_date, amount)').eq('household_id', hhId),
                    supabase.from('investments').select('quantity, symbol, average_cost').eq('household_id', hhId),
                    fetch('/api/rates').then(r => r.json()).catch(() => ({ success: false })),
                ])

                const installments = (instRes.data || []).map((i: any) => ({
                    kind: i.kind, payments: i.installment_payments || [],
                }))

                // Kur başarıyla çekildiyse yatırımı değerle; aksi halde null → net değere katma.
                let investmentValue: number | null = null
                if (ratesRes?.success && ratesRes.rates) {
                    setRates({ status: 'ok', updatedAt: ratesRes.lastUpdate })
                    investmentValue = (invRes.data || []).reduce((sum: number, a: any) => {
                        const key = RATE_KEY[(a.symbol || '').toUpperCase()]
                        const rate = key ? Number(ratesRes.rates[key]) : null
                        // Kur eşleşmezse (hisse/fon) kayıtlı maliyetle değerle.
                        const unit = rate && rate > 0 ? rate : Number(a.average_cost) || 0
                        return sum + Number(a.quantity) * unit
                    }, 0)
                } else {
                    setRates({ status: 'failed' })
                }

                setRaw({
                    accounts: accRes.data || [],
                    transactions: txRes.data || [],
                    installments,
                    investmentValue,
                })
            } catch (error) {
                console.error("Net değer hesaplanamadı:", error)
            }
        }
        load()
    }, [])

    // Aralık değişince yalnız trend yeniden hesaplanır (ham veri sabit).
    const result = useMemo<NetWorthResult | null>(
        () => raw ? buildNetWorth(raw, { range }) : null,
        [raw, range],
    )

    if (!result) {
        return <div style={{ height: 8 }} />
    }

    const series = result.byMonth
    const firstPt = series[0]
    const lastPt = series[series.length - 1]
    const delta = (lastPt?.netWorth ?? 0) - (firstPt?.netWorth ?? 0)
    const since = RANGES.find(r => r.key === range)?.since ?? ''
    // İyilik-yönlü değişimler: varlık artışı ve borç AZALIŞI olumlu (yeşil).
    const assetsDelta = (lastPt?.assets ?? 0) - (firstPt?.assets ?? 0)
    const debtsDelta = (firstPt?.debts ?? 0) - (lastPt?.debts ?? 0)

    // İmleç konumundaki değerler — üstteki rakamlar imlece göre güncellenir; imleç
    // yokken güncel (asOf) değerler. İmleçliyken "aralık değişimi" çipleri gizlenir.
    const hoverPt = hoverIdx != null && hoverIdx >= 0 && hoverIdx < series.length ? series[hoverIdx] : null
    const dispAssets = hoverPt ? hoverPt.assets : result.assets
    const dispDebts = hoverPt ? hoverPt.debts : result.debts
    const dispNet = hoverPt ? hoverPt.netWorth : result.netWorth

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="mb-[var(--s4)] p-[22px]">
            {/* 1. Hâkim rakam */}
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Net değer</div>
            <div className="mt-[var(--s2)] flex flex-wrap items-baseline gap-x-[var(--s3)] gap-y-[2px]">
                <span
                    className="tnum"
                    style={{
                        fontSize: 40, fontWeight: 600, letterSpacing: '-0.025em',
                        // Büyüme yeşil değil --ink; sadece gerçek negatif net değerde --flow-out.
                        color: dispNet < 0 ? 'var(--flow-out)' : 'var(--ink)',
                    }}
                >
                    {dispNet < 0 ? '−' : ''}{formatTL(dispNet)}
                </span>
                {!hoverPt && <DeltaChip value={delta} context={since} />}
            </div>

            {/* 2. Varlık / borç — etiket solda, değişim çipi + rakam sağda birlikte */}
            <div className="mt-[var(--s5)] flex flex-col gap-[var(--s2)]">
                <div className="flex items-center justify-between gap-[var(--s2)]">
                    <span className="flex items-center gap-[var(--s2)]" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
                        <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: 'var(--accent)' }} aria-hidden />
                        Toplam varlık
                    </span>
                    <span className="flex items-center gap-[var(--s2)]">
                        {!hoverPt && <DeltaChip value={assetsDelta} />}
                        <span className="tnum" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{formatTL(dispAssets)}</span>
                    </span>
                </div>
                <div className="h-px" style={{ background: 'var(--border)' }} />
                <div className="flex items-center justify-between gap-[var(--s2)]">
                    <span className="flex items-center gap-[var(--s2)]" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
                        <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: 'var(--flow-out)' }} aria-hidden />
                        Toplam borç
                    </span>
                    <span className="flex items-center gap-[var(--s2)]">
                        {!hoverPt && <DeltaChip value={debtsDelta} />}
                        <span className="tnum" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{formatTL(dispDebts)}</span>
                    </span>
                </div>
            </div>

            {/* 3. Net değer trend çizgisi — imleçli (hover/scrub) */}
            <div className="mt-[var(--s5)]">
                <TrendChart series={series} granularity={result.granularity} hoverIdx={hoverIdx} onHover={setHoverIdx} />
            </div>

            {/* 4. Aralık seçici (segmented) */}
            <div className="mt-[var(--s4)] flex gap-[4px]">
                {RANGES.map(r => {
                    const active = r.key === range
                    return (
                        <button
                            key={r.key}
                            type="button"
                            onClick={() => { setRange(r.key); setHoverIdx(null) }}
                            className="flex-1 rounded-[var(--r-pill)] py-[5px] transition-colors"
                            style={{
                                fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
                                background: active ? 'var(--accent-bg)' : 'transparent',
                                color: active ? 'var(--accent)' : 'var(--ink-3)',
                            }}
                        >
                            {r.label}
                        </button>
                    )
                })}
            </div>

            {/* Kur güncellik durumu — bayat veri sessizce doğru gösterilmez. */}
            <div className="mt-[var(--s4)]" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {rates.status === 'ok' && <span>Kur {formatDate(rates.updatedAt)} güncellendi.</span>}
                {rates.status === 'failed' && (
                    <span>Kur güncellenemedi — yatırımlar net değere dahil edilmedi.</span>
                )}
            </div>
        </section>
    )
}

const TR_MON3 = ['OCA', 'ŞUB', 'MAR', 'NİS', 'MAY', 'HAZ', 'TEM', 'AĞU', 'EYL', 'EKİ', 'KAS', 'ARA']

/** İmleç tarih etiketi: günlükte "29 TEM", aylıkta "TEM 2026". */
function pointLabel(mk: string, granularity: 'day' | 'month'): string {
    const p = mk.split('-').map(Number)
    const mon = TR_MON3[p[1] - 1] ?? ''
    return granularity === 'day' ? `${p[2]} ${mon}` : `${mon} ${p[0]}`
}

/** Varlık (--accent) ve borç (--flow-out) çizgileri + gün/ay bazlı imleç (hover/scrub).
 *  Fare/parmak en yakın noktaya snap eder; imlecin solu normal, sağı soluk (--ink-4).
 *  Performans: her hareket yalnız en yakın indeksi bulur, seriyi yeniden hesaplamaz. */
function TrendChart({ series, granularity, hoverIdx, onHover }: {
    series: { month: string; netWorth: number; assets: number; debts: number }[]
    granularity: 'day' | 'month'
    hoverIdx: number | null
    onHover: (i: number | null) => void
}) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const W = 300, H = 72

    const n = series.length
    if (n < 2) {
        return <div className="flex h-[72px] items-center" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {n === 0 ? 'Bu aralıkta veri yok.' : 'Trend için yeterli veri yok.'}
        </div>
    }

    const maxV = Math.max(1, ...series.map(m => Math.max(m.assets, m.debts)))
    const x = (i: number) => (i / (n - 1)) * W
    const y = (v: number) => H - (v / maxV) * H

    const pts = (sel: (m: typeof series[number]) => number, from = 0, to = n - 1) => {
        const out: string[] = []
        for (let i = from; i <= to; i++) out.push(`${x(i).toFixed(1)},${y(sel(series[i])).toFixed(1)}`)
        return out.join(' ')
    }
    const assetsPts = pts(m => m.assets)
    const debtsPts = pts(m => m.debts)
    const areaPath = `0,${H} ${assetsPts} ${W},${H}`

    // En yakın indeks — sadece aritmetik.
    const handleMove = (clientX: number) => {
        const el = wrapRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
        const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))))
        if (idx !== hoverIdx) onHover(idx)
    }

    const active = hoverIdx != null && hoverIdx >= 0 && hoverIdx < n
    const hx = active ? `${(hoverIdx! / (n - 1)) * 100}%` : '0'
    const aY = active ? y(series[hoverIdx!].assets) : 0
    const dY = active ? y(series[hoverIdx!].debts) : 0

    // Ay etiketleri: aylık granülerlikte ilk harf; günlükte uçlar.
    const labels = granularity === 'month'
        ? series.map(m => TR_MONTHS[Number(m.month.split('-')[1]) - 1]?.[0] ?? '')
        : series.map((m, i) => (i === 0 || i === n - 1) ? `${Number(m.month.split('-')[2])}` : '')

    return (
        <div
            ref={wrapRef}
            style={{ touchAction: 'none' }}
            onMouseMove={e => handleMove(e.clientX)}
            onMouseLeave={() => onHover(null)}
            onTouchStart={e => handleMove(e.touches[0].clientX)}
            onTouchMove={e => handleMove(e.touches[0].clientX)}
            onTouchEnd={() => onHover(null)}
        >
            {/* İmleç tarih etiketi alanı (grafiğin üstünde) */}
            <div className="relative" style={{ height: 15 }}>
                {active && (
                    <span className="tnum absolute -translate-x-1/2 whitespace-nowrap" style={{ left: hx, bottom: 0, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--ink-3)' }}>
                        {pointLabel(series[hoverIdx!].month, granularity)}
                    </span>
                )}
            </div>

            {/* Grafik + imleç katmanı */}
            <div className="relative" style={{ height: H }}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label="Net değer trendi">
                    <polygon points={areaPath} fill="var(--accent)" opacity={0.1} />
                    {!active ? (
                        <>
                            <polyline points={debtsPts} fill="none" stroke="var(--flow-out)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                            <polyline points={assetsPts} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        </>
                    ) : (
                        <>
                            {/* Sağ (imleçten sonrası) soluk; sol normal renk */}
                            <polyline points={pts(m => m.debts, hoverIdx!, n - 1)} fill="none" stroke="var(--ink-4)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                            <polyline points={pts(m => m.assets, hoverIdx!, n - 1)} fill="none" stroke="var(--ink-4)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                            <polyline points={pts(m => m.debts, 0, hoverIdx!)} fill="none" stroke="var(--flow-out)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                            <polyline points={pts(m => m.assets, 0, hoverIdx!)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        </>
                    )}
                </svg>

                {active && (
                    <>
                        <div className="absolute" style={{ left: hx, top: 0, height: H, width: 1, background: 'var(--ink-4)', transform: 'translateX(-50%)' }} />
                        <div className="absolute rounded-full" style={{ left: hx, top: aY, width: 8, height: 8, background: 'var(--accent)', transform: 'translate(-50%,-50%)' }} />
                        <div className="absolute rounded-full" style={{ left: hx, top: dY, width: 8, height: 8, background: 'var(--flow-out)', transform: 'translate(-50%,-50%)' }} />
                    </>
                )}
            </div>

            {granularity === 'month' && (
                <div className="mt-[var(--s2)] flex">
                    {labels.map((l, i) => (
                        <span key={i} className="flex-1 text-center" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{l}</span>
                    ))}
                </div>
            )}
        </div>
    )
}

function formatDate(iso: string): string {
    try {
        const d = new Date(iso)
        return `${d.getDate()} ${TR_MONTHS[d.getMonth()]} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}'de`
    } catch {
        return 'bilinmeyen zamanda'
    }
}
