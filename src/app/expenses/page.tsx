"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ArrowUpRight, Search, SlidersHorizontal, Plus, AlertCircle, Loader2, X } from "lucide-react"
import { TransactionModal } from "@/components/transactions/TransactionModal"

type Transaction = {
    id: string;
    account_id: string;
    amount: number;
    transaction_date: string;
    category_id: string;
    description: string;
    type: string;
    to_account_id?: string;
    accounts?: { name: string };
    categories?: { name: string };
}

export default function ExpensesPage() {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [modalType, setModalType] = useState<'expense' | 'transfer'>('expense')
    const [editingTransaction, setEditingTransaction] = useState<any>(null)
    const [expenses, setExpenses] = useState<Transaction[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

    // Harcama Dedektifi (Advanced Filters)
    const [searchQuery, setSearchQuery] = useState("")
    const [minAmount, setMinAmount] = useState<string>("")
    const [maxAmount, setMaxAmount] = useState<string>("")
    const [selectedCategory, setSelectedCategory] = useState<string>("all")
    const [showFilters, setShowFilters] = useState(false)

    const [categoriesList, setCategoriesList] = useState<any[]>([])
    const [allAccounts, setAllAccounts] = useState<any[]>([])

    const fetchExpenses = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return

            // Fetch Categories for limits
            const { data: catData } = await supabase
                .from('categories')
                .select('*')
                .eq('household_id', hhId)
                .eq('type', 'expense')

            if (catData) setCategoriesList(catData)

            // Fetch Accounts to identify credit cards for transfer visibility
            const { data: accData } = await supabase
                .from('accounts')
                .select('id, type')
                .eq('household_id', hhId)

            setAllAccounts(accData || [])

            const startDate = new Date(selectedYear, selectedMonth - 1, 1).toISOString()
            const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59).toISOString()

            const { data, error } = await supabase
                .from('transactions')
                .select('*, accounts!account_id(name), categories(name)')
                .eq('household_id', hhId)
                .in('type', ['expense', 'transfer'])
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate)
                .order('transaction_date', { ascending: false })

            if (error) throw error
            if (data) {
                // Show expenses OR transfers that:
                // 1. Have a category (explicitly categorized as expense/payment)
                // 2. Are sent to a credit card (implied credit card payment)
                const filtered = data.filter(tx => {
                    if (tx.type === 'expense') return true
                    if (tx.type === 'transfer') {
                        if (tx.category_id) return true
                        const destAcc = (accData || []).find((a: any) => a.id === tx.to_account_id)
                        return destAcc?.type === 'credit_card'
                    }
                    return false
                })
                setExpenses(filtered as any)
            }

        } catch (error: any) {
            console.error("Error fetching data:", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchExpenses()
    }, [selectedMonth, selectedYear])

    const handleDelete = async (id: string, amount: number, account_id: string) => {
        if (!confirm('Bu gideri silmek istediğinize emin misiniz?')) return;
        try {
            const { error } = await supabase.from('transactions').delete().eq('id', id);
            if (error) throw error;

            if (account_id) {
                const { data: acc } = await supabase.from('accounts').select('balance').eq('id', account_id).single();
                if (acc) {
                    await supabase.from('accounts').update({ balance: acc.balance + amount }).eq('id', account_id);
                }
            }

            setExpenses(prev => prev.filter(tx => tx.id !== id));
        } catch (e: any) {
            alert("Silinemedi: " + e.message);
        }
    }

    // Dynamic Filtering Logic (Client-side for instant feedback)
    const filteredExpenses = expenses.filter(expense => {
        const matchesSearch = expense.description?.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesCategory = selectedCategory === "all" || expense.category_id === selectedCategory
        const amount = Number(expense.amount)
        const matchesMin = minAmount === "" || amount >= Number(minAmount)
        const matchesMax = maxAmount === "" || amount <= Number(maxAmount)

        return matchesSearch && matchesCategory && matchesMin && matchesMax
    })

    const totalExpenses = filteredExpenses.filter(e => e.type === 'expense').reduce((acc, curr) => acc + curr.amount, 0);
    const currentBudget = categoriesList.reduce((acc, curr) => acc + (curr.budget_limit || 0), 0) || 5000;
    const isOverBudget = totalExpenses > currentBudget && currentBudget > 0;
    const percentUsed = currentBudget > 0 ? Math.min((totalExpenses / currentBudget) * 100, 100) : 0;

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount)
    }

    return (
        <div className="flex flex-col gap-6 h-[calc(100vh-140px)] max-h-[calc(100vh-140px)] overflow-hidden">
            <TransactionModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false)
                    setEditingTransaction(null)
                }}
                type={modalType}
                initialData={editingTransaction}
                onSuccess={() => {
                    fetchExpenses()
                }}
            />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-destructive">Giderler</h1>
                    <p className="text-muted-foreground mt-1">Harcamalarınızı ve bütçe limitinizi takip edin</p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="flex items-center bg-card border rounded-xl p-1 gap-1">
                        <select
                            className="bg-transparent text-sm font-bold px-2 py-1 outline-none"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(Number(e.target.value))}
                        >
                            {Array.from({ length: 12 }, (_, i) => (
                                <option key={i + 1} value={i + 1}>
                                    {new Date(0, i).toLocaleDateString('tr-TR', { month: 'long' })}
                                </option>
                            ))}
                        </select>
                        <select
                            className="bg-transparent text-sm font-bold px-2 py-1 outline-none border-l"
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(Number(e.target.value))}
                        >
                            {Array.from({ length: 5 }, (_, i) => (
                                <option key={i} value={new Date().getFullYear() - 2 + i}>
                                    {new Date().getFullYear() - 2 + i}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            className="hidden md:flex"
                            onClick={() => {
                                setModalType('transfer')
                                setEditingTransaction(null)
                                setIsModalOpen(true)
                            }}
                        >
                            Transfer
                        </Button>
                        <Button
                            size="lg"
                            variant="destructive"
                            className="flex-1 md:flex-none"
                            onClick={() => {
                                setModalType('expense')
                                setEditingTransaction(null)
                                setIsModalOpen(true)
                            }}
                        >
                            <Plus className="mr-2 h-4 w-4" /> Gider Ekle
                        </Button>
                    </div>
                </div>
            </div>

            {/* Bütçe Özeti / İlerleme Çubuğu - More compact layout */}
            <div className="grid gap-4 md:grid-cols-4 shrink-0">
                <Card className="md:col-span-1 bg-gradient-to-br from-card to-destructive/5 border-destructive/20 relative overflow-hidden">
                    <CardHeader className="pb-1 pt-4 px-4">
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                            Aylık Bütçe <AlertCircle className={`w-3 h-3 ${isOverBudget ? 'text-destructive' : 'text-muted-foreground'}`} />
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                        <div className="flex flex-col items-center">
                            <span className={`text-2xl font-black tracking-tighter ${isOverBudget ? 'text-destructive' : 'text-emerald-500'}`}>
                                ₺{new Intl.NumberFormat('tr-TR').format(Math.max(currentBudget - totalExpenses, 0))}
                            </span>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase mt-1">Kalan Bütçe</p>
                            <div className="w-full mt-3">
                                <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden border border-muted/20">
                                    <div
                                        className={`h-full rounded-full transition-all duration-700 bg-gradient-to-r ${percentUsed > 90 ? 'from-orange-500 to-destructive' : 'from-emerald-400 to-primary'}`}
                                        style={{ width: `${percentUsed}%` }}
                                    ></div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="md:col-span-3">
                    <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-bold">Kategori Limitleri</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                        <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto pr-1">
                            {categoriesList.filter(c => c.budget_limit > 0).map((cat, idx) => {
                                const spent = expenses.filter(e => e.category_id === cat.id).reduce((a, b) => a + b.amount, 0) || 0
                                const percent = Math.min((spent / cat.budget_limit) * 100, 100)
                                const overLimit = percent >= 95
                                const colors = ["bg-blue-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-emerald-500"]
                                const color = colors[idx % colors.length]

                                return (
                                    <div key={cat.id} className="flex-1 min-w-[150px] p-2 rounded-lg border bg-muted/30">
                                        <div className="flex justify-between text-[11px] font-bold mb-1">
                                            <span>{cat.name}</span>
                                            <span className={overLimit ? 'text-destructive' : ''}>
                                                ₺{new Intl.NumberFormat('tr-TR', { notation: 'compact' }).format(spent)} / ₺{new Intl.NumberFormat('tr-TR', { notation: 'compact' }).format(cat.budget_limit)}
                                            </span>
                                        </div>
                                        <div className="w-full bg-secondary h-1 rounded-full overflow-hidden">
                                            <div className={`h-full ${overLimit ? 'bg-destructive' : color}`} style={{ width: `${percent}%` }}></div>
                                        </div>
                                    </div>
                                )
                            })}
                            {categoriesList.filter(c => c.budget_limit > 0).length === 0 && (
                                <p className="text-center text-xs text-muted-foreground w-full py-4">Limit tanımlanmış kategori yok.</p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="flex-1 flex flex-col min-h-0 overflow-hidden shadow-xl border-none bg-card/60 backdrop-blur-xl rounded-[2rem]">
                <div className="flex flex-col p-4 border-b bg-card/40 sticky top-0 z-10 space-y-4">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="relative w-full sm:max-w-xs">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="search"
                                placeholder="Giderlerde ara..."
                                className="pl-9 bg-muted/50"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <Button
                                variant={showFilters ? "secondary" : "outline"}
                                className="w-full sm:w-auto"
                                onClick={() => setShowFilters(!showFilters)}
                            >
                                <SlidersHorizontal className="mr-2 h-4 w-4" />
                                {showFilters ? 'Filtreleri Gizle' : 'Harcama Dedektifi'}
                            </Button>
                        </div>
                    </div>

                    {showFilters && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t animate-in slide-in-from-top-2 duration-300">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Kategori</label>
                                <select
                                    className="w-full bg-muted/50 border rounded-lg p-2 text-sm outline-none"
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                >
                                    <option value="all">Tüm Kategoriler</option>
                                    {categoriesList.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Minimum Tutar</label>
                                <Input
                                    type="number"
                                    placeholder="₺ 0"
                                    className="bg-muted/50"
                                    value={minAmount}
                                    onChange={(e) => setMinAmount(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Maximum Tutar</label>
                                <Input
                                    type="number"
                                    placeholder="₺ Limitsiz"
                                    className="bg-muted/50"
                                    value={maxAmount}
                                    onChange={(e) => setMaxAmount(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <CardContent className="flex-1 p-0 overflow-auto">
                    <div className="w-full">
                        <div className="grid grid-cols-12 gap-4 border-b bg-muted/30 p-4 text-sm font-medium text-muted-foreground">
                            <div className="col-span-6 md:col-span-5">Harcama Detayı</div>
                            <div className="hidden md:block col-span-2">Kategori</div>
                            <div className="hidden lg:block col-span-2">Hesap</div>
                            <div className="col-span-6 md:col-span-3 text-right">Tutar</div>
                        </div>

                        {isLoading ? (
                            <div className="flex items-center justify-center p-12">
                                <Loader2 className="h-8 w-8 animate-spin text-destructive" />
                            </div>
                        ) : filteredExpenses.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground space-y-2">
                                <Search className="w-10 h-10 opacity-20" />
                                <p className="font-medium">Aradığınız kriterlerde gider bulunamadı.</p>
                                <Button variant="link" onClick={() => { setSearchQuery(""); setMinAmount(""); setMaxAmount(""); setSelectedCategory("all"); }}>Filtreleri Temizle</Button>
                            </div>
                        ) : (
                            <div className="divide-y text-small">
                                {filteredExpenses.map((tx) => (
                                    <div key={tx.id} className="group grid grid-cols-12 gap-4 items-center p-4 hover:bg-muted/10 transition-colors">
                                        <div className="col-span-6 md:col-span-5 flex items-center gap-4">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                                                <ArrowUpRight className="h-4 w-4 text-destructive" />
                                            </div>
                                            <div className="overflow-hidden">
                                                <p className="truncate font-medium leading-none">{tx.description || 'Gider İşlemi'}</p>
                                                <p className="text-sm text-muted-foreground mt-1 truncate">
                                                    {new Date(tx.transaction_date).toLocaleDateString('tr-TR')}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="hidden md:flex col-span-2 items-center">
                                            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold">
                                                {tx.categories?.name || 'Kategorisiz'}
                                            </span>
                                        </div>

                                        <div className="hidden lg:block col-span-2">
                                            <p className="text-sm font-medium">{tx.accounts?.name || 'Bilinmiyor'}</p>
                                        </div>

                                        <div className="col-span-6 md:col-span-3 flex items-center justify-end gap-2">
                                            <p className="font-semibold text-destructive">
                                                -{formatCurrency(tx.amount)}
                                            </p>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                <button
                                                    onClick={() => {
                                                        setEditingTransaction(tx)
                                                        setModalType(tx.type as any)
                                                        setIsModalOpen(true)
                                                    }}
                                                    className="p-1.5 bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white rounded-md transition-all"
                                                >
                                                    <Search className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => handleDelete(tx.id, tx.amount, tx.account_id)} className="p-1.5 bg-destructive/10 text-destructive hover:bg-destructive hover:text-white rounded-md transition-all">
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
