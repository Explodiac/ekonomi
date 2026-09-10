'use client'

import { useState, useEffect, useMemo, useCallback } from "react"
import Link from "next/link"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, X } from "lucide-react"
import { buildProjection, type ProjectionInput } from "@/lib/projection"
import { computeBreathingRoom, type BreathingRoom } from "@/lib/breathing-room"
import { computeBaseIncome } from "@/lib/base-income"
import { deriveAccountBalances } from "@/lib/balance"
import { detectEndedSeries, type EstimateTransaction } from "@/lib/estimate"
import { CategoryNatureClassifier } from "@/components/categories/category-nature-classifier"

function formatTL(amount: number): string {
    const abs = Math.abs(Math.round(amount))
    const s = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs)
    return `${amount < 0 ? '−' : ''}${s} ₺`
}
function todayStr() { return new Date().toISOString().slice(0, 10) }
const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const TR_MON_LETTER = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A']
function endMonthLabel(count: number): string {
    const d = new Date(); d.setMonth(d.getMonth() + Math.max(0, count - 1))
    return `${TR_MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}
function pct(ratio: number): string { return `%${Math.round(ratio * 100)}` }

type Account = { id: string; type: string; balance: number; opening_balance: number }

export default function AssetPurchasePage() {
    const [projectionInput, setProjectionInput] = useState<ProjectionInput | null>(null)
    const [accounts, setAccounts] = useState<Account[]>([])
    const [hhId, setHhId] = useState<string | null>(null)
    const [baseIncomeCatIds, setBaseIncomeCatIds] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const [amount, setAmount] = useState(50000)
    const [count, setCount] = useState(9)
    const [extraFixed, setExtraFixed] = useState<number>(0)
    const [editNatureOpen, setEditNatureOpen] = useState(false)
    const [dismissedEnded, setDismissedEnded] = useState<Set<string>>(new Set())

    const load = useCallback(async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const id = await ensureHouseholdExists(user.id)
            if (!id) return
            setHhId(id)
            const [accRes, txRes, subRes, instRes, goalRes, catRes] = await Promise.all([
                supabase.from('accounts').select('id, type, opening_balance, balance').eq('household_id', id),
                supabase.from('transactions')
                    .select('id, account_id, category_id, amount, type, transaction_date, cash_date, description, source_type, spend_nature, source_id, transfer_direction, categories(name)')
                    .eq('household_id', id),
                supabase.from('subscriptions').select('id, name, amount, frequency, next_payment_date, status, end_date').eq('household_id', id),
                supabase.from('installments').select('id, description, kind, installment_payments(id, payment_date, amount)').eq('household_id', id),
                supabase.from('goals').select('id, name, target_amount, saved_tl, monthly_alloc, status').eq('household_id', id),
                supabase.from('categories').select('id, type, is_base_income').eq('household_id', id),
            ])
            setBaseIncomeCatIds((catRes.data || []).filter((c: any) => c.type === 'income' && c.is_base_income).map((c: any) => c.id))
            const transactions = (txRes.data || []).map((t: any) => ({ ...t, categoryName: t.categories?.name ?? null }))
            const installments = (instRes.data || []).map((i: any) => ({ ...i, payments: i.installment_payments || [] }))
            setProjectionInput({
                accounts: accRes.data || [], transactions,
                subscriptions: subRes.data || [], installments, contractPayments: [],
                goalAllocations: (goalRes.data || []).map((g: any) => ({ name: g.name, monthlyAlloc: g.monthly_alloc, status: g.status })),
            })
            setAccounts((accRes.data || []) as any)
        } catch (error) {
            console.error("Varlık alımı verisi alınamadı:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])
    useEffect(() => { load() }, [load])

    // Kategori doğasını değiştir: hem varsayılan hem geçmiş değişken hareketler.
    const setCategoryNature = async (categoryId: string, nature: 'aliskanlik' | 'tek_seferlik') => {
        if (!hhId) return
        try {
            await Promise.all([
                supabase.from('categories').update({ default_nature: nature }).eq('id', categoryId),
                supabase.from('transactions').update({ spend_nature: nature })
                    .eq('household_id', hhId).eq('category_id', categoryId).eq('type', 'expense').is('source_type', null),
            ])
            await load()
        } catch (e) { console.error('Doğa güncellenemedi:', e) }
    }
    // Bitmiş seriyi alışkanlıktan çıkar: kategorinin geçmişini tek_seferlik işaretle.
    const excludeEnded = (categoryId: string) => setCategoryNature(categoryId, 'tek_seferlik')

    // Aylık taban rakamlar (baz projeksiyondan; alım eklenmeden).
    const base = useMemo(() => {
        if (!projectionInput) return null
        const cm = todayStr().slice(0, 7)
        const proj = buildProjection(projectionInput)
        const ms = proj.months
        const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
        const outKnown = avg(ms.map(m => m.outflowKnown))
        const mandatory = Math.round(outKnown) + (extraFixed || 0)
        // Taban gelir: TEK kaynak — yalnız 'düzenli' işaretli kategoriler (base-income.ts).
        // incomeKnown/incomeEstimated (gerçekleşmiş/tahmini) BAŞKA eksen; karıştırılmaz.
        const baseInc = computeBaseIncome({ transactions: projectionInput.transactions as any, baseCategoryIds: baseIncomeCatIds, currentMonth: cm })
        // Likit bakiye (stok) — peşin senaryonun sessiz alt satırı için. Türetilmiş
        // bakiye (saklanan balance güvenilir değil, bkz. lib/balance.ts).
        const derived = deriveAccountBalances(accounts, projectionInput.transactions as any, { warn: false })
        const liquid = accounts.reduce((s, a) => {
            const b = derived.get(a.id) ?? 0
            if (a.type === 'bank' || a.type === 'cash') return s + b
            if (a.type === 'esnek_hesap') return s + Math.max(0, b) // pozitif KMH likit; negatif borç, sayılmaz
            return s
        }, 0)
        const txs = projectionInput.transactions as EstimateTransaction[]
        return {
            cm,
            baseIncome: baseInc.monthly,
            hasBaseIncome: baseInc.hasBaseCategory,
            mandatory,
            txs,
            liquid,
        }
    }, [projectionInput, extraFixed, accounts, baseIncomeCatIds])

    const br = (baseIncome: number, monthlyInstallment?: number): BreathingRoom | null =>
        base ? computeBreathingRoom({
            baseIncome, mandatoryOutflow: base.mandatory, transactions: base.txs, currentMonth: base.cm, monthlyInstallment,
        }) : null

    // Seçili senaryo (taksit sayısı = count).
    const monthly = amount / Math.max(1, count)
    // Taban artık yalnız düzenli gelir. Kırılganlık = "düzenli gelir %30 düşerse"
    // (bir maaş kesme senaryosu hane başına gelir verisi gerektirir; %30 şoku
    // hane-agnostik ve gerçekçi: kısmi işten çıkarma / azalan mesai / primsiz dönem).
    const FRAGILITY_HAIRCUT = 0.30
    const selected = useMemo(() => br(base?.baseIncome ?? 0, monthly), [base, monthly])
    const fragility = useMemo(() => br(Math.round((base?.baseIncome ?? 0) * (1 - FRAGILITY_HAIRCUT))), [base])
    const roomFull = useMemo(() => br(base?.baseIncome ?? 0), [base]) // taksitsiz tam taban (kırılganlık kıyası)

    const scenarios = useMemo(() => {
        const counts = [0, 3, 6, 9, 12]
        return counts.map(c => {
            const m = c === 0 ? undefined : amount / c
            const r = br(base?.baseIncome ?? 0, m)
            return { count: c, monthly: m ?? 0, r }
        })
    }, [base, amount])

    // Bitmiş seri adayları (2e) — kullanıcı reddettiklerini gizle.
    const endedSeries = useMemo(
        () => base ? detectEndedSeries(base.txs, base.cm).filter(e => !dismissedEnded.has(e.categoryId)) : [],
        [base, dismissedEnded]
    )

    if (isLoading) {
        return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }

    const inputStyle = { background: 'var(--bg)', borderRadius: 'var(--r-button)', color: 'var(--ink)' } as const

    return (
        <div className="w-full pb-10">
            <div className="mb-[var(--s4)] flex items-start justify-between gap-[var(--s3)]">
                <div className="space-y-1">
                    <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Bu alımı yaparsam</h1>
                    <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Bir alımın aylık nefes payına — ödeme gücüne — etkisi.</p>
                </div>
                <Link
                    href={`/alim-listesi?add=1&amount=${amount}&count=${count}&extra=${extraFixed}`}
                    className="shrink-0 whitespace-nowrap px-[var(--s3)] py-[var(--s2)]"
                    style={{ background: 'var(--surface-2)', color: 'var(--ink)', borderRadius: 'var(--r-button)', fontSize: 13, fontWeight: 600 }}
                >
                    + Alım listesine ekle
                </Link>
            </div>

            <div className="flex flex-col gap-[var(--s3)]">
                {/* Form */}
                <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="space-y-[var(--s4)] p-[22px]">
                    <div>
                        <div className="mb-[var(--s2)]" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>Tutar</div>
                        <input type="number" min={0} step={1000} value={amount} onChange={e => setAmount(Number(e.target.value))}
                            className="tnum w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={{ ...inputStyle, fontSize: 15 }} />
                    </div>
                    <div>
                        <div className="mb-[var(--s2)] flex items-baseline justify-between">
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>Taksit sayısı</span>
                            <span className="tnum" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{count}</span>
                        </div>
                        <input type="range" min={2} max={24} step={1} value={count} onChange={e => setCount(Number(e.target.value))} className="w-full" style={{ accentColor: 'var(--accent)' }} />
                    </div>
                    <div>
                        <div className="mb-[var(--s2)]" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>Aylık ek sabit gider <span style={{ color: 'var(--ink-4)' }}>(sigorta, vergi, bakım… — opsiyonel)</span></div>
                        <input type="number" min={0} step={100} value={extraFixed || ''} placeholder="0" onChange={e => setExtraFixed(Number(e.target.value) || 0)}
                            className="tnum w-full px-[var(--s3)] py-[var(--s2)] outline-none" style={{ ...inputStyle, fontSize: 15 }} />
                    </div>
                </section>

                {/* 2e — bitmiş seri uyarısı: "2 aydır harcama yok, çıkarayım mı?" */}
                {endedSeries.map(e => (
                    <div key={e.categoryId} className="flex items-center justify-between gap-[var(--s3)] p-[var(--s4)]"
                        style={{ background: 'color-mix(in srgb, var(--budget-near) 12%, transparent)', borderRadius: 'var(--r-card)' }}>
                        <p style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>
                            <b style={{ color: 'var(--ink)' }}>{e.label}</b>&apos;te 2 aydır harcama yok ({e.consecutiveMonths} ay sürmüştü). Bitmiş bir şey miydi? Alışkanlık ortalamasından çıkarayım mı?
                        </p>
                        <div className="flex shrink-0 gap-[var(--s2)]">
                            <button onClick={() => excludeEnded(e.categoryId)} className="px-[var(--s3)] py-[6px]" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 'var(--r-button)', fontSize: 12.5, fontWeight: 600 }}>Çıkar</button>
                            <button onClick={() => setDismissedEnded(s => new Set(s).add(e.categoryId))} className="px-[var(--s3)] py-[6px]" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', borderRadius: 'var(--r-button)', fontSize: 12.5 }}>Kalsın</button>
                        </div>
                    </div>
                ))}

                {/* Taban gelir uyarısı / bilgisi */}
                {base && !base.hasBaseIncome && (
                    <div className="p-[var(--s4)]" style={{ background: 'color-mix(in srgb, var(--flow-out) 10%, var(--surface))', borderRadius: 'var(--r-card)', border: '1px solid color-mix(in srgb, var(--flow-out) 30%, transparent)' }}>
                        <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                            Hiçbir gelir kategorisi <b style={{ color: 'var(--ink)' }}>&quot;düzenli&quot;</b> olarak işaretlenmemiş — nefes payı hesaplanamıyor.{' '}
                            <Link href="/settings" className="hover:underline" style={{ color: 'var(--accent)' }}>Ayarlar &gt; Kategoriler</Link>&apos;den maaşını işaretle.
                        </p>
                    </div>
                )}
                {base && base.hasBaseIncome && (
                    <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>
                        Aylık düzenli geliriniz <b className="tnum" style={{ color: 'var(--ink-2)' }}>{formatTL(base.baseIncome)}</b> üzerinden hesaplandı. Prim ve ek gelir dahil değil.
                    </p>
                )}

                {/* Ana çıktı — seçili senaryo */}
                {selected && base && (
                    <MainOutput selected={selected} monthly={monthly} count={count} onEditNature={() => setEditNatureOpen(true)} />
                )}

                {/* Karşılaştırma tablosu */}
                {base && (
                    <ScenarioTable scenarios={scenarios} liquid={base.liquid} amount={amount} />
                )}

                {/* Kırılganlık testi */}
                {roomFull && fragility && (
                    <FragilityCard roomFull={roomFull} fragility={fragility} />
                )}

                {/* Zaman ekseni */}
                {selected && (
                    <TimelineCard breathingRoom={selected.breathingRoom} afterPurchase={selected.afterPurchase ?? selected.breathingRoom} count={count} />
                )}
            </div>

            {/* Toplu doğa düzenleyici (2c) */}
            {editNatureOpen && selected && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setEditNatureOpen(false)}>
                    <div className="w-full max-w-md rounded-[var(--r-card)] p-[var(--s5)]" style={{ background: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
                        <div className="mb-[var(--s2)] flex items-center justify-between">
                            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Alışkanlık mı, tek seferlik mi?</span>
                            <button onClick={() => setEditNatureOpen(false)} className="icon-btn p-1" aria-label="Kapat"><X className="h-5 w-5" /></button>
                        </div>
                        <p className="mb-[var(--s4)]" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Tek seferlik işaretlenenler alışkanlık ortalamasına — nefes payına — girmez.</p>
                        <div className="max-h-[70vh] overflow-y-auto">
                            <CategoryNatureClassifier onChanged={load} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

/** 2. Ana çıktı: nefes payı cümlesi + bar, alışkanlık satırı, açık/imkânsız/veri-yok uyarıları, bitiş. */
function MainOutput({ selected, monthly, count, onEditNature }: { selected: BreathingRoom; monthly: number; count: number; onEditNature: () => void }) {
    const room = selected.breathingRoom
    const after = selected.afterPurchase ?? room
    const ratio = room > 0 ? monthly / room : (monthly > 0 ? 2 : 0) // taksidin nefes payına oranı
    const barColor = ratio >= 1 ? 'var(--flow-out)' : ratio >= 0.5 ? 'var(--budget-near)' : 'var(--accent)'
    const impossible = selected.requiredCutRatio != null && selected.requiredCutRatio > 1

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="space-y-[var(--s3)] p-[22px]">
            {/* a) ana cümle + bar */}
            <div>
                <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--ink)' }}>
                    Aylık nefes payın <b className="tnum">{formatTL(room)}</b>. Bu taksit <b className="tnum">{formatTL(monthly)}</b>&apos;sini alıyor,{' '}
                    {after >= 0
                        ? <>geriye <b className="tnum" style={{ color: 'var(--ink)' }}>{formatTL(after)}</b> kalıyor.</>
                        : <>her ay <b className="tnum" style={{ color: 'var(--flow-out)' }}>{formatTL(after)}</b> açık veriyor.</>}
                </p>
                <div className="mt-[var(--s2)] h-[6px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                    <div className="h-full" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, background: barColor, borderRadius: 'var(--r-bar)' }} />
                </div>
            </div>

            {/* e) veri yok uyarısı — ŞART */}
            {!selected.habitualEstimated && (
                <p className="rounded-[var(--r-button)] px-[var(--s3)] py-[var(--s2)]" style={{ background: 'color-mix(in srgb, var(--budget-near) 12%, transparent)', fontSize: 13, lineHeight: 1.45, color: 'var(--ink-2)' }}>
                    Alışkanlık harcaman henüz hesaplanamıyor (3 aydan az veri). Bu rakam sadece zorunlu çıkışları içeriyor — gerçek nefes payın daha düşük olabilir.
                </p>
            )}

            {/* b) alışkanlık satırı — kısma imkânı */}
            {selected.habitualEstimated && selected.habitualOutflow > 0 && (
                <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                    Alışkanlık harcaman <b className="tnum" style={{ color: 'var(--ink)' }}>{formatTL(selected.habitualOutflow)}</b>{' ('}
                    {selected.habitualByCategory.map((c, i) => (
                        <span key={c.categoryId}>
                            {i > 0 && ' · '}
                            <Link href={`/kategoriler?kategori=${c.categoryId}`} className="transition-colors hover:text-[var(--accent)]" style={{ color: 'var(--ink-2)' }}>
                                {c.label.toLocaleLowerCase('tr')} <span className="tnum">{formatTL(c.amount)}</span>
                            </Link>
                        </span>
                    ))}
                    {'). '}Kısarsan nefes payın artar.{' '}
                    <button onClick={onEditNature} className="transition-colors hover:text-[var(--accent)]" style={{ color: 'var(--ink-3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Yanlış olan varsa düzelt.</button>
                </p>
            )}

            {/* 2d — sınıflanmamış harcama */}
            {selected.unclassifiedTotal > 0 && (
                <p style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink-3)' }}>
                    Aylık <b className="tnum" style={{ color: 'var(--ink-2)' }}>{formatTL(selected.unclassifiedTotal)}</b>&apos;lik harcama henüz sınıflanmadı — alışkanlık mı tek seferlik mi belirtirsen tahmin daha doğru olur.
                </p>
            )}

            {/* c/d) açık varsa çözüm */}
            {after < 0 && (
                impossible ? (
                    <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--flow-out)', fontWeight: 500 }}>
                        Alışkanlık harcamanın tamamını kessen bile bu taksit ödenemez.
                    </p>
                ) : selected.requiredCutRatio != null ? (
                    <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                        Her ay <b className="tnum" style={{ color: 'var(--flow-out)' }}>{formatTL(after)}</b> açık var. Alışkanlık harcamandan{' '}
                        <b style={{ color: 'var(--ink)' }}>{pct(selected.requiredCutRatio)}</b> kısarsan denk gelir.
                    </p>
                ) : null
            )}

            {/* f) bitiş */}
            <p className="pt-[var(--s2)]" style={{ borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--ink-3)' }}>
                Taksit bittiğinde (<span className="tnum">{endMonthLabel(count)}</span>) bu yük kalkıyor, aylık nefes payın <span className="tnum" style={{ color: 'var(--ink)' }}>{formatTL(room)}</span>&apos;e dönüyor.
            </p>
        </section>
    )
}

/** 3. Karşılaştırma tablosu — peşin + taksit senaryoları yan yana. */
function ScenarioTable({ scenarios, liquid, amount }: { scenarios: { count: number; monthly: number; r: BreathingRoom | null }[]; liquid: number; amount: number }) {
    const label = (c: number) => c === 0 ? 'Peşin' : `${c} taksit`
    const cutText = (r: BreathingRoom | null) => {
        if (!r) return '—'
        if ((r.afterPurchase ?? 0) >= 0) return '—'
        if (r.requiredCutRatio == null) return 'imkânsız'
        return r.requiredCutRatio > 1 ? 'imkânsız' : pct(r.requiredCutRatio)
    }
    const rowStyle = { fontSize: 12.5, color: 'var(--ink-3)' }
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="overflow-x-auto p-[22px]">
            <div className="mb-[var(--s3)]" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Senaryolar</div>
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th className="text-left" style={rowStyle} />
                        {scenarios.map(s => (
                            <th key={s.count} className="px-[var(--s2)] pb-[var(--s2)] text-right" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{label(s.count)}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    <Row label="Aylık taksit">
                        {scenarios.map(s => <Cell key={s.count}>{s.count === 0 ? '—' : formatTL(s.monthly)}</Cell>)}
                    </Row>
                    <Row label="Nefes payı sonrası">
                        {scenarios.map(s => {
                            const v = s.count === 0 ? (s.r?.breathingRoom ?? 0) : (s.r?.afterPurchase ?? 0)
                            return <Cell key={s.count} color={v < 0 ? 'var(--flow-out)' : 'var(--ink)'} bold>{formatTL(v)}</Cell>
                        })}
                    </Row>
                    <Row label="Gereken kısma">
                        {scenarios.map(s => {
                            const t = cutText(s.r)
                            return <Cell key={s.count} color={t === 'imkânsız' ? 'var(--flow-out)' : 'var(--ink-2)'}>{t}</Cell>
                        })}
                    </Row>
                    <Row label="Biter">
                        {scenarios.map(s => <Cell key={s.count} color="var(--ink-3)">{s.count === 0 ? '—' : endMonthLabel(s.count)}</Cell>)}
                    </Row>
                </tbody>
            </table>
            {/* Peşin: stok bilgisi, sessiz */}
            <p className="mt-[var(--s3)] pt-[var(--s3)] tnum" style={{ borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--ink-4)' }}>
                Peşin ödeme bakiyeni {formatTL(liquid)}&apos;ten {formatTL(liquid - amount)}&apos;e indirir.
            </p>
        </section>
    )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td className="py-[var(--s2)] pr-[var(--s3)]" style={{ fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{label}</td>
            {children}
        </tr>
    )
}
function Cell({ children, color = 'var(--ink)', bold }: { children: React.ReactNode; color?: string; bold?: boolean }) {
    return <td className="tnum px-[var(--s2)] py-[var(--s2)] text-right" style={{ fontSize: 13, color, fontWeight: bold ? 600 : 400, whiteSpace: 'nowrap' }}>{children}</td>
}

/** 4. Kırılganlık testi — düzenli gelir %30 düşerse (taban zaten yalnız maaş). */
function FragilityCard({ roomFull, fragility }: { roomFull: BreathingRoom; fragility: BreathingRoom }) {
    const full = roomFull.breathingRoom
    const shocked = fragility.breathingRoom
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div className="mb-[var(--s2)]" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Kırılganlık</div>
            <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                Düzenli gelirin %30 düşerse nefes payın <span className="tnum" style={{ color: 'var(--ink)' }}>{formatTL(full)}</span>&apos;den{' '}
                <span className="tnum" style={{ color: shocked < 0 ? 'var(--flow-out)' : 'var(--ink)' }}>{formatTL(shocked)}</span>&apos;e iner.{' '}
                {shocked >= 0
                    ? <>Bu şoka rağmen nefes payın pozitif kalıyor.</>
                    : fragility.requiredCutRatio != null && fragility.requiredCutRatio <= 1
                        ? <>Alışkanlık harcamandan <b style={{ color: 'var(--ink)' }}>{pct(fragility.requiredCutRatio)}</b> kısarak açığı kapatabilirsin.</>
                        : <>Alışkanlığın tamamını kessen bile açık kapanmıyor.</>}
            </p>
        </section>
    )
}

/** 6. Zaman ekseni — 12 aylık nefes payı seyri (bakiye değil). */
function TimelineCard({ breathingRoom, afterPurchase, count }: { breathingRoom: number; afterPurchase: number; count: number }) {
    const N = 12
    const withoutP = Array.from({ length: N }, () => breathingRoom)
    const withP = Array.from({ length: N }, (_, i) => i < count ? afterPurchase : breathingRoom)
    const all = [...withoutP, ...withP, 0]
    const maxV = Math.max(...all), minV = Math.min(...all)
    const span = (maxV - minV) || 1
    const W = 320, H = 96, pad = 6
    const x = (i: number) => pad + (i * (W - 2 * pad)) / (N - 1)
    const y = (v: number) => pad + (1 - (v - minV) / span) * (H - 2 * pad)
    const zeroY = y(0)
    const line = (arr: number[]) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    const endIdx = count <= N ? count : -1

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div className="mb-[var(--s3)] flex items-baseline justify-between">
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>12 aylık nefes payı seyri</span>
                <span className="flex items-center gap-[var(--s3)]" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    <span className="flex items-center gap-[4px]"><span style={{ width: 14, height: 0, borderTop: '1.5px dashed var(--ink-3)' }} /> alımsız</span>
                    <span className="flex items-center gap-[4px]"><span style={{ width: 14, height: 2, background: 'var(--ink)' }} /> alımlı</span>
                </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[96px] w-full" role="img" aria-label="Nefes payı seyri">
                {/* sıfır çizgisi */}
                <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="var(--ink-4)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {/* alımsız — kesikli */}
                <polyline points={line(withoutP)} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                {/* alımlı — dolu; negatif segmentler flow-out */}
                {withP.slice(1).map((v, i) => {
                    const a = withP[i], b = v
                    const neg = a < 0 || b < 0
                    return <line key={i} x1={x(i)} y1={y(a)} x2={x(i + 1)} y2={y(b)} stroke={neg ? 'var(--flow-out)' : 'var(--ink)'} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                })}
                {/* taksit bitiş işareti */}
                {endIdx >= 0 && endIdx < N && (
                    <line x1={x(endIdx)} y1={pad} x2={x(endIdx)} y2={H - pad} stroke="var(--accent)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
                )}
            </svg>
            <div className="mt-[var(--s2)] flex gap-[3px]">
                {Array.from({ length: N }, (_, i) => {
                    const d = new Date(); d.setMonth(d.getMonth() + i)
                    const isEnd = i === endIdx
                    return <span key={i} className="flex-1 text-center" style={{ fontSize: 9.5, fontWeight: isEnd ? 700 : 400, color: isEnd ? 'var(--accent)' : 'var(--ink-4)' }}>{TR_MON_LETTER[d.getMonth()]}</span>
                })}
            </div>
        </section>
    )
}
