"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { CalendarClock, Plus, Search, AlertCircle, ArrowUpRight, Loader2, X, Trash2, Edit2, Check } from "lucide-react"
import Link from "next/link"
import { calculateCashDate } from "@/lib/cash-date"
import { RecurringSuggestions } from "@/components/subscriptions/recurring-suggestions"
import { PrimaryButton } from "@/components/ui/primary-button"
import { CategoryTile } from "@/components/dashboard/category-tile"

const FREQ_LABEL: Record<string, string> = { monthly: 'Aylık', yearly: 'Yıllık', weekly: 'Haftalık' }
function formatTLsub(n: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(n))} ₺`
}
const TR_MONTHS_SUB = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

type Subscription = {
    id: string;
    name: string;
    amount: number;
    frequency: string;
    next_payment_date: string;
    end_date?: string | null;
    status: string;
    category_id?: string;
}

type Category = {
    id: string;
    name: string;
}

type Account = {
    id: string;
    name: string;
    balance: number;
    type?: string;
    cut_date?: number | null;
    due_date?: number | null;
}

export default function SubscriptionsPage() {
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [accounts, setAccounts] = useState<Account[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')

    // Form states
    const [editingSubId, setEditingSubId] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [amount, setAmount] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [frequency, setFrequency] = useState('monthly')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('') // süreli abonelik bitişi; boş = süresiz
    const [isActionLoading, setIsActionLoading] = useState(false)

    // Payment states
    const [isPayModalOpen, setIsPayModalOpen] = useState(false)
    const [currentSubToPay, setCurrentSubToPay] = useState<Subscription | null>(null)
    const [selectedAccountId, setSelectedAccountId] = useState('')

    const fetchData = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)

            // Categories
            const { data: catData } = await supabase
                .from('categories')
                .select('id, name')
                .eq('household_id', hhId)
                .eq('type', 'expense')
            setCategories(catData || [])

            // Accounts
            const { data: accData } = await supabase
                .from('accounts')
                .select('id, name, balance, type, cut_date, due_date')
                .eq('household_id', hhId)
            setAccounts(accData || [])

            // Subscriptions
            const { data: subData, error } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('household_id', hhId)
                .order('next_payment_date')

            if (error) throw error
            setSubscriptions(subData || [])
        } catch (error: any) {
            console.error("Error fetching subscriptions:", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [])

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsActionLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)

            if (editingSubId) {
                const { error } = await supabase
                    .from('subscriptions')
                    .update({
                        name,
                        amount: parseFloat(amount),
                        category_id: categoryId || null,
                        frequency,
                        next_payment_date: startDate,
                        end_date: endDate || null,
                    })
                    .eq('id', editingSubId)
                if (error) throw error
            } else {
                const { error } = await supabase.from('subscriptions').insert({
                    household_id: hhId,
                    name,
                    amount: parseFloat(amount),
                    category_id: categoryId || null,
                    frequency,
                    next_payment_date: startDate,
                    end_date: endDate || null,
                    status: 'active'
                })
                if (error) throw error
            }

            setIsModalOpen(false)
            resetForm()
            fetchData()
        } catch (error: any) {
            alert("İşlem başarısız: " + error.message)
        } finally {
            setIsActionLoading(false)
        }
    }

    const handleEditClick = (sub: Subscription) => {
        setEditingSubId(sub.id)
        setName(sub.name)
        setAmount(sub.amount.toString())
        setCategoryId(sub.category_id || '')
        setFrequency(sub.frequency)
        setStartDate(sub.next_payment_date)
        setEndDate((sub as any).end_date || '')
        setIsModalOpen(true)
    }

    const resetForm = () => {
        setEditingSubId(null)
        setName('')
        setAmount('')
        setCategoryId('')
        setFrequency('monthly')
        setStartDate('')
        setEndDate('')
    }

    const handleConfirmPay = async () => {
        if (!currentSubToPay || !selectedAccountId) return
        setIsActionLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const hhId = await ensureHouseholdExists(user.id)

            // 1. Gider İşlemi Oluştur
            const { error: transError } = await supabase
                .from('transactions')
                .insert({
                    household_id: hhId,
                    account_id: selectedAccountId,
                    amount: currentSubToPay.amount,
                    type: 'expense',
                    transaction_date: new Date().toISOString(),
                    cash_date: calculateCashDate(new Date(), accounts.find(a => a.id === selectedAccountId)),
                    description: `${currentSubToPay.name} Abonelik Ödemesi`,
                    category_id: currentSubToPay.category_id,
                    user_id: user.id,
                    source_type: 'subscription',
                    source_id: currentSubToPay.id
                })
            if (transError) throw transError
            // accounts.balance yazılmaz — gider hareketi bakiye türetmesine otomatik yansır.

            // 3. Abonelik Tarihini Beri At (Periyoda göre)
            const currentDate = new Date(currentSubToPay.next_payment_date)
            let nextDate = new Date(currentDate)

            if (currentSubToPay.frequency === 'monthly') {
                nextDate.setMonth(nextDate.getMonth() + 1)
            } else if (currentSubToPay.frequency === 'yearly') {
                nextDate.setFullYear(nextDate.getFullYear() + 1)
            } else if (currentSubToPay.frequency === 'weekly') {
                nextDate.setDate(nextDate.getDate() + 7)
            }

            const { error: subError } = await supabase
                .from('subscriptions')
                .update({ next_payment_date: nextDate.toISOString().split('T')[0] })
                .eq('id', currentSubToPay.id)
            if (subError) throw subError

            setIsPayModalOpen(false)
            setCurrentSubToPay(null)
            setSelectedAccountId('')
            fetchData()
        } catch (error: any) {
            alert("Ödeme işlemi başarısız: " + error.message)
        } finally {
            setIsActionLoading(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Silmek istediğinize emin misiniz?")) return
        try {
            await supabase.from('subscriptions').delete().eq('id', id)
            setSubscriptions(prev => prev.filter(s => s.id !== id))
        } catch (error) {
            console.error("Delete failed", error)
        }
    }

    const filtered = subscriptions.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const totalMonthly = subscriptions
        .filter(s => s.frequency === "monthly" && s.status === 'active')
        .reduce((sum, s) => sum + Number(s.amount), 0)

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const overdueSubs = subscriptions.filter(s =>
        new Date(s.next_payment_date) < now && s.status === 'active'
    );

    const upcomingSubs = subscriptions.filter(s => {
        const d = new Date(s.next_payment_date);
        const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 3600 * 24));
        return diff >= 0 && diff <= 30 && s.status === 'active';
    });

    return (
        <div className="flex flex-col gap-[var(--s3)] pb-10">
            {/* Sessiz öneri: tekrar eden harcamalardan abonelik adayları. Onay→abonelik,
                ret→kalıcı susma. Öneri yoksa bu bölüm hiç görünmez. */}
            <RecurringSuggestions onAdded={fetchData} />

            {/* Başlık + özet + ekle */}
            <div className="flex items-center justify-between gap-[var(--s3)]">
                <div className="min-w-0">
                    <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Abonelikler ve düzenli ödemeler</h1>
                    <p className="tnum" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                        Aylık düzenli taahhüt {formatTLsub(totalMonthly)} · süresiz ya da uzun süreli (Netflix, kira). Belirli sayıda taksitle biten için “Taksitli ödeme”yi kullan.
                    </p>
                </div>
                <PrimaryButton onClick={() => { resetForm(); setIsModalOpen(true); }}>
                    <Plus className="h-4 w-4" /> Yeni abonelik
                </PrimaryButton>
            </div>

            {/* Arama */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
                <input
                    type="search" placeholder="Abonelik ara…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    className="w-full py-[var(--s3)] pl-9 pr-[var(--s3)] outline-none"
                    style={{ background: 'var(--surface)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 14 }}
                />
            </div>

            {/* Liste — Yaklaşan dili; satır tıklanınca /yaklasan detayına gider */}
            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="overflow-hidden">
                {isLoading ? (
                    <div className="flex items-center justify-center py-[var(--s6)]"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
                ) : filtered.length === 0 ? (
                    <p className="px-[22px] py-[var(--s5)]" style={{ fontSize: 14.5, color: 'var(--ink-3)' }}>Abonelik yok.</p>
                ) : (
                    <ul>
                        {filtered.map((sub, i) => {
                            const d = new Date(sub.next_payment_date)
                            const overdue = d < now && sub.status === 'active'
                            return (
                                <li key={sub.id} className="group flex items-center gap-[var(--s3)] px-[22px] py-[13px]" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                                    <Link href="/yaklasan" className="flex min-w-0 flex-1 items-center gap-[var(--s3)]">
                                        <CategoryTile name={categories.find(c => c.id === sub.category_id)?.name || sub.name} size={34} />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{sub.name}</div>
                                            <div className="tnum" style={{ fontSize: 12, color: overdue ? 'var(--flow-out)' : 'var(--ink-3)' }}>
                                                {FREQ_LABEL[sub.frequency] || sub.frequency} · {overdue ? 'gecikmiş' : `sonraki ${d.getDate()} ${TR_MONTHS_SUB[d.getMonth()]}`}
                                                {sub.end_date && (() => { const e = new Date(sub.end_date); return <> · {TR_MONTHS_SUB[e.getMonth()]} {e.getFullYear()}&apos;de bitiyor</> })()}
                                            </div>
                                        </div>
                                        <div className="tnum shrink-0 text-right" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{formatTLsub(sub.amount)}</div>
                                    </Link>
                                    <div className="flex shrink-0 items-center gap-[var(--s1)]">
                                        {sub.status === 'active' && (
                                            <button
                                                onClick={() => {
                                                    setCurrentSubToPay(sub)
                                                    setSelectedAccountId(accounts.find((a: any) => ['bank', 'cash', 'esnek_hesap'].includes(a.type))?.id || accounts[0]?.id || '')
                                                    setIsPayModalOpen(true)
                                                }}
                                                className="px-[10px] py-[5px]"
                                                style={{ background: overdue ? 'var(--accent)' : 'var(--surface-2)', color: overdue ? '#fff' : 'var(--ink-2)', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600 }}
                                                title="Ödendi olarak işaretle"
                                            >
                                                Öde
                                            </button>
                                        )}
                                        <button onClick={() => handleEditClick(sub)} className="icon-btn p-2" title="Düzenle"><Edit2 className="h-4 w-4" /></button>
                                        <button onClick={() => handleDelete(sub.id)} className="icon-btn p-2" title="Sil"><Trash2 className="h-4 w-4" /></button>
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </section>
            <p className="px-[var(--s2)]" style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                Ödeme takibi ve detaylar Yaklaşan ekranında — satıra tıklayın.
            </p>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-card w-full max-w-sm rounded-xl shadow-lg border">
                        <div className="flex justify-between items-center p-4 border-b">
                            <h2 className="text-lg font-semibold flex items-center">
                                {editingSubId ? <Edit2 className="w-5 h-5 mr-2 text-primary" /> : <Plus className="w-5 h-5 mr-2 text-primary" />}
                                {editingSubId ? 'Aboneliği Düzenle' : 'Yeni Abonelik Ekle'}
                            </h2>
                            <Button variant="ghost" size="icon" onClick={() => setIsModalOpen(false)} className="h-8 w-8 rounded-full">
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                        <form onSubmit={handleAdd} className="p-4 space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Abonelik Adı</label>
                                <Input placeholder="Örn: Netflix, Spotify..." value={name} onChange={e => setName(e.target.value)} required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Tutar (₺)</label>
                                    <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Döngü</label>
                                    <select
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        value={frequency}
                                        onChange={e => setFrequency(e.target.value)}
                                    >
                                        <option value="monthly">Aylık</option>
                                        <option value="yearly">Yıllık</option>
                                        <option value="weekly">Haftalık</option>
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Kategori</label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={categoryId}
                                    onChange={e => setCategoryId(e.target.value)}
                                >
                                    <option value="">Kategori Seçin</option>
                                    {categories.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Sonraki Ödeme Tarihi</label>
                                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Bitiş Tarihi <span className="text-xs text-muted-foreground">(opsiyonel — süreli abonelik)</span></label>
                                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                                <p className="text-[11px] text-muted-foreground italic">Süresiz ya da uzun süreli tekrarlayan ödeme (Netflix, kira). Boş bırak = süresiz. Belirli sayıda taksit için “Taksitli ödeme”.</p>
                            </div>
                            <div className="pt-4 flex justify-end gap-2 border-t">
                                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>İptal</Button>
                                <Button type="submit" disabled={isActionLoading}>
                                    {isActionLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                                    Kaydet
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Payment Confirmation Modal */}
            {isPayModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-card w-full max-w-sm rounded-xl shadow-2xl border animate-in zoom-in-95 duration-200">
                        <div className="p-6 space-y-4">
                            <div className="flex items-center gap-3 text-emerald-600">
                                <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                                    <Check className="h-6 w-6" />
                                </div>
                                <h3 className="text-lg font-bold">Ödemeyi Onayla</h3>
                            </div>

                            <div className="space-y-1">
                                <p className="text-sm text-muted-foreground">Ödeme Tutarı:</p>
                                <p className="text-2xl font-black">₺{new Intl.NumberFormat('tr-TR').format(currentSubToPay?.amount || 0)}</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Ödeme Yapılacak Hesap</label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                                    value={selectedAccountId}
                                    onChange={e => setSelectedAccountId(e.target.value)}
                                >
                                    <option value="">Hesap Seçin</option>
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.id}>
                                            {acc.name} (Bakiye: ₺{new Intl.NumberFormat('tr-TR', { notation: 'compact' }).format(acc.balance)})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="pt-4 flex flex-col gap-2">
                                <Button
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 font-bold"
                                    onClick={handleConfirmPay}
                                    disabled={!selectedAccountId || isActionLoading}
                                >
                                    {isActionLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                                    Ödemeyi Tamamla
                                </Button>
                                <Button
                                    variant="ghost"
                                    className="w-full text-muted-foreground"
                                    onClick={() => { setIsPayModalOpen(false); setCurrentSubToPay(null); }}
                                    disabled={isActionLoading}
                                >
                                    İptal
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
