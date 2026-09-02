"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Target, Loader2 } from "lucide-react"

type GoalModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function GoalModal({ isOpen, onClose, onSuccess }: GoalModalProps) {
    const [name, setName] = useState('')
    const [targetAmount, setTargetAmount] = useState('')
    const [monthlyAlloc, setMonthlyAlloc] = useState('')
    const [period, setPeriod] = useState('monthly')
    const [assetType, setAssetType] = useState('TL')
    const [deadline, setDeadline] = useState('')
    const [sourceAccountId, setSourceAccountId] = useState('')
    const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([])
    const [isLoading, setIsLoading] = useState(false)

    // Kaynak hesap seçimi için hesap listesi (modal açılınca).
    useEffect(() => {
        if (!isOpen) return
        const load = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return
            const { data } = await supabase.from('accounts').select('id, name').eq('household_id', hhId)
            setAccounts(data || [])
        }
        load()
    }, [isOpen])

    if (!isOpen) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name || !targetAmount) return

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Giriş yapmanız gerekiyor.")

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) throw new Error("Aile hesabı bulunamadı.")

            let isFiat = true;
            let assetUnit = '';
            let assetName = '';
            let icon = '🎯';
            let color = 'bg-primary';

            if (assetType === 'TL') {
                isFiat = true;
                icon = '₺';
                color = 'bg-emerald-500';
            } else if (assetType === 'USD') {
                isFiat = false;
                assetName = 'Dolar';
                assetUnit = '$';
                icon = '💵';
                color = 'bg-green-500';
            } else if (assetType === 'EUR') {
                isFiat = false;
                assetName = 'Euro';
                assetUnit = '€';
                icon = '💶';
                color = 'bg-blue-500';
            } else if (assetType === 'ALTIN') {
                isFiat = false;
                assetName = 'Altın';
                assetUnit = 'gr';
                icon = '🪙';
                color = 'bg-yellow-500';
            } else if (assetType === 'GBP') {
                isFiat = false;
                assetName = 'Sterlin';
                assetUnit = '£';
                icon = '💷';
                color = 'bg-purple-500';
            }

            const { error } = await supabase.from('goals').insert({
                household_id: hhId,
                name: name,
                target_amount: parseFloat(targetAmount),
                current_amount: 0,
                monthly_alloc: monthlyAlloc ? parseFloat(monthlyAlloc) : null,
                period: period,
                deadline: deadline || null,
                is_fiat: isFiat,
                asset_name: assetName || null,
                asset_unit: assetUnit || null,
                source_account_id: sourceAccountId || null,
                color: color,
                icon: icon
            })

            if (error) throw error

            onSuccess()
            setName('')
            setTargetAmount('')
            setMonthlyAlloc('')
            setPeriod('monthly')
            setAssetType('TL')
            setDeadline('')
            setSourceAccountId('')
            onClose()

        } catch (error: any) {
            alert('Hedef eklenemedi: ' + error.message)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-card w-full max-w-md rounded-xl shadow-lg border">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-lg font-semibold flex items-center">
                        <Target className="w-5 h-5 mr-2 text-primary" /> Yeni Hedef Ekle
                    </h2>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Hedef Adı</label>
                        <Input
                            placeholder="Örn: Tatil Fonu, Yeni Araba Peşinatı..."
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Varlık Tipi</label>
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
                        <label className="text-sm font-medium">Hedef Tutarı ({assetType === 'ALTIN' ? 'Gram' : assetType === 'USD' ? '$' : assetType === 'EUR' ? '€' : '₺'})</label>

                        <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={targetAmount}
                            onChange={e => setTargetAmount(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Aylık Ayrılan (₺)</label>
                        <Input
                            type="number"
                            step="0.01"
                            placeholder="Örn: 8000 — her ay bu hedefe ne ayrılıyor?"
                            value={monthlyAlloc}
                            onChange={e => setMonthlyAlloc(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Nakit projeksiyonunda gider gibi düşülür; boş bırakılırsa hedefe otomatik pay ayrılmaz.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Periyot</label>
                        <select
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={period}
                            onChange={e => setPeriod(e.target.value)}
                        >
                            <option value="monthly">Aylık Hedef</option>
                            <option value="yearly">Belirlenen Tarihli (Hedef Tarihine Göre Bölünür)</option>
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">
                            Hedef Tarihi {period === 'yearly' && <span className="text-destructive">*</span>}
                        </label>
                        <Input
                            type="date"
                            value={deadline}
                            onChange={e => setDeadline(e.target.value)}
                            required={period === 'yearly'}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Kaynak Hesap</label>
                        <select
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                            value={sourceAccountId}
                            onChange={e => setSourceAccountId(e.target.value)}
                        >
                            <option value="">Hesap seçme (opsiyonel)</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <p className="text-xs text-muted-foreground">
                            Bu hedefe ayrılan paranın durduğu hesap. Dayanma süresi hesabında serbest paradan ayrıştırılır.
                        </p>
                    </div>

                    <div className="pt-4 flex justify-end gap-2 border-t">
                        <Button type="button" variant="outline" onClick={onClose}>
                            İptal
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Kaydet
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
