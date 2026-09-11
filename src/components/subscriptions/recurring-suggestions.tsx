'use client'

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import {
    detectRecurring, candidateFingerprint,
    type RecurringCandidate, type RecurringTransaction,
} from "@/lib/recurring-detect"
import { PrimaryButton } from "@/components/ui/primary-button"

/**
 * Sessiz abonelik önerisi. detectRecurring ile bulunan adayları gösterir; onay
 * abonelik açar (geçmiş hareketler BAĞLANMAZ — çift sayma olmasın), ret adayı
 * kalıcı susturur. Öneri yoksa hiç render etmez.
 */
function formatTL(n: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(n))} ₺`
}
function todayStr() { return new Date().toISOString().slice(0, 10) }

/** Yeni abonelik yalnız bugünden ileriye çalışır: sıradaki ödeme tarihi. */
function nextPaymentDate(c: RecurringCandidate): string {
    const now = Date.now()
    if (c.cadence === 'yillik') {
        const [y, m, d] = c.lastSeen.split('-').map(Number)
        let dt = new Date(Date.UTC(y, m - 1, d))
        while (dt.getTime() <= now) dt = new Date(Date.UTC(dt.getUTCFullYear() + 1, dt.getUTCMonth(), dt.getUTCDate()))
        return dt.toISOString().slice(0, 10)
    }
    const today = new Date()
    const y = today.getUTCFullYear(), m = today.getUTCMonth()
    let dt = new Date(Date.UTC(y, m, c.dayOfMonth))
    if (dt.getTime() <= now) dt = new Date(Date.UTC(y, m + 1, c.dayOfMonth))
    return dt.toISOString().slice(0, 10)
}

export function RecurringSuggestions({ onAdded }: { onAdded?: () => void }) {
    const [candidates, setCandidates] = useState<RecurringCandidate[]>([])
    const [hhId, setHhId] = useState<string | null>(null)
    const [busy, setBusy] = useState<string | null>(null)

    useEffect(() => {
        const load = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return
                const id = await ensureHouseholdExists(user.id)
                if (!id) return
                setHhId(id)

                const [txRes, subRes, disRes] = await Promise.all([
                    supabase.from('transactions')
                        .select('id, amount, type, transaction_date, cash_date, description, category_id, source_type, transfer_direction, categories(name)')
                        .eq('household_id', id).is('source_type', null),
                    supabase.from('subscriptions').select('name').eq('household_id', id),
                    supabase.from('dismissed_recurring').select('fingerprint').eq('household_id', id),
                ])

                const txs: RecurringTransaction[] = (txRes.data || []).map((t: any) => ({
                    ...t, categoryName: t.categories?.name ?? null,
                }))
                const dismissed = new Set((disRes.data || []).map((d: any) => d.fingerprint))
                const subNames = new Set((subRes.data || []).map((s: any) => (s.name || '').trim().toLowerCase()))

                setCandidates(
                    detectRecurring(txs, todayStr())
                        // Reddedilenler ve zaten abonelik olanlar önerilmez.
                        .filter(c => !dismissed.has(candidateFingerprint(c)))
                        .filter(c => !subNames.has(c.label.trim().toLowerCase()))
                )
            } catch (error) {
                console.error("Öneri taraması başarısız:", error)
            }
        }
        load()
    }, [])

    const remove = (c: RecurringCandidate) =>
        setCandidates(prev => prev.filter(x => candidateFingerprint(x) !== candidateFingerprint(c)))

    const approve = async (c: RecurringCandidate) => {
        if (!hhId) return
        setBusy(candidateFingerprint(c))
        try {
            const { error } = await supabase.from('subscriptions').insert({
                household_id: hhId,
                name: c.label,
                amount: c.avgAmount,
                category_id: c.categoryId,
                frequency: c.cadence === 'yillik' ? 'yearly' : 'monthly',
                next_payment_date: nextPaymentDate(c),
                status: 'active',
                // source_type backfill YOK: geçmiş hareketler olduğu yerde kalır.
            })
            if (error) throw error
            remove(c)
            onAdded?.()
        } catch (error: any) {
            alert("Abonelik eklenemedi: " + error.message)
        } finally { setBusy(null) }
    }

    const dismiss = async (c: RecurringCandidate) => {
        if (!hhId) return
        setBusy(candidateFingerprint(c))
        try {
            const { error } = await supabase.from('dismissed_recurring')
                .insert({ household_id: hhId, fingerprint: candidateFingerprint(c) })
            if (error) throw error
            remove(c)
        } catch (error: any) {
            alert("İşlenemedi: " + error.message)
        } finally { setBusy(null) }
    }

    if (candidates.length === 0) return null

    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Öneriler</div>
            <p className="mt-[var(--s1)]" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                Düzenli görünen harcamalar. Onaylarsan abonelik olur; geçmiş hareketlere dokunulmaz.
            </p>
            <ul className="mt-[var(--s4)] flex flex-col">
                {candidates.map((c, i) => {
                    const b = busy === candidateFingerprint(c)
                    const cad = c.cadence === 'yillik' ? 'her yıl' : 'her ay'
                    return (
                        <li
                            key={candidateFingerprint(c)}
                            className="flex items-center gap-[var(--s3)] py-[var(--s3)]"
                            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
                        >
                            <div className="min-w-0 flex-1">
                                <p style={{ fontSize: 14.5, color: 'var(--ink)' }}>
                                    <span style={{ fontWeight: 600 }}>{c.label}</span> {cad}{' '}
                                    <span className="tnum">~{formatTL(c.avgAmount)}</span> görünüyor.
                                </p>
                                <p className="mt-[2px]" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                                    {c.occurrenceCount} kez tekrarladı · abonelik olarak ekleyeyim mi?
                                </p>
                            </div>
                            <button
                                onClick={() => dismiss(c)}
                                disabled={b}
                                className="shrink-0 px-[var(--s3)] py-[var(--s2)] disabled:opacity-40"
                                style={{ fontSize: 13.5, color: 'var(--ink-3)' }}
                            >
                                Yoksay
                            </button>
                            <PrimaryButton onClick={() => approve(c)} disabled={b} className="shrink-0">
                                {b ? '…' : 'Ekle'}
                            </PrimaryButton>
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}
