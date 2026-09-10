"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Loader2 } from "lucide-react"
import { derivedBalance } from "@/lib/balance"
import { recomputeCardCashDates } from "@/lib/cash-date"

type Account = {
    id: string;
    name: string;
    type: string;
    balance: number;
    currency: string;
    credit_limit?: number;
    cut_date?: number;
    due_date?: number;
    interest_rate?: number | null;
}

type ModalProps = {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    account?: Account | null // Added for edit mode
}

export function AccountModal({ isOpen, onClose, onSuccess, account }: ModalProps) {
    const [name, setName] = useState("")
    const [type, setType] = useState("Vadesiz")
    const [balance, setBalance] = useState("")
    const [currency, setCurrency] = useState("TRY")
    const [creditLimit, setCreditLimit] = useState("")
    const [cutDate, setCutDate] = useState("")
    const [dueDate, setDueDate] = useState("")
    const [interestRate, setInterestRate] = useState("")
    // Kullanıcı aylık ya da yıllık girebilir; DB'de daima YILLIK saklanır. Dönüşüm
    // basit bölme/çarpma (×12 / ÷12) — bileşik değil; Türkiye'de kart faizi aylık
    // ilan edilir, aylık girildiğinde birebir geri döner. Varsayılan: aylık.
    const [interestUnit, setInterestUnit] = useState<'monthly' | 'annual'>('monthly')

    const [isLoading, setIsLoading] = useState(false)
    const [householdId, setHouseholdId] = useState<string | null>(null)

    useEffect(() => {
        if (isOpen) {
            fetchHouseholdId()
            if (account) {
                setName(account.name)
                // Reverse map type
                const revMap: Record<string, string> = {
                    "bank": "Vadesiz",
                    "cash": "Nakit",
                    "credit_card": "Kredi Kartı",
                    "esnek_hesap": "Esnek Hesap",
                    "investment": "Yatırım"
                }
                setType(revMap[account.type] || "Vadesiz")
                setCurrency(account.currency)
                setCreditLimit(account.credit_limit?.toString() || "")
                setCutDate(account.cut_date?.toString() || "")
                setDueDate(account.due_date?.toString() || "")
                // Saklanan yıllık; aylık gösterip düzenlemesi için ÷12 (basit).
                setInterestUnit('monthly')
                setInterestRate(account.interest_rate != null ? String(Math.round((account.interest_rate / 12) * 100) / 100) : "")

                if (account.type === 'credit_card') {
                    // Show Available Limit to user: Available = Limit + Balance
                    const available = (account.credit_limit || 0) + (account.balance || 0);
                    setBalance(available.toString());
                } else {
                    setBalance(account.balance.toString())
                }
            } else {
                setName("")
                setType("Vadesiz")
                setBalance("")
                setCurrency("TRY")
                setCreditLimit("")
                setCutDate("")
                setDueDate("")
                setInterestRate("")
                setInterestUnit('monthly')
            }
        }
    }, [isOpen, account])

    const fetchHouseholdId = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (hhId) {
                setHouseholdId(hhId)
            }
        } catch (error) {
            console.error(error)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name || (!balance && balance !== "0") || !householdId) return

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı.")

            const typeMap: Record<string, string> = {
                "Vadesiz": "bank",
                "Nakit": "cash",
                "Kredi Kartı": "credit_card",
                "Esnek Hesap": "esnek_hesap",
                "Yatırım": "investment"
            }
            const dbType = typeMap[type] || "bank"
            const rawBalance = parseFloat(balance) || 0
            const rawLimit = parseFloat(creditLimit) || 0
            // Kart/KMH: faiz oranı opsiyonel. Girilen aylıksa ×12 ile YILLIĞA çevrilip saklanır (basit).
            const isDebtType = dbType === 'credit_card' || dbType === 'esnek_hesap'
            const enteredRate = parseFloat(interestRate) || 0
            const annualRate = interestUnit === 'monthly' ? enteredRate * 12 : enteredRate
            const numInterestRate = isDebtType && interestRate.trim() !== '' ? annualRate : null

            // For CC, we store Net Balance = Available - Limit. KMH ham bakiye kullanır.
            const numBalance = dbType === 'credit_card' ? (rawBalance - rawLimit) : rawBalance

            if (account) {
                // UPDATE
                // Ekranda gösterilen bakiye hareketlerden türetiliyor. Kullanıcı buraya
                // "güncel bakiye" yazdığında o rakamın görünmesi için açılış bakiyesini
                // geri hesaplıyoruz: açılış = girilen − bugüne kadarki hareketlerin etkisi.
                const { data: accTx } = await supabase
                    .from('transactions')
                    .select('amount, type, transaction_date, cash_date, transfer_direction')
                    .eq('account_id', account.id)

                const netSoFar = derivedBalance(0, accTx || [])
                const newOpening = numBalance - netSoFar

                const { error } = await supabase
                    .from('accounts')
                    .update({
                        name,
                        type: dbType,
                        balance: numBalance,
                        opening_balance: newOpening,
                        currency,
                        credit_limit: isDebtType ? parseFloat(creditLimit) || 0 : 0,
                        cut_date: dbType === 'credit_card' ? parseInt(cutDate) || null : null,
                        due_date: dbType === 'credit_card' ? parseInt(dueDate) || null : null,
                        interest_rate: numInterestRate
                    })
                    .eq('id', account.id)
                if (error) throw error

                // Madde 8d: kesim/son-ödeme günü değiştiyse, bu karta ait GELECEK
                // harcamaların cash_date'ini yeni kurala göre yeniden hesapla.
                const newCut = dbType === 'credit_card' ? parseInt(cutDate) || null : null
                const newDue = dbType === 'credit_card' ? parseInt(dueDate) || null : null
                const cutChanged = (account.cut_date ?? null) !== newCut
                const dueChanged = (account.due_date ?? null) !== newDue
                if (dbType === 'credit_card' && newCut && newDue && (cutChanged || dueChanged)) {
                    const { data: cardTx } = await supabase
                        .from('transactions')
                        .select('id, transaction_date, cash_date, type, transfer_direction')
                        .eq('account_id', account.id)
                    const updates = recomputeCardCashDates(
                        (cardTx || []).map((t: any) => ({ ...t, transaction_date: (t.transaction_date || '').slice(0, 10) })),
                        { type: 'credit_card', cut_date: newCut, due_date: newDue },
                    )
                    if (updates.length) {
                        await Promise.all(updates.map(u =>
                            supabase.from('transactions').update({ cash_date: u.cash_date }).eq('id', u.id)))
                    }
                }
            } else {
                // INSERT
                const { data: newAcc, error } = await supabase
                    .from('accounts')
                    .insert([{
                        household_id: householdId,
                        name,
                        type: dbType,
                        balance: numBalance,
                        // Açılış bakiyesi artık kendi kolonunda tutuluyor. Eskiden bunun
                        // yerine sahte bir 'transfer' hareketi yazılıyordu; türetilmiş
                        // bakiye o satırı çıkış sayıp bakiyeyi ters işaretli gösteriyordu.
                        opening_balance: numBalance,
                        currency,
                        credit_limit: isDebtType ? parseFloat(creditLimit) || 0 : 0,
                        cut_date: dbType === 'credit_card' ? parseInt(cutDate) || null : null,
                        due_date: dbType === 'credit_card' ? parseInt(dueDate) || null : null,
                        interest_rate: numInterestRate
                    }])
                    .select()
                    .single()

                if (error) throw error
            }

            onSuccess()
            onClose()
        } catch (error: any) {
            alert("İşlem Başarısız: " + error.message)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-border/50 animate-in zoom-in-95 duration-300">
                <div className="flex justify-between items-center p-6 border-b bg-muted/30">
                    <h2 className="text-xl font-bold tracking-tight">{account ? 'Hesabı Düzenle' : 'Yeni Kasa / Hesap Ekle'}</h2>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold ml-1">{type === 'Kredi Kartı' ? 'Kart Adı' : 'Hesap Adı'}</label>
                        <Input
                            type="text"
                            required
                            placeholder="Örn: Garanti Maaş veya Evdeki Nakit"
                            value={name}
                            className="h-11 rounded-xl bg-muted/20 border-border/50 focus:ring-primary/20"
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-semibold ml-1">Hesap Tipi</label>
                        <select
                            className="flex h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                        >
                            <option value="Vadesiz">Vadesiz Banka Hesabı</option>
                            <option value="Nakit">Cüzdan / Nakit Para</option>
                            <option value="Kredi Kartı">Kredi Kartı</option>
                            <option value="Esnek Hesap">Esnek Hesap (KMH)</option>
                            <option value="Yatırım">Yatırım Hesabı</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold ml-1 flex items-center gap-1">
                                {type === 'Kredi Kartı' ? 'Kullanılabilir Limit' : (account ? 'Güncel Bakiye' : 'Başlangıç Bakiyesi')}
                            </label>
                            <Input
                                type="number"
                                step="any"
                                required
                                placeholder={type === 'Kredi Kartı' ? "-1500" : "5000"}
                                value={balance}
                                className="h-11 rounded-xl bg-muted/20 border-border/50 focus:ring-primary/20"
                                onChange={(e) => setBalance(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-semibold ml-1">Para Birimi</label>
                            <select
                                className="flex h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
                            >
                                <option value="TRY">TRY (₺)</option>
                                <option value="USD">USD ($)</option>
                                <option value="EUR">EUR (€)</option>
                                <option value="XAU">Altın (gr)</option>
                            </select>
                        </div>
                    </div>

                    {(type === "Kredi Kartı" || type === "Esnek Hesap") && (
                        <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-semibold ml-1 text-primary">Limit (₺)</label>
                                    <Input
                                        type="number"
                                        required
                                        placeholder="50000"
                                        value={creditLimit}
                                        className="h-11 rounded-xl bg-muted/20 border-border/50 focus:ring-primary/20"
                                        onChange={(e) => setCreditLimit(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-semibold ml-1 text-primary">Faiz (%)</label>
                                    <div className="flex gap-2">
                                        <Input
                                            type="number"
                                            step="0.01"
                                            placeholder={interestUnit === 'monthly' ? "4.25" : "51"}
                                            value={interestRate}
                                            className="h-11 rounded-xl bg-muted/20 border-border/50 focus:ring-primary/20"
                                            onChange={(e) => setInterestRate(e.target.value)}
                                        />
                                        <select
                                            value={interestUnit}
                                            onChange={(e) => setInterestUnit(e.target.value as 'monthly' | 'annual')}
                                            className="h-11 rounded-xl border border-border/50 bg-muted/20 px-2 text-sm focus:outline-none"
                                            title="Aylık mı yıllık mı girdiğin"
                                        >
                                            <option value="monthly">aylık</option>
                                            <option value="annual">yıllık</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            {type === "Kredi Kartı" && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold ml-1 text-primary">Kesim (Gün)</label>
                                        <Input
                                            type="number" min="1" max="31" required placeholder="15"
                                            value={cutDate}
                                            className="h-11 rounded-xl bg-muted/20 border-border/50 focus:ring-primary/20"
                                            onChange={(e) => setCutDate(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold ml-1 text-primary">Son Ödeme</label>
                                        <Input
                                            type="number" min="1" max="31" required placeholder="25"
                                            value={dueDate}
                                            className="h-11 rounded-xl bg-muted/20 border-border/50 focus:ring-primary/20"
                                            onChange={(e) => setDueDate(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}
                            {type === "Esnek Hesap" && (
                                <p className="text-xs text-muted-foreground ml-1">
                                    Negatif bakiye = kullanılan kredi (normaldir). Faiz oranı borç maliyetini ve nefes payı etkisini hesaplar.
                                </p>
                            )}
                        </div>
                    )}

                    <div className="pt-4 flex justify-end gap-3 border-t border-border/50 mt-4">
                        <Button type="button" variant="ghost" onClick={onClose} className="h-11 px-6 rounded-xl hover:bg-muted">İptal</Button>
                        <Button type="submit" disabled={isLoading} className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/20">
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (account ? 'Değişiklikleri Kaydet' : 'Hesabı Kesinleştir')}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
