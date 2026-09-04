'use client'

import { useState, useEffect, useMemo } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, ChevronDown, Check, X, Archive, Sparkles, Plus, Minus } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { PrimaryButton } from "@/components/ui/primary-button"
import { GoalModal } from "@/components/goals/GoalModal"
import { computeGoalProgress, type GoalProgress } from "@/lib/goal-progress"
import { useIsDesktop } from "@/hooks/use-is-desktop"

const FALLBACK_RATES: Record<string, number> = { USD: 34, EUR: 37, GBP: 45, ALTIN: 2900, TL: 1 }
const TR_MON_LETTER = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A']

function todayStr() { return new Date().toISOString().slice(0, 10) }
function monthStart(iso: string) { return `${iso.slice(0, 7)}-01` }

type Goal = {
    id: string; name: string; icon: string | null
    target_amount: number; saved_tl: number; saved_usd: number; saved_eur: number; saved_gold: number
    is_fiat: boolean; asset_unit: string | null; asset_name: string | null
    monthly_alloc: number | null; deadline: string | null; status: string
    source_account_id: string | null; created_at: string
}
type Contribution = { id: string; goal_id: string; period: string; amount: number; account_id: string | null }
type Account = { id: string; name: string; type: string }

/** Hedefin ilerleme birimini ve kur karşılığını çözer. */
function unitOf(g: Goal): string { return g.is_fiat ? 'TRY' : (g.asset_unit || g.asset_name || 'birim') }
function fmt(v: number, unit: string): string {
    const s = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(v)))
    return unit === 'TRY' ? `${v < 0 ? '−' : ''}${s} ₺` : `${s} ${unit}`
}

export default function HedeflerPage() {
    const [goals, setGoals] = useState<Goal[]>([])
    const [contribs, setContribs] = useState<Contribution[]>([])
    const [accounts, setAccounts] = useState<Account[]>([])
    const [rates, setRates] = useState<Record<string, number>>(FALLBACK_RATES)
    const [isLoading, setIsLoading] = useState(true)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const isDesktop = useIsDesktop()
    const [addOpen, setAddOpen] = useState(false)
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ aktif: true, hazir: true, arsiv: false })

    const fetchAll = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return
            const [gRes, cRes, aRes, rRes] = await Promise.all([
                supabase.from('goals').select('*').eq('household_id', hhId).order('created_at', { ascending: false }),
                supabase.from('goal_contributions').select('id, goal_id, period, amount, account_id').eq('household_id', hhId),
                supabase.from('accounts').select('id, name, type').eq('household_id', hhId),
                fetch('/api/rates').then(r => r.json()).catch(() => ({ success: false })),
            ])
            setGoals((gRes.data || []) as Goal[])
            setContribs((cRes.data || []) as Contribution[])
            setAccounts((aRes.data || []) as Account[])
            if (rRes?.success && rRes.rates) setRates({ ...FALLBACK_RATES, ...rRes.rates })
        } catch (e) {
            console.error('Hedefler alınamadı:', e)
        } finally {
            setIsLoading(false)
        }
    }
    useEffect(() => { fetchAll() }, [])

    // Kur: birim hedeflerde katkıyı (TL) birime çevirmek için.
    const rateFor = (g: Goal): number | null => {
        if (g.is_fiat) return 1
        const key = (g.asset_name || '').toLowerCase()
        if (key.includes('dolar')) return rates.USD ?? null
        if (key.includes('euro')) return rates.EUR ?? null
        if (key.includes('sterlin')) return rates.GBP ?? null
        if (key.includes('altın') || key.includes('altin')) return rates.ALTIN ?? null
        return null
    }

    // Her hedef için ilerleme (goal-progress.ts).
    const progressById = useMemo(() => {
        const map = new Map<string, GoalProgress>()
        for (const g of goals) {
            const unit = unitOf(g)
            const rate = rateFor(g)
            const savedAmount = g.is_fiat ? g.saved_tl
                : (g.asset_name || '').toLowerCase().includes('altın') ? g.saved_gold
                    : (g.asset_name || '').toLowerCase().includes('dolar') ? g.saved_usd
                        : (g.asset_name || '').toLowerCase().includes('euro') ? g.saved_eur : 0
            const cs = contribs.filter(c => c.goal_id === g.id).map(c => ({
                period: c.period, amount: c.amount,
                unitAmount: g.is_fiat ? c.amount : (rate ? Number(c.amount) / rate : null),
            }))
            map.set(g.id, computeGoalProgress({
                goal: { targetAmount: g.target_amount, savedAmount, monthlyAlloc: g.monthly_alloc, targetDate: g.deadline, unit },
                contributions: cs, today: todayStr(),
            }))
        }
        return map
    }, [goals, contribs, rates])

    // Gruplar: aktif / hazir / arsiv.
    const groups = useMemo(() => {
        const g = { aktif: [] as Goal[], hazir: [] as Goal[], arsiv: [] as Goal[] }
        for (const goal of goals) (g as any)[goal.status === 'hazir' ? 'hazir' : goal.status === 'arsiv' ? 'arsiv' : 'aktif'].push(goal)
        return g
    }, [goals])

    // Özet: bu ay gerçekleşen katkı + aktif hedeflerin planlanan payından kalan.
    const summary = useMemo(() => {
        const cm = monthStart(todayStr())
        const savedThisMonth = contribs
            .filter(c => monthStart(c.period) === cm && goals.find(g => g.id === c.goal_id)?.status === 'aktif')
            .reduce((s, c) => s + Number(c.amount), 0)
        const planned = groups.aktif.reduce((s, g) => s + Number(g.monthly_alloc || 0), 0)
        return { savedThisMonth: Math.round(savedThisMonth), planned: Math.round(planned), remaining: Math.max(0, Math.round(planned - savedThisMonth)) }
    }, [contribs, goals, groups])

    const selected = goals.find(g => g.id === selectedId) ?? null

    // Açılışta ilk aktif hedef varsayılan seçili (masaüstü; mobilde sheet açılmasın).
    useEffect(() => {
        if (selectedId || goals.length === 0 || !isDesktop) return
        const first = groups.aktif[0] ?? groups.hazir[0] ?? goals[0]
        if (first) setSelectedId(first.id)
    }, [goals, groups, selectedId, isDesktop])

    if (isLoading) {
        return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    }

    const detailNode = selected && (
        <GoalDetail
            goal={selected} progress={progressById.get(selected.id)!} accounts={accounts}
            contribs={contribs.filter(c => c.goal_id === selected.id)}
            onChanged={fetchAll} onClose={() => setSelectedId(null)}
        />
    )

    return (
        <div className="w-full pb-10">
            <div className="mb-[var(--s4)] flex items-center justify-between gap-[var(--s3)]">
                <PageHeader title="Hedefler" />
                <PrimaryButton onClick={() => setAddOpen(true)}>+ Hedef ekle</PrimaryButton>
            </div>

            {goals.length === 0 ? (
                <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                    <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>İlk hedefini ekle</p>
                    <p className="mt-[var(--s2)]" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                        Bir birikim hedefi belirle; her ay ne kadar ayırdığını ve bu hızla ne zaman ulaşacağını burada gör.
                    </p>
                    <div className="mt-[var(--s4)]"><PrimaryButton onClick={() => setAddOpen(true)}>İlk hedefini ekle</PrimaryButton></div>
                </section>
            ) : (
                <div className="flex items-start gap-[var(--s3)]">
                    {/* SOL PANEL */}
                    <div className="flex min-w-0 flex-1 flex-col gap-[var(--s3)]">
                        <SummaryCard summary={summary} />
                        <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="overflow-hidden py-[var(--s2)]">
                            <GoalGroup title="Aktif" gkey="aktif" goals={groups.aktif} progressById={progressById}
                                open={openGroups.aktif} onToggle={() => setOpenGroups(s => ({ ...s, aktif: !s.aktif }))}
                                selectedId={selectedId} onSelect={setSelectedId} />
                            <GoalGroup title="Harcanmaya hazır" gkey="hazir" goals={groups.hazir} progressById={progressById}
                                open={openGroups.hazir} onToggle={() => setOpenGroups(s => ({ ...s, hazir: !s.hazir }))}
                                selectedId={selectedId} onSelect={setSelectedId} />
                            <GoalGroup title="Arşiv" gkey="arsiv" goals={groups.arsiv} progressById={progressById} faded
                                open={openGroups.arsiv} onToggle={() => setOpenGroups(s => ({ ...s, arsiv: !s.arsiv }))}
                                selectedId={selectedId} onSelect={setSelectedId} />
                        </div>
                    </div>

                    {/* SAĞ PANEL — masaüstü sticky */}
                    <aside className="hidden w-[420px] shrink-0 lg:block">
                        <div className="sticky top-[var(--s3)]" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                            {detailNode ?? (
                                <div className="flex h-[280px] items-center justify-center px-[22px] text-center" style={{ fontSize: 14, color: 'var(--ink-3)' }}>
                                    Bir hedef seç
                                </div>
                            )}
                        </div>
                    </aside>
                </div>
            )}

            {/* Mobil bottom sheet */}
            {selected && (
                <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setSelectedId(null)}>
                    <div className="max-h-[90vh] overflow-y-auto" style={{ background: 'var(--surface)', borderTopLeftRadius: 'var(--r-card)', borderTopRightRadius: 'var(--r-card)' }} onClick={e => e.stopPropagation()}>
                        {detailNode}
                    </div>
                </div>
            )}

            <GoalModal isOpen={addOpen} onClose={() => setAddOpen(false)} onSuccess={() => { setAddOpen(false); fetchAll() }} />
        </div>
    )
}

/** Üst özet — bu ay birikti / kaldı + halka. */
function SummaryCard({ summary }: { summary: { savedThisMonth: number; planned: number; remaining: number } }) {
    const pct = summary.planned > 0 ? Math.min(1, summary.savedThisMonth / summary.planned) : 0
    const R = 26, C = 2 * Math.PI * R
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="flex items-center justify-between gap-[var(--s4)] p-[22px]">
            <div>
                <div className="tnum" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                    Bu ay {fmt(summary.savedThisMonth, 'TRY')} birikti
                </div>
                <div className="tnum mt-[2px]" style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
                    planlanan paydan {fmt(summary.remaining, 'TRY')} kaldı
                </div>
            </div>
            <svg width={64} height={64} viewBox="0 0 64 64" className="shrink-0">
                <circle cx={32} cy={32} r={R} fill="none" stroke="var(--fill-track)" strokeWidth={6} />
                <circle cx={32} cy={32} r={R} fill="none" stroke="var(--accent)" strokeWidth={6} strokeLinecap="round"
                    strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 32 32)" />
                <text x={32} y={32} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 15, fontWeight: 700, fill: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>%{Math.round(pct * 100)}</text>
            </svg>
        </section>
    )
}

/** Açılır/kapanır hedef grubu. */
function GoalGroup({ title, gkey, goals, progressById, open, onToggle, selectedId, onSelect, faded }: {
    title: string; gkey: string; goals: Goal[]; progressById: Map<string, GoalProgress>
    open: boolean; onToggle: () => void; selectedId: string | null; onSelect: (id: string) => void; faded?: boolean
}) {
    if (goals.length === 0) return null
    return (
        <div>
            <button onClick={onToggle} className="flex w-full items-center gap-[var(--s2)] px-[22px] pb-[var(--s1)] pt-[var(--s3)]">
                <ChevronDown className="h-[13px] w-[13px] transition-transform" style={{ color: 'var(--ink-3)', transform: open ? 'none' : 'rotate(-90deg)' }} />
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{title}</span>
                <span className="tnum" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{goals.length}</span>
            </button>
            {open && (
                <ul>
                    {goals.map(g => {
                        const p = progressById.get(g.id)!
                        const unit = unitOf(g)
                        const sel = g.id === selectedId
                        return (
                            <li key={g.id}>
                                <button onClick={() => onSelect(g.id)}
                                    className="flex w-full items-center gap-[var(--s3)] px-[22px] py-[11px] text-left transition-colors"
                                    style={{ background: sel ? 'var(--surface-2)' : 'transparent', boxShadow: sel ? 'inset 3px 0 0 var(--accent)' : 'none', opacity: faded ? 0.55 : 1 }}>
                                    <span style={{ fontSize: 18 }} aria-hidden>{g.icon || '🎯'}</span>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate" style={{ fontSize: 14, color: 'var(--ink)' }}>{g.name}</div>
                                        <div className="mt-[5px] h-[4px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                                            <div className="h-full" style={{ width: `${Math.min(100, p.progress * 100)}%`, background: 'var(--accent)', borderRadius: 'var(--r-bar)' }} />
                                        </div>
                                    </div>
                                    <span className="tnum shrink-0" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                                        {fmt(p.saved, unit)} <span style={{ color: 'var(--ink-3)' }}>/ {fmt(Number(g.target_amount), unit)}</span>
                                    </span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

/** Sağ detay paneli. */
function GoalDetail({ goal, progress, accounts, contribs, onChanged, onClose }: {
    goal: Goal; progress: GoalProgress; accounts: Account[]; contribs: Contribution[]
    onChanged: () => void; onClose: () => void
}) {
    const unit = unitOf(goal)
    const [saving, setSaving] = useState(false)
    const [contribMode, setContribMode] = useState<'deposit' | 'withdraw' | null>(null)

    const patch = async (fields: Record<string, any>) => {
        setSaving(true)
        try {
            const { error } = await supabase.from('goals').update(fields).eq('id', goal.id)
            if (error) throw error
            onChanged()
        } catch (e) { console.error(e) } finally { setSaving(false) }
    }

    const markReady = () => patch({ status: 'hazir' })
    const archive = () => { if (confirm('Bu hedefi arşivlemek istiyor musun?')) patch({ status: 'arsiv' }) }
    const activate = () => patch({ status: 'aktif' })

    const accName = (id: string | null) => accounts.find(a => a.id === id)?.name ?? null
    const totalContrib = contribs.reduce((s, c) => s + Number(c.amount), 0)
    const bySource = new Map<string | null, number>()
    for (const c of contribs) bySource.set(c.account_id, (bySource.get(c.account_id) ?? 0) + Number(c.amount))

    return (
        <div className="p-[22px]">
            <div className="mb-[var(--s3)] flex items-center justify-between">
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Hedef</span>
                <button onClick={onClose} aria-label="Kapat"><ChevronDown className="h-[18px] w-[18px] lg:hidden" style={{ color: 'var(--ink-3)' }} /><X className="hidden h-[16px] w-[16px] lg:inline" style={{ color: 'var(--ink-3)' }} /></button>
            </div>

            {/* Başlık + biriken/kalan */}
            <div className="flex items-start justify-between gap-[var(--s3)]">
                <div className="flex min-w-0 items-center gap-[var(--s3)]">
                    <span style={{ fontSize: 26 }} aria-hidden>{goal.icon || '🎯'}</span>
                    <h2 className="min-w-0 truncate" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{goal.name}</h2>
                </div>
                <div className="shrink-0 text-right">
                    <div className="tnum" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{fmt(progress.saved, unit)}</div>
                    <div className="tnum" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{fmt(progress.remaining, unit)} kaldı</div>
                </div>
            </div>

            {/* Aylık katkı şeridi */}
            <div className="mt-[var(--s5)] flex items-center justify-between gap-[3px]">
                {progress.monthlyHistory.map((m, i) => {
                    const cur = m.period.slice(0, 7) === todayStr().slice(0, 7)
                    return (
                        <div key={m.period} className="flex flex-1 flex-col items-center gap-[4px]">
                            <span className="inline-flex items-center justify-center rounded-full"
                                style={{
                                    width: 22, height: 22,
                                    background: m.done ? 'var(--flow-in)' : 'transparent',
                                    border: m.done ? 'none' : '1.5px solid var(--ink-4)',
                                    boxShadow: cur ? '0 0 0 2px var(--accent)' : 'none',
                                }}>
                                {m.done && <Check className="h-[12px] w-[12px]" style={{ color: '#fff' }} strokeWidth={3} />}
                            </span>
                            <span style={{ fontSize: 9, color: cur ? 'var(--ink)' : 'var(--ink-3)', fontWeight: cur ? 700 : 400 }}>{TR_MON_LETTER[Number(m.period.slice(5, 7)) - 1]}</span>
                        </div>
                    )
                })}
            </div>

            {/* ETA */}
            <EtaLine goal={goal} progress={progress} onDefineAlloc={() => setContribMode(null)} />

            {progress.unconvertedCount > 0 && (
                <p className="mt-[var(--s2)]" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {progress.unconvertedCount} katkı kur bilgisi olmadığı için birim ilerlemesine dahil edilmedi.
                </p>
            )}

            {/* Ready-to-spend önerisi */}
            {progress.remaining <= 0 && goal.status === 'aktif' && (
                <div className="mt-[var(--s4)] flex items-center justify-between gap-[var(--s3)] rounded-[var(--r-button)] p-[var(--s3)]" style={{ background: 'var(--accent-bg)' }}>
                    <span className="flex items-center gap-[var(--s2)]" style={{ fontSize: 13.5, color: 'var(--ink)' }}>
                        <Sparkles className="h-[15px] w-[15px]" style={{ color: 'var(--accent)' }} /> Hedefe ulaştın
                    </span>
                    <button onClick={markReady} disabled={saving} style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>Harcanmaya hazır işaretle</button>
                </div>
            )}

            {/* Özet — satır içi düzenlenebilir */}
            <div className="mt-[var(--s5)]">
                <div className="mb-[var(--s2)]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Özet</div>
                <EditRow label="Hedef tutarı" value={fmt(Number(goal.target_amount), unit)} type="number" onSave={v => patch({ target_amount: Number(v) })} />
                <EditRow label="Başlangıç" value={fmt(goal.is_fiat ? goal.saved_tl : goal.saved_gold, unit)} type="number" onSave={v => patch({ [goal.is_fiat ? 'saved_tl' : 'saved_gold']: Number(v) })} />
                <EditRow label="Aylık pay" value={goal.monthly_alloc ? fmt(Number(goal.monthly_alloc), 'TRY') : '—'} type="number" onSave={v => patch({ monthly_alloc: v ? Number(v) : null })} />
                <EditRow label="Hesap" value={accName(goal.source_account_id) ?? '—'} type="account" accounts={accounts} onSave={v => patch({ source_account_id: v || null })} />
                <div className="flex items-center justify-between py-[var(--s2)]" style={{ borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>Birim</span>
                    <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>{unit === 'TRY' ? 'Türk Lirası' : unit}</span>
                </div>
            </div>

            {/* Katkılar */}
            <div className="mt-[var(--s5)]">
                <div className="mb-[var(--s2)] flex items-center justify-between">
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Katkılar</span>
                    <div className="flex items-center gap-[var(--s3)]">
                        <button onClick={() => setContribMode('deposit')} className="inline-flex items-center gap-[3px]" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)' }}>
                            <Plus className="h-[13px] w-[13px]" /> Katkı ekle
                        </button>
                        {totalContrib > 0 && (
                            <button onClick={() => setContribMode('withdraw')} className="inline-flex items-center gap-[3px]" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)' }}>
                                <Minus className="h-[13px] w-[13px]" /> Para çek
                            </button>
                        )}
                    </div>
                </div>
                {bySource.size === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Henüz katkı kaydı yok.</p>
                ) : (
                    <ul className="flex flex-col gap-[var(--s2)]">
                        {[...bySource.entries()].map(([accId, amt]) => (
                            <li key={accId ?? 'none'} className="flex items-center justify-between">
                                <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{accName(accId) ?? 'Hesapsız'}</span>
                                <span className="tnum" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{fmt(amt, 'TRY')}</span>
                            </li>
                        ))}
                        <li className="flex items-center justify-between pt-[var(--s2)]" style={{ borderTop: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Toplam biriken</span>
                            <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{fmt(totalContrib, 'TRY')}</span>
                        </li>
                    </ul>
                )}
            </div>

            {/* Durum aksiyonları */}
            <div className="mt-[var(--s5)] flex items-center gap-[var(--s4)] pt-[var(--s4)]" style={{ borderTop: '1px solid var(--border)' }}>
                {goal.status !== 'aktif' && <button onClick={activate} disabled={saving} style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--accent)' }}>Yeniden etkinleştir</button>}
                {goal.status !== 'arsiv' && (
                    <button onClick={archive} disabled={saving} className="inline-flex items-center gap-[var(--s2)]" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-3)' }}>
                        <Archive className="h-[14px] w-[14px]" /> Arşivle
                    </button>
                )}
            </div>

            {contribMode && (
                <ContributeModal goal={goal} accounts={accounts} mode={contribMode} onClose={() => setContribMode(null)} onDone={() => { setContribMode(null); onChanged() }} />
            )}
        </div>
    )
}

function EtaLine({ goal, progress }: { goal: Goal; progress: GoalProgress; onDefineAlloc?: () => void }) {
    let text: string
    if (progress.remaining <= 0) text = 'Hedefe ulaştın 🎉'
    else if (!progress.eta) text = 'Aylık pay tanımlı değil — ulaşma süresi hesaplanamıyor.'
    else if (goal.deadline && progress.onTrack === false) {
        text = `Hedef tarihe yetişmek için aylık ${fmt(progress.requiredMonthly ?? 0, 'TRY')} gerekiyor (şu an ${fmt(Number(goal.monthly_alloc || 0), 'TRY')}).`
    } else {
        text = `Bu hızla hedefe ${progress.etaText}${progress.etaText === 'bu ay' ? '' : 'da'} ulaşırsın.`
    }
    return (
        <p className="mt-[var(--s4)] flex items-start gap-[var(--s2)]" style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>
            <Sparkles className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: 'var(--accent)' }} />
            {text}
        </p>
    )
}

/** Satır-içi düzenlenebilir özet satırı. */
function EditRow({ label, value, type, accounts, onSave }: {
    label: string; value: string; type: 'number' | 'account'; accounts?: Account[]; onSave: (v: string) => void
}) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const start = () => { setDraft(''); setEditing(true) }
    const commit = () => { setEditing(false); if (draft !== '') onSave(draft) }
    return (
        <div className="flex items-center justify-between gap-[var(--s3)] py-[var(--s2)]" style={{ borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>{label}</span>
            {editing ? (
                type === 'account' ? (
                    <select autoFocus defaultValue="" onChange={e => { onSave(e.target.value); setEditing(false) }} onBlur={() => setEditing(false)}
                        className="px-[var(--s2)] py-[2px] outline-none" style={{ fontSize: 13.5, background: 'var(--surface-2)', borderRadius: 'var(--r-button)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                        <option value="">Hesapsız</option>
                        {accounts?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                ) : (
                    <input autoFocus type="number" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
                        onKeyDown={e => e.key === 'Enter' && commit()}
                        className="w-[110px] px-[var(--s2)] py-[2px] text-right outline-none" style={{ fontSize: 13.5, background: 'var(--surface-2)', borderRadius: 'var(--r-button)', color: 'var(--ink)', border: '1px solid var(--border)' }} />
                )
            ) : (
                <button onClick={start} className="tnum transition-opacity hover:opacity-70" style={{ fontSize: 13.5, color: 'var(--ink)' }}>{value}</button>
            )}
        </div>
    )
}

/** Katkı ekle / Para çek — o ay için goal_contributions (tek satır, upsert). */
function ContributeModal({ goal, accounts, mode = 'deposit', onClose, onDone }: { goal: Goal; accounts: Account[]; mode?: 'deposit' | 'withdraw'; onClose: () => void; onDone: () => void }) {
    const isWithdraw = mode === 'withdraw'
    const [amount, setAmount] = useState(isWithdraw ? '' : (goal.monthly_alloc ? String(goal.monthly_alloc) : ''))
    const [month, setMonth] = useState(todayStr().slice(0, 7))
    const [accId, setAccId] = useState(goal.source_account_id ?? '')
    const [saving, setSaving] = useState(false)

    // UNIQUE(goal_id, period): ay başına tek satır. Bu yüzden çekim, ayrı bir
    // negatif satır DEĞİL, o ayın mevcut net tutarından düşülerek upsert edilir
    // (read-modify-write). Katkı eski davranışıyla o ayı SET eder; çekim netler.
    // computeGoalProgress işaretli tutarları topladığı için ayrı hesap yok.
    const save = async () => {
        const amt = parseFloat(amount)
        if (!amt || amt <= 0) return
        setSaving(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            const hhId = user ? await ensureHouseholdExists(user.id) : null
            const period = `${month}-01`
            let newAmount = amt
            let accountId: string | null = accId || null
            if (isWithdraw) {
                const { data: existing } = await supabase.from('goal_contributions')
                    .select('amount, account_id').eq('goal_id', goal.id).eq('period', period).maybeSingle()
                const current = existing ? Number(existing.amount) : 0
                newAmount = Math.round((current - amt) * 100) / 100        // net (negatif olabilir)
                accountId = accId || existing?.account_id || null           // seçilmezse kaynağı koru
            }
            const { error } = await supabase.from('goal_contributions')
                .upsert({ household_id: hhId, goal_id: goal.id, period, amount: newAmount, account_id: accountId }, { onConflict: 'goal_id,period' })
            if (error) throw error
            onDone()
        } catch (e) { console.error(isWithdraw ? 'Çekim kaydedilemedi:' : 'Katkı kaydedilemedi:', e); setSaving(false) }
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-[var(--s4)]" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
            <div className="w-full max-w-[380px] p-[22px]" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} onClick={e => e.stopPropagation()}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{isWithdraw ? 'Para çek' : 'Katkı ekle'} · {goal.name}</div>
                <div className="mt-[var(--s4)] flex flex-col gap-[var(--s3)]">
                    <label className="flex flex-col gap-[4px]">
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Ay</span>
                        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="px-[var(--s3)] py-[var(--s2)] outline-none" style={{ fontSize: 14, background: 'var(--surface-2)', borderRadius: 'var(--r-button)', color: 'var(--ink)', border: '1px solid var(--border)' }} />
                    </label>
                    <label className="flex flex-col gap-[4px]">
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Tutar (₺)</span>
                        <input autoFocus type="number" value={amount} onChange={e => setAmount(e.target.value)} className="px-[var(--s3)] py-[var(--s2)] outline-none" style={{ fontSize: 14, background: 'var(--surface-2)', borderRadius: 'var(--r-button)', color: 'var(--ink)', border: '1px solid var(--border)' }} />
                    </label>
                    <label className="flex flex-col gap-[4px]">
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{isWithdraw ? 'Hangi hesaba' : 'Hesap'}</span>
                        <select value={accId} onChange={e => setAccId(e.target.value)} className="px-[var(--s3)] py-[var(--s2)] outline-none" style={{ fontSize: 14, background: 'var(--surface-2)', borderRadius: 'var(--r-button)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                            <option value="">Hesapsız</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </label>
                    {isWithdraw && (
                        <p style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--ink-3)' }}>
                            Çekim o ayın net katkısından düşülür; biriken toplam azalır.
                        </p>
                    )}
                </div>
                <div className="mt-[var(--s5)] flex justify-end gap-[var(--s3)]">
                    <button onClick={onClose} style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-3)' }} className="px-[var(--s3)] py-[var(--s2)]">Vazgeç</button>
                    <button onClick={save} disabled={saving || !amount} className="rounded-[var(--r-button)] px-[var(--s4)] py-[var(--s2)] disabled:opacity-50" style={{ fontSize: 14, fontWeight: 600, background: 'var(--accent)', color: '#fff' }}>{saving ? 'Kaydediliyor…' : isWithdraw ? 'Çek' : 'Kaydet'}</button>
                </div>
            </div>
        </div>
    )
}
