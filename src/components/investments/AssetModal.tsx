"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Loader2 } from "lucide-react"

type ModalProps = {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
}

export function AssetModal({ isOpen, onClose, onSuccess }: ModalProps) {
    const [name, setName] = useState("")
    const [symbol, setSymbol] = useState("")
    const [quantity, setQuantity] = useState("")
    const [unit, setUnit] = useState("adet")
    const [averageCost, setAverageCost] = useState("")
    const [currentPrice, setCurrentPrice] = useState("")
    const [type, setType] = useState("Yerli Hisse")

    const [isLoading, setIsLoading] = useState(false)
    const [householdId, setHouseholdId] = useState<string | null>(null)

    useEffect(() => {
        if (isOpen) {
            fetchHouseholdId()
        }
    }, [isOpen])

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
        if (!name || !quantity || !averageCost || !currentPrice || !householdId) return

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()

            const { error } = await supabase.from('investments').insert([{
                household_id: householdId,
                user_id: user?.id,
                name,
                symbol: symbol || name.substring(0, 4).toUpperCase(),
                quantity: parseFloat(quantity),
                unit,
                average_cost: parseFloat(averageCost),
                current_price: parseFloat(currentPrice),
                type,
                color: type === 'Emtia' ? 'bg-yellow-500' : 'bg-primary'
            }])

            if (error) throw error

            // Reset form
            setName("")
            setSymbol("")
            setQuantity("")
            setAverageCost("")
            setCurrentPrice("")

            onSuccess()
            onClose()
        } catch (error: any) {
            alert("Hata: " + error.message)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-md rounded-xl shadow-2xl overflow-hidden border">
                <div className="flex justify-between items-center p-6 border-b">
                    <h2 className="text-xl font-bold">Varlık/Yatırım Ekle</h2>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Varlık Tipi</label>
                        <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                        >
                            <option value="Yerli Hisse">Yerli Hisse</option>
                            <option value="Yabancı Hisse">Yabancı Hisse</option>
                            <option value="Emtia">Emtia (Altın, Gümüş vb.)</option>
                            <option value="Kripto">Kripto Para</option>
                            <option value="Fon">Yatırım Fonu</option>
                            <option value="Mevduat">Vadeli / Döviz Mevduat</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Varlık Adı</label>
                            <Input
                                type="text"
                                required
                                placeholder="Örn: Gram Altın"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Sembol (Ops.)</label>
                            <Input
                                type="text"
                                placeholder="Örn: XAUTRY"
                                value={symbol}
                                onChange={(e) => setSymbol(e.target.value)}
                                className="uppercase"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Miktar</label>
                            <Input
                                type="number"
                                step="any"
                                required
                                placeholder="0"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Birim</label>
                            <select
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                                value={unit}
                                onChange={(e) => setUnit(e.target.value)}
                            >
                                <option value="adet">Adet</option>
                                <option value="lot">Lot</option>
                                <option value="gr">Gram (gr)</option>
                                <option value="oz">Ons (oz)</option>
                                <option value="kg">Kilogram (kg)</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Ort. Alış Fiyatı (₺)</label>
                            <Input
                                type="number"
                                step="any"
                                required
                                placeholder="0.00"
                                value={averageCost}
                                onChange={(e) => setAverageCost(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-blue-500">Güncel Fiyat (₺)</label>
                            <Input
                                type="number"
                                step="any"
                                required
                                placeholder="0.00"
                                value={currentPrice}
                                onChange={(e) => setCurrentPrice(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="pt-4 flex justify-end gap-3 border-t mt-4">
                        <Button type="button" variant="outline" onClick={onClose}>İptal</Button>
                        <Button type="submit" disabled={isLoading} className="bg-primary hover:bg-primary/90">
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Portföye Ekle'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
