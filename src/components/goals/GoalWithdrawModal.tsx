"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Loader2, ArrowDownCircle, Wallet } from "lucide-react"
import { calculateCashDate } from "@/lib/cash-date"

type Goal = {
    id: string;
    name: string;
    saved_tl: number;
    saved_usd: number;
    saved_eur: number;
    saved_gold: number;
    saved_gbp: number;
    total_cost_tl: number;
}

type Account = {
    id: string;
    name: string;
    balance: number;
    currency: string;
    type?: string;
}

type ModalProps = {
    isOpen: boolean
    goal: Goal | null
    onClose: () => void
    onSuccess: () => void
}

export function GoalWithdrawModal({ isOpen, goal, onClose, onSuccess }: ModalProps) {
    const [assetType, setAssetType] = useState("TL")
    const [withdrawQuantity, setWithdrawQuantity] = useState("")
    const [sellPrice, setSellPrice] = useState("1")
    const [accountId, setAccountId] = useState("")
    const [accounts, setAccounts] = useState<Account[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isFetching, setIsFetching] = useState(false)

    useEffect(() => {
        if (isOpen && goal) {
            fetchAccounts()
            // Default asset type to the first one with balance
            if (goal.saved_gold > 0) setAssetType("ALTIN")
            else if (goal.saved_usd > 0) setAssetType("USD")
            else if (goal.saved_eur > 0) setAssetType("EUR")
            else if (goal.saved_gbp > 0) setAssetType("GBP")
            else setAssetType("TL")
        }
    }, [isOpen, goal])

    const fetchAccounts = async () => {
        setIsFetching(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return

            const { data } = await supabase
                .from('accounts')
                .select('*')
                .eq('household_id', hhId)
                .in('type', ['bank', 'cash'])

            if (data) {
                setAccounts(data as any)
                if (data.length > 0) setAccountId(data[0].id)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setIsFetching(false)
        }
    }

    const getAvailableAmount = () => {
        if (!goal) return 0
        switch (assetType) {
            case "TL": return goal.saved_tl
            case "USD": return goal.saved_usd
            case "EUR": return goal.saved_eur
            case "GBP": return goal.saved_gbp
            case "ALTIN": return goal.saved_gold
            default: return 0
        }
    }

    const getUnit = () => {
        if (assetType === "ALTIN") return "gr"
        if (assetType === "TL") return "₺"
        return assetType
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!goal || !withdrawQuantity || !sellPrice || !accountId) return

        const qty = parseFloat(withdrawQuantity)
        const price = parseFloat(sellPrice)
        const totalPayout = assetType === "TL" ? qty : qty * price
        const available = getAvailableAmount()

        if (qty > available) {
            alert(`Yetersiz miktar! Maksimum ${available} ${getUnit()} çekebilirsiniz.`)
            return
        }

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı")
            const hhId = await ensureHouseholdExists(user.id)

            // 1. Update Goal Balances
            let updatePayload: any = {}
            if (assetType === "TL") updatePayload.saved_tl = goal.saved_tl - qty
            else if (assetType === "USD") updatePayload.saved_usd = goal.saved_usd - qty
            else if (assetType === "EUR") updatePayload.saved_eur = goal.saved_eur - qty
            else if (assetType === "GBP") updatePayload.saved_gbp = goal.saved_gbp - qty
            else if (assetType === "ALTIN") updatePayload.saved_gold = goal.saved_gold - qty

            // Adjust total cost proportionally if possible (simplification: cost is reduced by same ratio as quantity)
            const ratio = qty / available
            if (available > 0) {
                // This is an estimation, as we don't track per-asset cost inside goals perfectly
                // but we can deduct total cost by the same value we added to the account if we want to be strict,
                // or just reduce it proportionally. Let's reduce it by the amount that was originally cost-basis.
                // However, for simplicity, let's just reduce the total_cost_tl by a reasonable amount.
                // If it's 100% withdrawal, cost becomes 0.
                if (qty === available) {
                    // if withdrawing everything of THIS asset, we might still have other assets.
                    // Tracking cost per asset in goals is hard with current schema.
                    // For now, let's at least deduct the cost_tl by (totalPayout) or keep it same.
                    // Better: just deduct the cost. (qty/available * total_cost_tl)
                    updatePayload.total_cost_tl = goal.total_cost_tl * (1 - ratio)
                }
            }

            const { error: goalError } = await supabase
                .from('goals')
                .update(updatePayload)
                .eq('id', goal.id)
            if (goalError) throw goalError

            // 2. Update Account Balance
            const targetAcc = accounts.find(a => a.id === accountId)
            if (targetAcc) {
                const { error: accError } = await supabase
                    .from('accounts')
                    .update({ balance: Number(targetAcc.balance) + totalPayout })
                    .eq('id', accountId)
                if (accError) throw accError
            }

            // 3. Log Transaction
            const { error: txError } = await supabase.from('transactions').insert({
                household_id: hhId,
                account_id: accountId,
                user_id: user.id,
                amount: totalPayout,
                type: 'income',
                transaction_date: new Date().toISOString(),
                cash_date: calculateCashDate(new Date(), targetAcc),
                description: `${goal.name} Hedefinden Çekim (${qty} ${getUnit()} @ ₺${price})`
            })
            if (txError) throw txError

            onSuccess()
            onClose()
        } catch (error: any) {
            alert("Hata: " + error.message)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen || !goal) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border">
                <div className="flex justify-between items-center p-6 border-b">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <ArrowDownCircle className="w-5 h-5 text-amber-500" /> Hedef Bozdur / Çek
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="bg-muted/30 p-4 rounded-xl border border-border/50">
                        <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">Kaynak Hedef</p>
                        <h3 className="text-lg font-bold mt-1 text-primary">{goal.name}</h3>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Bozdurulacak Varlık Tipi</label>
                        <select
                            className="flex h-12 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            value={assetType}
                            onChange={(e) => setAssetType(e.target.value)}
                        >
                            <option value="TL">Türk Lirası (₺{goal.saved_tl.toLocaleString()})</option>
                            <option value="USD">Amerikan Doları (${goal.saved_usd.toLocaleString()})</option>
                            <option value="EUR">Euro (€{goal.saved_eur.toLocaleString()})</option>
                            <option value="GBP">Sterlin (£{goal.saved_gbp.toLocaleString()})</option>
                            <option value="ALTIN">Altın ({goal.saved_gold} gr)</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Satılacak Miktar</label>
                            <Input
                                type="number"
                                step="any"
                                required
                                value={withdrawQuantity}
                                onChange={(e) => setWithdrawQuantity(e.target.value)}
                                placeholder="0.00"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Satış Fiyatı (₺)</label>
                            <Input
                                type="number"
                                step="any"
                                required
                                value={sellPrice}
                                onChange={(e) => setSellPrice(e.target.value)}
                                disabled={assetType === "TL"}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Paranın Aktarılacağı Hesap</label>
                        <select
                            className="flex h-12 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            value={accountId}
                            onChange={(e) => setAccountId(e.target.value)}
                        >
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name} ({acc.balance} ₺)</option>
                            ))}
                        </select>
                    </div>

                    <div className="p-4 bg-amber-500/5 rounded-xl border border-amber-500/20 text-center">
                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Tahmini Tahsilat</p>
                        <p className="text-3xl font-black text-amber-600 tracking-tighter">
                            ₺{((parseFloat(withdrawQuantity) || 0) * (assetType === "TL" ? 1 : parseFloat(sellPrice) || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                        </p>
                    </div>

                    <div className="pt-4 flex justify-end gap-3 border-t">
                        <Button type="button" variant="outline" onClick={onClose} className="rounded-xl h-12 px-6">İptal</Button>
                        <Button type="submit" disabled={isLoading} className="rounded-xl h-12 px-8 bg-amber-500 hover:bg-amber-600 text-white font-bold">
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wallet className="w-4 h-4 mr-2" />}
                            Bozdur ve Aktar
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
