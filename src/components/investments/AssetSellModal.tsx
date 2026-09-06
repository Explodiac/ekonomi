"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Loader2, TrendingDown, Wallet } from "lucide-react"
import { calculateCashDate } from "@/lib/cash-date"

type Asset = {
    id: string;
    name: string;
    symbol: string;
    quantity: number;
    unit: string;
    average_cost: number;
    current_price: number;
    type: string;
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
    asset: Asset | null
    onClose: () => void
    onSuccess: () => void
}

export function AssetSellModal({ isOpen, asset, onClose, onSuccess }: ModalProps) {
    const [sellQuantity, setSellQuantity] = useState("")
    const [sellPrice, setSellPrice] = useState("")
    const [accountId, setAccountId] = useState("")
    const [accounts, setAccounts] = useState<Account[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isFetching, setIsFetching] = useState(false)

    useEffect(() => {
        if (isOpen) {
            fetchAccounts()
            if (asset) {
                setSellQuantity(asset.quantity.toString())
                setSellPrice(asset.current_price.toString())
            }
        }
    }, [isOpen, asset])

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
                .in('type', ['bank', 'cash', 'esnek_hesap'])

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!asset || !sellQuantity || !sellPrice || !accountId) return

        const qty = parseFloat(sellQuantity)
        const price = parseFloat(sellPrice)
        const totalPayout = qty * price

        if (qty > asset.quantity) {
            alert(`Yetersiz miktar! Maksimum ${asset.quantity} ${asset.unit} satabilirsiniz.`)
            return
        }

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı")
            const hhId = await ensureHouseholdExists(user.id)

            // 1. Update Asset Quantity
            const newQty = asset.quantity - qty
            if (newQty <= 0) {
                const { error: delError } = await supabase.from('investments').delete().eq('id', asset.id)
                if (delError) throw delError
            } else {
                const { error: updError } = await supabase
                    .from('investments')
                    .update({ quantity: newQty })
                    .eq('id', asset.id)
                if (updError) throw updError
            }

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
                description: `${asset.name} Satışı (${qty} ${asset.unit} @ ₺${price})`
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

    if (!isOpen || !asset) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border">
                <div className="flex justify-between items-center p-6 border-b">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <TrendingDown className="w-5 h-5 text-destructive" /> Varlık Bozdur / Sat
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="bg-muted/30 p-4 rounded-xl border border-border/50">
                        <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">Satılan Varlık</p>
                        <h3 className="text-lg font-bold mt-1">{asset.name} ({asset.symbol})</h3>
                        <p className="text-sm text-muted-foreground">Mevcut: {asset.quantity} {asset.unit} (Maliyet: ₺{asset.average_cost})</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Satılacak Miktar</label>
                            <Input
                                type="number"
                                step="any"
                                required
                                value={sellQuantity}
                                onChange={(e) => setSellQuantity(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Birim Satış Fiyatı (₺)</label>
                            <Input
                                type="number"
                                step="any"
                                required
                                value={sellPrice}
                                onChange={(e) => setSellPrice(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Paranın Geleceği Hesap</label>
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

                    <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20 text-center">
                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Tahmini Tahsilat</p>
                        <p className="text-3xl font-black text-emerald-600 tracking-tighter">
                            ₺{((parseFloat(sellQuantity) || 0) * (parseFloat(sellPrice) || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                        </p>
                    </div>

                    <div className="pt-4 flex justify-end gap-3 border-t">
                        <Button type="button" variant="outline" onClick={onClose} className="rounded-xl h-12 px-6">İptal</Button>
                        <Button type="submit" disabled={isLoading} className="rounded-xl h-12 px-8 bg-destructive hover:bg-destructive/90 font-bold">
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wallet className="w-4 h-4 mr-2" />}
                            Satışı Onayla
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
