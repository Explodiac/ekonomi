"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Loader2, Landmark } from "lucide-react"
import { calculateCashDate } from "@/lib/cash-date"

type Account = {
    id: string
    name: string
    type: string
    cut_date?: number | null
    due_date?: number | null
}

type Props = {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
}

export function LoanModal({ isOpen, onClose, onSuccess }: Props) {
    const [description, setDescription] = useState("")
    const [monthlyAmount, setMonthlyAmount] = useState("")
    const [count, setCount] = useState("12")
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
    const [sourceAccountId, setSourceAccountId] = useState("")

    const [accounts, setAccounts] = useState<Account[]>([])
    const [householdId, setHouseholdId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        if (!isOpen) return
        const load = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return
            setHouseholdId(hhId)

            const { data } = await supabase
                .from('accounts')
                .select('id, name, type, cut_date, due_date')
                .eq('household_id', hhId)
                .in('type', ['bank', 'cash', 'esnek_hesap'])

            setAccounts(data || [])
            if (data?.length && !sourceAccountId) setSourceAccountId(data[0].id)
        }
        load()
    }, [isOpen])

    const monthly = parseFloat(monthlyAmount) || 0
    const numCount = parseInt(count) || 0
    const total = monthly * numCount

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!householdId || !sourceAccountId || monthly <= 0 || numCount <= 0) return

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı")

            const account = accounts.find(a => a.id === sourceAccountId)

            // 1) Kredi kaydı. Kart taksidiyle aynı tablo, sadece kind farklı.
            const { data: loan, error: loanError } = await supabase
                .from('installments')
                .insert({
                    household_id: householdId,
                    account_id: sourceAccountId,
                    source_account_id: sourceAccountId,
                    kind: 'kredi',
                    description,
                    total_amount: total,
                    installments_count: numCount,
                    start_date: startDate,
                })
                .select()
                .single()
            if (loanError) throw loanError

            // 2) Her taksit için gelecek tarihli gerçek hareket satırı.
            //    Kart taksitleriyle aynı desen: upcoming/projection bunları üretmez, okur.
            const rows = Array.from({ length: numCount }, (_, i) => {
                const d = new Date(startDate)
                d.setMonth(d.getMonth() + i)
                return {
                    household_id: householdId,
                    account_id: sourceAccountId,
                    user_id: user.id,
                    amount: monthly,
                    type: 'expense',
                    transaction_date: d.toISOString(),
                    // Banka hesabında nakit çıkışı harcama günüyle aynı gündür.
                    cash_date: calculateCashDate(d, account),
                    description: `${description} (${i + 1}/${numCount})`,
                }
            })

            const { data: txs, error: txError } = await supabase
                .from('transactions')
                .insert(rows)
                .select()
            if (txError) throw txError

            // 3) Taksit planı, hareketlere bağlı olarak.
            const payments = (txs || []).map((tx, i) => ({
                installment_id: loan.id,
                amount: monthly,
                installment_number: i + 1,
                payment_date: tx.cash_date,
                status: 'pending',
                transaction_id: tx.id,
            }))

            const { data: inserted, error: pError } = await supabase
                .from('installment_payments')
                .insert(payments)
                .select()
            if (pError) throw pError

            // 4) Çift sayım koruması: hareketleri kaynağına bağla.
            if (inserted) {
                await Promise.all(inserted.map(p =>
                    supabase.from('transactions')
                        .update({ source_type: 'installment', source_id: p.id })
                        .eq('id', p.transaction_id)
                ))
            }

            setDescription("")
            setMonthlyAmount("")
            onSuccess()
            onClose()
        } catch (error: any) {
            alert("Kredi kaydedilemedi: " + error.message)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    const formatCurrency = (n: number) =>
        new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n)

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card w-full max-w-md rounded-xl shadow-2xl border overflow-hidden">
                <div className="flex justify-between items-center p-6 border-b">
                    <div className="flex items-center gap-2">
                        <Landmark className="w-5 h-5 text-primary" />
                        <h2 className="text-lg font-bold">Banka Kredisi Ekle</h2>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Açıklama</label>
                        <Input
                            required
                            placeholder="Örn: Taşıt Kredisi"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Aylık Ödeme (₺)</label>
                            <Input
                                required type="number" step="0.01" min="0"
                                value={monthlyAmount}
                                onChange={(e) => setMonthlyAmount(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Taksit Adedi</label>
                            <Input
                                required type="number" min="1"
                                value={count}
                                onChange={(e) => setCount(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">İlk Ödeme Tarihi</label>
                        <Input
                            required type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Ödemenin Çıkacağı Hesap</label>
                        <select
                            required
                            className="w-full h-10 px-3 rounded-md border bg-background text-sm"
                            value={sourceAccountId}
                            onChange={(e) => setSourceAccountId(e.target.value)}
                        >
                            {accounts.length === 0 && <option value="">Önce bir banka hesabı ekleyin</option>}
                            {accounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                    </div>

                    {total > 0 && (
                        <div className="rounded-lg bg-muted/50 p-3 text-sm">
                            Toplam geri ödeme: <span className="font-bold tabular-nums">{formatCurrency(total)}</span>
                            <span className="text-muted-foreground"> ({numCount} × {formatCurrency(monthly)})</span>
                        </div>
                    )}

                    <Button type="submit" className="w-full" disabled={isLoading || accounts.length === 0}>
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Krediyi Kaydet"}
                    </Button>
                </form>
            </div>
        </div>
    )
}
