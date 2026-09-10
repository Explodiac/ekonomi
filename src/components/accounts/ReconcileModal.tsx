"use client"

import { useState, useEffect, useMemo } from "react"
import { supabase, ensureHouseholdExists, createNotification } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Loader2 } from "lucide-react"
import { resolveCashDate } from "@/lib/cash-date"

/**
 * Bakiye eşitleme — opening_balance'a ASLA dokunmaz; yalnız FARK için bir
 * gider/gelir hareketi üretir. Böylece unutulan küçük kesintiler (EFT ücreti,
 * hesap işletim ücreti, kart aidatı) kayıt altına alınır ve bakiye tutar.
 *
 * Yön: banka < uygulama → gider (para eksilmiş), banka > uygulama → gelir.
 */
export function ReconcileModal({
    isOpen, onClose, onSuccess, account, currentBalance,
}: {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    account: { id: string; name: string; type?: string | null; cut_date?: number | null; due_date?: number | null } | null
    /** Uygulamadaki türetilmiş güncel bakiye. */
    currentBalance: number
}) {
    const [bankBalance, setBankBalance] = useState("")
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [description, setDescription] = useState("")
    const [categoryId, setCategoryId] = useState("")
    const [categories, setCategories] = useState<{ id: string; name: string; type: string }[]>([])
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        if (!isOpen) return
        setBankBalance("")
        setDate(new Date().toISOString().split('T')[0])
        setDescription("")
        setCategoryId("")
        ;(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return
            const { data } = await supabase.from('categories').select('id, name, type').eq('household_id', hhId)
            setCategories(data || [])
        })()
    }, [isOpen])

    const diff = useMemo(() => {
        if (bankBalance.trim() === "") return null
        const bank = parseFloat(bankBalance)
        if (!Number.isFinite(bank)) return null
        return Math.round((bank - currentBalance) * 100) / 100 // + : bankada fazla (gelir), − : eksik (gider)
    }, [bankBalance, currentBalance])

    const isIncome = (diff ?? 0) > 0
    // Yöne uygun kategoriler; varsayılan masraf/ücret benzeri bir ad.
    const relevantCats = useMemo(
        () => categories.filter(c => c.type === (isIncome ? 'income' : 'expense')),
        [categories, isIncome]
    )
    useEffect(() => {
        if (diff == null || diff === 0) return
        const suggested = relevantCats.find(c => /masraf|banka|ücret|ucret|faiz/i.test(c.name))
        setCategoryId(prev => prev && relevantCats.some(c => c.id === prev) ? prev : (suggested?.id ?? relevantCats[0]?.id ?? ""))
    }, [diff, relevantCats])

    const fmt = (n: number) => `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(n))} ₺`

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!account || diff == null || diff === 0) return
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı")
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) throw new Error("Aile bulunamadı")

            const amount = Math.abs(diff)
            const type = isIncome ? 'income' : 'expense'
            const { error } = await supabase.from('transactions').insert({
                household_id: hhId,
                account_id: account.id,
                category_id: categoryId || null,
                user_id: user.id,
                amount,
                type,
                transaction_date: new Date(date).toISOString(),
                cash_date: resolveCashDate({ transactionDate: date, targetAccount: account }),
                description: description || 'Bakiye eşitleme',
            })
            if (error) throw error

            await createNotification(
                hhId, 'Bakiye eşitlendi',
                `${account.name}: ${fmt(amount)} ${isIncome ? 'gelir' : 'gider'} kaydedildi (fark).`, 'info'
            )
            onSuccess()
            onClose()
        } catch (err: any) {
            alert("Hata: " + err.message)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen || !account) return null

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-border/50 flex flex-col max-h-[85vh]">
                <div className="flex justify-between items-center p-6 border-b shrink-0">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight">Bakiye eşitle</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">{account.name}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors"><X className="w-5 h-5" /></button>
                </div>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
                        <div className="rounded-xl bg-muted/30 border border-border/50 p-4 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">Uygulamada</span><span className="font-semibold tabular-nums">{fmt(currentBalance)}</span></div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold ml-1">Bankadaki gerçek bakiye (₺)</label>
                            <Input type="number" step="any" required autoFocus placeholder="örn. 4850"
                                value={bankBalance} onChange={(e) => setBankBalance(e.target.value)}
                                className="h-11 rounded-xl bg-muted/20 border-border/50" />
                        </div>

                        {diff != null && (
                            diff === 0 ? (
                                <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium ml-1">Bakiye zaten tutuyor — düzeltme gerekmiyor.</p>
                            ) : (
                                <>
                                    <div className="rounded-xl border border-border/50 p-4 text-sm space-y-1">
                                        <div className="flex justify-between"><span className="text-muted-foreground">Bankada</span><span className="tabular-nums">{fmt(parseFloat(bankBalance))}</span></div>
                                        <div className="flex justify-between border-t border-border/40 pt-1 mt-1">
                                            <span className="text-muted-foreground">Fark</span>
                                            <span className={`font-bold tabular-nums ${isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                                                {isIncome ? '+' : '−'}{fmt(Math.abs(diff))} · {isIncome ? 'gelir' : 'gider'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-semibold ml-1">Tarih</label>
                                            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)}
                                                className="h-11 rounded-xl bg-muted/20 border-border/50" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-semibold ml-1">Kategori</label>
                                            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                                                className="flex h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 text-sm">
                                                <option value="">Kategori...</option>
                                                {relevantCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold ml-1">Açıklama</label>
                                        <Input type="text" placeholder={isIncome ? "örn. Faiz geliri" : "örn. Hesap işletim ücreti"}
                                            value={description} onChange={(e) => setDescription(e.target.value)}
                                            className="h-11 rounded-xl bg-muted/20 border-border/50" />
                                    </div>
                                    <p className="text-xs text-muted-foreground ml-1">Açılış bakiyesine dokunulmaz; yalnız bu fark bir hareket olarak kaydedilir.</p>
                                </>
                            )
                        )}
                    </div>

                    <div className="shrink-0 flex justify-end gap-3 border-t p-6">
                        <Button type="button" variant="ghost" onClick={onClose} className="h-11 px-6 rounded-xl">İptal</Button>
                        <Button type="submit" disabled={isLoading || diff == null || diff === 0}
                            className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 font-bold">
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Farkı kaydet'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
