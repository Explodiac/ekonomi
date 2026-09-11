"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Loader2 } from "lucide-react"
import { calculateCashDate } from "@/lib/cash-date"

/**
 * Kart öde — borç ödemesi bir TRANSFER'dir: kaynak hesaptan çıkar (out), karta
 * girer (in), aynı gün (transfer bacağına kart kesim/ödeme mantığı uygulanmaz).
 * accounts.balance yazılmaz; bakiye hareketlerden türetilir. Kart borcunu azaltır.
 */
export function CardPaymentModal({
    isOpen, onClose, onSuccess, card, currentDebt,
}: {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    card: { id: string; name: string } | null
    /** Kartın güncel borcu (pozitif) — varsayılan ödeme tutarı. */
    currentDebt: number
}) {
    const [amount, setAmount] = useState("")
    const [sourceAccountId, setSourceAccountId] = useState("")
    const [accounts, setAccounts] = useState<{ id: string; name: string; type: string }[]>([])
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        if (!isOpen) return
        setAmount(currentDebt > 0 ? String(Math.round(currentDebt)) : "")
        setSourceAccountId("")
        ;(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return
            // Ödeme kaynağı: banka/nakit/esnek (kart/yatırım hariç).
            const { data } = await supabase.from('accounts')
                .select('id, name, type').eq('household_id', hhId)
                .in('type', ['bank', 'cash', 'esnek_hesap'])
            const list = data || []
            setAccounts(list)
            setSourceAccountId(list[0]?.id || "")
        })()
    }, [isOpen, currentDebt])

    const fmt = (n: number) => `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(n))} ₺`

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!card || !sourceAccountId || !amount) return
        const amt = parseFloat(amount)
        if (!Number.isFinite(amt) || amt <= 0) return
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı")
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) throw new Error("Aile bulunamadı")

            const { data: cats } = await supabase.from('categories')
                .select('id, name').eq('household_id', hhId)
            const payCat = (cats || []).find((c: any) => c.name === 'Kredi Kartı Ödemesi' || c.name === 'Borç Ödemesi')

            const groupId = crypto.randomUUID()
            const sourceAcc = accounts.find(a => a.id === sourceAccountId)
            const common = {
                household_id: hhId, user_id: user.id, amount: amt, type: 'transfer',
                category_id: payCat?.id || null,
                transaction_date: new Date().toISOString(),
                description: `${card.name} Kart Ödemesi`,
                transfer_group_id: groupId,
            }
            const { error } = await supabase.from('transactions').insert([
                { ...common, account_id: sourceAccountId, cash_date: calculateCashDate(new Date(), sourceAcc), transfer_direction: 'out' },
                { ...common, account_id: card.id, cash_date: calculateCashDate(new Date(), null), transfer_direction: 'in' },
            ])
            if (error) throw error
            // accounts.balance yazılmaz — iki bacak türetilmiş bakiyeye yansır.
            onSuccess()
            onClose()
        } catch (err: any) {
            alert("Hata: " + err.message)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen || !card) return null

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden border border-border/50">
                <div className="flex justify-between items-center p-6 border-b">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight">Kart öde</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">{card.name} · borç {fmt(currentDebt)}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors"><X className="w-5 h-5" /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold ml-1">Tutar (₺)</label>
                        <Input type="number" step="any" required autoFocus value={amount}
                            onChange={(e) => setAmount(e.target.value)} className="h-11 rounded-xl bg-muted/20 border-border/50" />
                        {currentDebt > 0 && (
                            <button type="button" onClick={() => setAmount(String(Math.round(currentDebt)))}
                                className="ml-1 text-xs" style={{ color: 'var(--accent)' }}>Tümünü öde ({fmt(currentDebt)})</button>
                        )}
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-semibold ml-1">Ödemenin çıkacağı hesap</label>
                        <select value={sourceAccountId} onChange={(e) => setSourceAccountId(e.target.value)}
                            className="flex h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 text-sm">
                            <option value="">Hesap seçin</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </div>
                    <p className="text-xs text-muted-foreground ml-1">Ödeme bir transfer olarak kaydedilir; kart borcunu azaltır, kaynak hesaptan çıkar.</p>

                    <div className="pt-2 flex justify-end gap-3">
                        <Button type="button" variant="ghost" onClick={onClose} className="h-11 px-6 rounded-xl">İptal</Button>
                        <Button type="submit" disabled={isLoading || !sourceAccountId} className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 font-bold">
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ödemeyi kaydet'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
