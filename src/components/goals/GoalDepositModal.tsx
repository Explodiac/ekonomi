"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, TrendingUp, Loader2 } from "lucide-react"
import { calculateCashDate } from "@/lib/cash-date"

type Goal = {
    id: string;
    name: string;
    current_amount: number; // legacy
    target_amount: number;
    saved_tl: number;
    saved_usd: number;
    saved_eur: number;
    saved_gold: number;
    saved_gbp: number;
    total_cost_tl: number;
    period: 'monthly' | 'yearly';
    is_fiat: boolean;
    asset_unit?: string;
    asset_name?: string;
    deadline?: string;
    color: string;
    icon: string;
}

type Account = {
    id: string;
    name: string;
    balance: number;
    currency: string;
    type?: string;
    cut_date?: number | null;
    due_date?: number | null;
}

type GoalDepositModalProps = {
    isOpen: boolean;
    goal: Goal | null;
    onClose: () => void;
    onSuccess: () => void;
}

export function GoalDepositModal({ isOpen, goal, onClose, onSuccess }: GoalDepositModalProps) {
    const [amount, setAmount] = useState('')
    const [assetType, setAssetType] = useState('TL')
    const [exchangeRate, setExchangeRate] = useState('')
    const [sourceType, setSourceType] = useState('account')
    const [accountId, setAccountId] = useState('')
    const [accounts, setAccounts] = useState<Account[]>([])
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        if (!isOpen) return;

        const fetchAccounts = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return

                const hhId = await ensureHouseholdExists(user.id)
                if (!hhId) return

                const { data } = await supabase.from('accounts').select('*').eq('household_id', hhId)
                if (data) {
                    setAccounts(data as any)
                    if (data.length > 0) setAccountId((data[0] as any).id)
                }
            } catch (error) {
                console.error("Error fetching accounts", error)
            }
        }

        fetchAccounts()
    }, [isOpen])

    useEffect(() => {
        if (goal) {
            // Set default asset dropdown based on goal's primary asset
            if (!goal.is_fiat && goal.asset_name === 'Dolar') setAssetType('USD');
            else if (!goal.is_fiat && goal.asset_name === 'Euro') setAssetType('EUR');
            else if (!goal.is_fiat && goal.asset_name === 'Sterlin') setAssetType('GBP');
            else if (!goal.is_fiat && goal.asset_name === 'Altın') setAssetType('ALTIN');
            else setAssetType('TL');
        }
    }, [goal])

    if (!isOpen || !goal) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!amount) return

        const depositValue = parseFloat(amount)
        if (isNaN(depositValue) || depositValue <= 0) {
            alert("Lütfen geçerli bir miktar girin.")
            return
        }

        if (sourceType === 'account' && !accountId) {
            alert("Lütfen hedefe aktarım yapılacak kaynağı (hesabı) seçin.")
            return
        }

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı.")

            let totalCostTL = depositValue;
            let deductionAmount = depositValue;

            if (assetType !== 'TL') {
                const rate = parseFloat(exchangeRate);
                if (isNaN(rate) || rate <= 0) {
                    alert("Lütfen geçerli bir alış kuru / maliyet girin.");
                    setIsLoading(false);
                    return;
                }
                totalCostTL = depositValue * rate;
            }

            if (sourceType === 'account') {
                // 1. Check account balance
                const account = accounts.find(a => a.id === accountId)
                if (!account) throw new Error("Hesap bulunamadı.")

                // If account is TL but asset is foreign, deduct the TL cost. Otherwise deduct the asset amount directly.
                if (account.currency === 'TRY' && assetType !== 'TL') {
                    deductionAmount = totalCostTL;
                }

                if (account.balance < deductionAmount) {
                    throw new Error(`Seçili hesapta yeterli bakiye yok. Güncel Bakiye: ${account.balance} ${account.currency}`)
                }

                // 2. Deduct from account
                const { error: accError } = await supabase
                    .from('accounts')
                    .update({ balance: account.balance - deductionAmount })
                    .eq('id', accountId)

                if (accError) throw accError

                const hhId = await ensureHouseholdExists(user.id)

                // 3. Log transfer transaction
                await supabase.from('transactions').insert({
                    account_id: accountId,
                    household_id: hhId,
                    amount: deductionAmount,
                    type: 'transfer',
                    transaction_date: new Date().toISOString(),
                    cash_date: calculateCashDate(new Date(), account),
                    description: `${goal.name} hedefine fon aktarımı (${depositValue} ${assetType === 'ALTIN' ? 'gr' : assetType})`,
                    metadata: { goal_id: goal.id, asset_type: assetType, exchange_rate: exchangeRate ? parseFloat(exchangeRate) : 1 }
                })
            }

            // 4. Determine goal asset type payload
            let updatePayload: any = {}
            if (assetType === 'TL') updatePayload.saved_tl = (goal.saved_tl || 0) + depositValue;
            if (assetType === 'USD') updatePayload.saved_usd = (goal.saved_usd || 0) + depositValue;
            if (assetType === 'EUR') updatePayload.saved_eur = (goal.saved_eur || 0) + depositValue;
            if (assetType === 'GBP') updatePayload.saved_gbp = (goal.saved_gbp || 0) + depositValue;
            if (assetType === 'ALTIN') updatePayload.saved_gold = (goal.saved_gold || 0) + depositValue;

            updatePayload.total_cost_tl = (goal.total_cost_tl || 0) + totalCostTL;

            // 5. Increment goal
            const { error: goalError } = await supabase
                .from('goals')
                .update(updatePayload)
                .eq('id', goal.id)

            if (goalError) throw goalError

            onSuccess()
            setAmount('')
            setExchangeRate('')
            onClose()

        } catch (error: any) {
            alert('Ekleme yapılamadı: ' + error.message)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-card w-full max-w-sm rounded-xl shadow-lg border">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-lg font-semibold flex items-center">
                        <TrendingUp className="w-5 h-5 mr-2 text-primary" /> Birikim Ekle
                    </h2>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div className="text-sm text-muted-foreground mb-4">
                        <strong className="text-foreground">{goal.name}</strong> için hesaplarınıza eklenen yeni bir varlığı hedef havuzuna dahil ediyorsunuz.
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Kaynak Türü</label>
                        <select
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                            value={sourceType}
                            onChange={e => setSourceType(e.target.value)}
                        >
                            <option value="account">Kayıtlı Hesabımdan Düş</option>
                            <option value="external">Dışarıdan/Yeni Gelir Olarak Ekle</option>
                        </select>
                    </div>

                    {sourceType === 'account' && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Kaynak Hesap (Bakiye Düşülecek)</label>
                            <select
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={accountId}
                                onChange={e => setAccountId(e.target.value)}
                            >
                                {!accounts.length && <option value="">Hesap bulunamadı</option>}
                                {accounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>
                                        {acc.name} ({acc.balance} {acc.currency})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Eklenen Varlık Tipi</label>
                        <select
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={assetType}
                            onChange={e => setAssetType(e.target.value)}
                        >
                            <option value="TL">Türk Lirası (₺)</option>
                            <option value="USD">Amerikan Doları ($)</option>
                            <option value="EUR">Euro (€)</option>
                            <option value="GBP">İngiliz Sterlini (£)</option>
                            <option value="ALTIN">Fiziki Altın (Gram)</option>
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Eklenecek Miktar</label>
                        <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            required
                            autoFocus
                        />
                    </div>

                    {assetType !== 'TL' && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Birim Alış Kuru / Maliyet (₺)</label>
                            <Input
                                type="number"
                                step="0.0001"
                                placeholder={`Örn: ${assetType === 'ALTIN' ? '3000' : '35.50'}`}
                                value={exchangeRate}
                                onChange={e => setExchangeRate(e.target.value)}
                                required
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                {amount && exchangeRate ? `Toplam Maliyet: ₺${(parseFloat(amount) * parseFloat(exchangeRate)).toLocaleString('tr-TR')}` : 'Bu varlığı hangi kurdan aldığınızı girin.'}
                            </p>
                        </div>
                    )}

                    <div className="pt-4 flex justify-end gap-2 border-t">
                        <Button type="button" variant="outline" onClick={onClose}>
                            İptal
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Ekle
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
