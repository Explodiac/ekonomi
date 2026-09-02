"use client"

import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2 } from "lucide-react"
import { Segmented } from "@/components/ui/segmented"

type Settings = {
    reserve_months: number
    alert_budget_pct: number
    alert_card_pct: number
    alert_debt_service_pct: number
}
const DEFAULTS: Settings = { reserve_months: 3, alert_budget_pct: 90, alert_card_pct: 70, alert_debt_service_pct: 40 }

export default function TercihlerPage() {
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)
    const [hhId, setHhId] = useState<string | null>(null)
    const [settings, setSettings] = useState<Settings>(DEFAULTS)
    const [negativeCarry, setNegativeCarry] = useState(true)
    const [isLoading, setIsLoading] = useState(true)
    const [savedFlash, setSavedFlash] = useState(false)

    useEffect(() => { setMounted(true) }, [])

    const fetchAll = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const id = await ensureHouseholdExists(user.id)
            setHhId(id)
            const [sRes, hhRes] = await Promise.all([
                supabase.from('settings').select('*').eq('household_id', id).maybeSingle(),
                supabase.from('households').select('negative_carry').eq('id', id).single(),
            ])
            if (sRes.data) setSettings({
                reserve_months: Number(sRes.data.reserve_months),
                alert_budget_pct: sRes.data.alert_budget_pct,
                alert_card_pct: sRes.data.alert_card_pct,
                alert_debt_service_pct: sRes.data.alert_debt_service_pct,
            })
            setNegativeCarry(hhRes.data?.negative_carry ?? true)
        } catch (e: any) {
            console.error('Tercihler yüklenemedi:', e)
        } finally {
            setIsLoading(false)
        }
    }
    useEffect(() => { fetchAll() }, [])

    const persist = async (next: Settings) => {
        if (!hhId) return
        setSettings(next)
        try {
            await supabase.from('settings').upsert(
                { household_id: hhId, ...next, updated_at: new Date().toISOString() },
                { onConflict: 'household_id' },
            )
            setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1200)
        } catch (e: any) {
            console.error('Tercih kaydedilemedi:', e)
        }
    }

    const toggleNegativeCarry = async () => {
        if (!hhId) return
        const next = !negativeCarry
        setNegativeCarry(next)
        try { await supabase.from('households').update({ negative_carry: next }).eq('id', hhId) }
        catch (e: any) { console.error('Ayar güncellenemedi:', e) }
    }

    const inputStyle = { background: 'var(--bg)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 14 } as const

    if (isLoading) return <div className="flex items-center justify-center py-[var(--s6)]"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>

    return (
        <div className="flex flex-col gap-[var(--s3)] pb-10">
            {/* Tema */}
            <Card title="Görünüm" desc="Uygulama teması.">
                {mounted && (
                    <Segmented
                        options={[{ value: 'dark', label: 'Koyu' }, { value: 'light', label: 'Açık' }, { value: 'system', label: 'Sistem' }]}
                        value={(theme as 'dark' | 'light' | 'system') || 'system'}
                        onChange={(v) => setTheme(v)}
                    />
                )}
            </Card>

            {/* Rezerv */}
            <Card title="Rezerv" desc="Dokunulmaz kabul edilen acil durum tamponu — runway hesabından düşülür.">
                <div className="flex items-center gap-[var(--s3)]">
                    <div className="relative">
                        <input
                            type="number" min={0} step={0.5} value={settings.reserve_months}
                            onChange={e => setSettings(s => ({ ...s, reserve_months: Number(e.target.value) }))}
                            onBlur={() => persist(settings)}
                            className="tnum h-9 w-24 pr-10 text-right outline-none" style={inputStyle}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>ay</span>
                    </div>
                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>kadar gider rezervde tutulur</span>
                </div>
            </Card>

            {/* Uyarı eşikleri */}
            <Card title="Uyarı eşikleri" desc="Bu oranların üzerine çıkıldığında ilgili ekranlarda uyarı verilir.">
                <div className="space-y-[var(--s3)]">
                    <ThresholdRow label="Bütçe kullanımı" value={settings.alert_budget_pct} onChange={v => persist({ ...settings, alert_budget_pct: v })} inputStyle={inputStyle} />
                    <ThresholdRow label="Kart limit kullanımı" value={settings.alert_card_pct} onChange={v => persist({ ...settings, alert_card_pct: v })} inputStyle={inputStyle} />
                    <ThresholdRow label="Borç servis oranı" value={settings.alert_debt_service_pct} onChange={v => persist({ ...settings, alert_debt_service_pct: v })} inputStyle={inputStyle} />
                </div>
            </Card>

            {/* Negatif devir */}
            <Card title="Bütçe devri" desc="Ay içinde bütçe aşımının sonraki aya taşınıp taşınmayacağı.">
                <label className="flex cursor-pointer items-center justify-between">
                    <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Negatif devir açık (aşım sonraki aya taşınır)</span>
                    <button type="button" onClick={toggleNegativeCarry} className="relative h-5 w-10 shrink-0 rounded-full transition-colors" style={{ background: negativeCarry ? 'var(--accent)' : 'var(--ink-4)' }} aria-pressed={negativeCarry}>
                        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: negativeCarry ? 22 : 2 }} />
                    </button>
                </label>
            </Card>

            <div className="h-4" style={{ fontSize: 12, color: 'var(--flow-in)', opacity: savedFlash ? 1 : 0, transition: 'opacity 0.2s' }}>Kaydedildi</div>
        </div>
    )
}

function Card({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="space-y-[var(--s3)] p-[22px]">
            <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{desc}</div>
            </div>
            {children}
        </section>
    )
}

function ThresholdRow({ label, value, onChange, inputStyle }: { label: string; value: number; onChange: (v: number) => void; inputStyle: any }) {
    const [local, setLocal] = useState(value)
    useEffect(() => { setLocal(value) }, [value])
    return (
        <div className="flex items-center justify-between gap-[var(--s3)]">
            <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{label}</span>
            <div className="relative shrink-0">
                <input
                    type="number" min={0} max={100} value={local}
                    onChange={e => setLocal(Number(e.target.value))}
                    onBlur={() => onChange(Math.max(0, Math.min(100, local)))}
                    className="tnum h-9 w-24 pr-8 text-right outline-none" style={inputStyle}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2" style={{ fontSize: 13, color: 'var(--ink-3)' }}>%</span>
            </div>
        </div>
    )
}
