'use client'

import { useState, useEffect, useCallback } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2 } from "lucide-react"
import { CategoryTile, categoryInk } from "@/components/dashboard/category-tile"

function formatTL(n: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n)))} ₺`
}
function todayStr() { return new Date().toISOString().slice(0, 10) }
function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const TR_MON_LETTER = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A']

type Row = {
    id: string
    name: string
    monthlyAvg: number
    monthsSeen: number
    strip: { month: string; total: number }[] // son 6 ay, eskiden yeniye
    last3: number[] // [m-1, m-2, m-3]
}

/**
 * Geriye dönük toplu sınıflandırma. default_nature'ı olmayan gider kategorilerini,
 * en çok fark yaratan (aylık ortalama tutar) üstte olacak şekilde listeler. Her satır
 * 6 aylık mini şerit + son 3 ay rakamlarıyla deseni gösterir; kullanıcı tek tıkla
 * Alışkanlık / Tek seferlik / Karar veremiyorum (null kalsın) der. İşaretleme hem
 * default_nature'ı hem GEÇMİŞ hareketleri günceller. Sınıflanmamış engel değildir —
 * null her yerde "alışkanlık sayılır" varsayılanıyla çalışmaya devam eder.
 */
export function CategoryNatureClassifier({ onChanged }: { onChanged?: () => void }) {
    const [hhId, setHhId] = useState<string | null>(null)
    const [rows, setRows] = useState<Row[]>([])
    const [totalSum, setTotalSum] = useState(0)
    const [classifiedSum, setClassifiedSum] = useState(0)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const id = await ensureHouseholdExists(user.id)
            if (!id) return
            setHhId(id)
            const [catRes, txRes] = await Promise.all([
                supabase.from('categories').select('id, name, type, default_nature').eq('household_id', id),
                supabase.from('transactions').select('amount, type, cash_date, category_id, source_type').eq('household_id', id).eq('type', 'expense').is('source_type', null),
            ])
            const cm = todayStr().slice(0, 7)
            const months6 = [6, 5, 4, 3, 2, 1].map(i => shiftMonth(cm, -i)) // eskiden yeniye
            const in6 = new Set(months6)
            const perCat = new Map<string, Map<string, number>>()
            for (const t of txRes.data || []) {
                if (!t.category_id || !t.cash_date) continue
                const mk = t.cash_date.slice(0, 7)
                if (!in6.has(mk)) continue
                let m = perCat.get(t.category_id)
                if (!m) { m = new Map(); perCat.set(t.category_id, m) }
                m.set(mk, (m.get(mk) ?? 0) + Math.abs(Number(t.amount)))
            }
            const nameById = new Map((catRes.data || []).map((c: any) => [c.id, { name: c.name, type: c.type, def: c.default_nature }]))
            const out: Row[] = []
            for (const [catId, months] of perCat) {
                const meta = nameById.get(catId)
                if (!meta || meta.type !== 'expense' || meta.def) continue // yalnız sınıflanmamış gider
                const strip = months6.map(mk => ({ month: mk, total: Math.round(months.get(mk) ?? 0) }))
                const seenVals = strip.filter(s => s.total > 0)
                const monthlyAvg = seenVals.length ? Math.round(seenVals.reduce((s, v) => s + v.total, 0) / seenVals.length) : 0
                const last3 = [1, 2, 3].map(i => Math.round(months.get(shiftMonth(cm, -i)) ?? 0))
                if (monthlyAvg > 0) out.push({ id: catId, name: meta.name, monthlyAvg, monthsSeen: seenVals.length, strip, last3 })
            }
            out.sort((a, b) => b.monthlyAvg - a.monthlyAvg)
            setRows(out)
            setTotalSum(out.reduce((s, r) => s + r.monthlyAvg, 0))
            setClassifiedSum(0)
        } catch (e) {
            console.error('Sınıflandırıcı yüklenemedi:', e)
        } finally {
            setLoading(false)
        }
    }, [])
    useEffect(() => { load() }, [load])

    const mark = async (row: Row, nature: 'aliskanlik' | 'tek_seferlik') => {
        if (!hhId) return
        setRows(rs => rs.filter(r => r.id !== row.id))
        setClassifiedSum(s => s + row.monthlyAvg)
        try {
            await Promise.all([
                supabase.from('categories').update({ default_nature: nature }).eq('id', row.id),
                supabase.from('transactions').update({ spend_nature: nature })
                    .eq('household_id', hhId).eq('category_id', row.id).eq('type', 'expense').is('source_type', null),
            ])
            onChanged?.()
        } catch (e) { console.error('İşaretlenemedi:', e) }
    }
    const skip = (row: Row) => setRows(rs => rs.filter(r => r.id !== row.id)) // null kalsın

    if (loading) return <div className="flex items-center justify-center py-[var(--s6)]"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
    if (rows.length === 0 && classifiedSum === 0) {
        return <p style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>Sınıflanmamış kategori yok — hepsi tanımlı.</p>
    }

    const remaining = Math.max(0, totalSum - classifiedSum)
    const pct = totalSum > 0 ? (classifiedSum / totalSum) * 100 : 100

    return (
        <div className="space-y-[var(--s4)]">
            {/* İlerleme */}
            <div>
                <div className="tnum mb-[var(--s2)]" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                    Aylık {formatTL(totalSum)} belirsizlikten <b style={{ color: 'var(--ink)' }}>{formatTL(classifiedSum)}</b> sınıflandı · {formatTL(remaining)} kaldı
                </div>
                <div className="h-[6px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                    <div className="h-full" style={{ width: `${pct}%`, background: 'var(--accent)', borderRadius: 'var(--r-bar)' }} />
                </div>
            </div>

            {rows.length === 0 ? (
                <p style={{ fontSize: 13.5, color: 'var(--flow-in)' }}>Bu tur bitti. Kalanları istediğinde sınıflayabilirsin.</p>
            ) : (
                <div className="flex flex-col gap-[var(--s2)]">
                    {rows.map(row => {
                        const max = Math.max(1, ...row.strip.map(s => s.total))
                        return (
                            <div key={row.id} className="rounded-[var(--r-card)] p-[var(--s3)]" style={{ background: 'var(--surface-2)' }}>
                                <div className="flex items-center gap-[var(--s3)]">
                                    <CategoryTile name={row.name} size={30} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate" style={{ fontSize: 14, color: 'var(--ink)' }}>{row.name}</div>
                                        <div className="tnum" style={{ fontSize: 12, color: 'var(--ink-3)' }}>aylık ~{formatTL(row.monthlyAvg)} · 6 ayda {row.monthsSeen} ay görüldü</div>
                                    </div>
                                    {/* 6 ay mini şerit — desen */}
                                    <div className="flex h-[26px] shrink-0 items-end gap-[2px]" style={{ width: 72 }} title={row.strip.map(s => `${s.month}: ${formatTL(s.total)}`).join(' · ')}>
                                        {row.strip.map((s, i) => (
                                            s.total > 0
                                                ? <span key={i} className="flex-1 rounded-t-[1px]" style={{ height: `${Math.max(10, (s.total / max) * 100)}%`, background: categoryInk(row.name) }} />
                                                : <span key={i} className="flex-1" style={{ height: 2, background: 'var(--border)', borderRadius: 1 }} />
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-[var(--s2)] flex items-center justify-between gap-[var(--s2)]">
                                    <span className="tnum" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>son 3 ay: {row.last3.map(v => formatTL(v)).join(' · ')}</span>
                                    <div className="flex shrink-0 gap-[var(--s1)]">
                                        <button onClick={() => mark(row, 'aliskanlik')} className="px-[var(--s3)] py-[5px]" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 'var(--r-pill)', fontSize: 11.5, fontWeight: 600 }}>Alışkanlık</button>
                                        <button onClick={() => mark(row, 'tek_seferlik')} className="px-[var(--s3)] py-[5px]" style={{ background: 'var(--surface)', color: 'var(--ink-2)', borderRadius: 'var(--r-pill)', fontSize: 11.5 }}>Tek seferlik</button>
                                        <button onClick={() => skip(row)} className="px-[var(--s3)] py-[5px]" style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>Karar veremiyorum</button>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
