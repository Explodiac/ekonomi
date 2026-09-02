'use client'

import { useState } from "react"
import { supabase, ensureHouseholdExists, createNotification } from "@/lib/supabase"
import { parseQuickEntry } from "@/lib/nlp-parser"
import { suggestCategory } from "@/lib/auto-categorize"
import { calculateCashDate } from "@/lib/cash-date"
import { BudgetFeedback } from "./budget-feedback"
import { PrimaryButton } from "@/components/ui/primary-button"

/**
 * Hızlı ekleme — doğal dille işlem girişi. Dashboard ve Hareketler paylaşır.
 * Kaydettikten sonra, gider ise o kategoride fren + ayna geri bildirimi gösterir.
 */
export function QuickEntry({
    accounts,
    categories,
    transactions,
    currentMonthKey,
    onSuccess,
    budgetPeriods,
    negativeCarry,
    budgetInfoThreshold,
}: {
    accounts: any[]
    categories: any[]
    transactions: any[]
    currentMonthKey: string
    onSuccess: () => void
    budgetPeriods?: { categoryId: string; period: string; budgeted: number | string }[]
    negativeCarry?: boolean
    budgetInfoThreshold?: number
}) {
    const [value, setValue] = useState("")
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [feedbackCategoryId, setFeedbackCategoryId] = useState<string | null>(null)
    // Giriş anında doğa sorusu (2c-a): şüphede sor, cevabı kategoriye kalıcı yaz.
    const [natureAsk, setNatureAsk] = useState<{ txId: string; categoryId: string; noDefault: boolean } | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!value.trim()) return

        setIsSubmitting(true)
        let willAsk = false
        try {
            const parsed = parseQuickEntry(value)
            if (!parsed.amount) {
                alert("Tutar tespit edilemedi. Lütfen '120 TL' gibi bir tutar ekleyin.")
                return
            }

            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            const suggest = suggestCategory(parsed.description || "", categories)

            let targetAccountId: string | null = null
            if (parsed.accountHint) {
                const foundAcc = accounts.find(a =>
                    a.name?.toLowerCase().includes(parsed.accountHint!.toLowerCase()) ||
                    parsed.accountHint!.toLowerCase().includes(a.name?.toLowerCase())
                )
                if (foundAcc) targetAccountId = foundAcc.id
            }
            if (!targetAccountId) {
                const defaultAcc = accounts.find(a => ['bank', 'cash'].includes(a.type)) || accounts[0]
                targetAccountId = defaultAcc?.id ?? null
            }
            if (!targetAccountId) {
                alert("İşlemin kaydedileceği bir hesap bulunamadı. Lütfen önce bir hesap oluşturun.")
                return
            }

            const finalCategoryId = suggest || categories[0]?.id
            if (!finalCategoryId || !hhId) {
                alert("İşlemin kaydedileceği bir kategori veya aile bilgisi bulunamadı.")
                return
            }

            const targetAccount = accounts.find(a => a.id === targetAccountId)

            const { data: inserted, error } = await supabase.from('transactions').insert({
                household_id: hhId,
                amount: parsed.amount,
                description: parsed.description || "Hızlı Kayıt",
                transaction_date: (parsed.date || new Date()).toISOString(),
                cash_date: calculateCashDate(parsed.date || new Date(), targetAccount),
                type: parsed.type,
                category_id: finalCategoryId,
                account_id: targetAccountId,
                user_id: user.id,
            }).select('id').single()
            if (error) throw error

            // Doğa sorusu tetikleyicileri: kategorinin varsayılanı yok VEYA ilk harcama
            // VEYA tutar kategori ortalamasının 2 katından büyük. Aksi halde sorma.
            if (parsed.type === 'expense' && inserted?.id) {
                const cat = categories.find((c: any) => c.id === finalCategoryId)
                const noDefault = !cat?.default_nature
                const catTxs = transactions.filter((t: any) => t.category_id === finalCategoryId && t.type === 'expense' && !t.source_type)
                const firstSpend = catTxs.length === 0
                const avgTx = catTxs.length ? catTxs.reduce((s: number, t: any) => s + Math.abs(Number(t.amount)), 0) / catTxs.length : 0
                const abnormal = avgTx > 0 && parsed.amount! > avgTx * 2
                if (noDefault || firstSpend || abnormal) {
                    willAsk = true
                    setNatureAsk({ txId: inserted.id, categoryId: finalCategoryId, noDefault })
                }
            }

            if (targetAccount) {
                const newBalance = parsed.type === 'income'
                    ? Number(targetAccount.balance) + parsed.amount!
                    : Number(targetAccount.balance) - parsed.amount!
                await supabase.from('accounts').update({ balance: newBalance }).eq('id', targetAccountId)
            }

            const userName = user.email?.split('@')[0] || 'Kullanıcı'
            await createNotification(
                hhId,
                parsed.type === 'income' ? 'Yeni Gelir' : 'Yeni Harcama',
                `${userName}: "${parsed.description}" işlemi. Tutar: ₺${parsed.amount}`,
                parsed.type === 'income' ? 'success' : 'transaction'
            )

            setFeedbackCategoryId(parsed.type === 'expense' ? finalCategoryId : null)
            setValue("")
            // Doğa sorusu varsa refetch'i ERTELE — yeniden yükleme QuickEntry'yi
            // unmount edip soruyu kaybeder. Cevap/atla sonrası yenilenir.
            if (!willAsk) onSuccess()
        } catch (err: any) {
            alert("Hata: " + err.message)
        } finally {
            setIsSubmitting(false)
        }
    }

    const pickNature = async (nature: 'aliskanlik' | 'tek_seferlik') => {
        if (!natureAsk) return
        const { txId, categoryId, noDefault } = natureAsk
        setNatureAsk(null)
        try {
            const jobs = [supabase.from('transactions').update({ spend_nature: nature }).eq('id', txId)]
            // İlk cevap kategoriye varsayılan olur — bir daha sorulmaz.
            if (noDefault) jobs.push(supabase.from('categories').update({ default_nature: nature }).eq('id', categoryId))
            await Promise.all(jobs)
            onSuccess()
        } catch (e) { console.error('Doğa kaydedilemedi:', e) }
    }

    return (
        <div>
            <form onSubmit={handleSubmit} className="flex gap-[var(--s2)]">
                <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Dün markete 480 lira"
                    className="min-w-0 flex-1 px-[var(--s4)] py-[var(--s3)] outline-none"
                    style={{ background: 'var(--surface)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 14.5 }}
                />
                <PrimaryButton type="submit" disabled={isSubmitting || !value.trim()}>
                    {isSubmitting ? '…' : 'Ekle'}
                </PrimaryButton>
            </form>

            {/* Doğa sorusu — küçük, atlanabilir. Atlanırsa null kalır (alışkanlık sayılır). */}
            {natureAsk && (
                <div className="mt-[var(--s2)] flex flex-wrap items-center gap-[var(--s2)] rounded-[var(--r-button)] px-[var(--s3)] py-[var(--s2)]" style={{ background: 'var(--surface-2)' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Bu harcama düzenli mi, tek seferlik mi?</span>
                    <button onClick={() => pickNature('aliskanlik')} className="px-[var(--s3)] py-[4px]" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 'var(--r-pill)', fontSize: 11.5, fontWeight: 600 }}>Düzenli</button>
                    <button onClick={() => pickNature('tek_seferlik')} className="px-[var(--s3)] py-[4px]" style={{ background: 'var(--surface)', color: 'var(--ink-2)', borderRadius: 'var(--r-pill)', fontSize: 11.5 }}>Tek seferlik</button>
                    <button onClick={() => { setNatureAsk(null); onSuccess() }} className="px-[var(--s2)] py-[4px]" style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>Atla</button>
                </div>
            )}

            {feedbackCategoryId && (
                <BudgetFeedback
                    categoryId={feedbackCategoryId}
                    categories={categories}
                    transactions={transactions}
                    month={currentMonthKey}
                    budgetPeriods={budgetPeriods}
                    negativeCarry={negativeCarry}
                    budgetInfoThreshold={budgetInfoThreshold}
                />
            )}
        </div>
    )
}
