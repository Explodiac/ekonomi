'use client'

import { useState, useEffect, useMemo } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip,
    AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer as RC
} from 'recharts'
import { ClientOnly } from "@/components/client-only"
import { deriveAccountBalances } from "@/lib/balance"
import {
    Calendar, TrendingUp, TrendingDown, Target, Wallet,
    ChevronLeft, ChevronRight, Loader2, ArrowUpRight, ArrowDownRight,
    Search, Filter, PieChart as PieIcon, BarChart3
} from "lucide-react"
import { Button } from "@/components/ui/button"

type Transaction = {
    id: string;
    amount: number;
    type: 'income' | 'expense' | 'transfer';
    transaction_date: string;
    category_id: string;
    description: string;
    categories: {
        name: string;
        color: string;
        icon: string;
    } | null;
    to_accounts?: {
        type: string;
    } | null;
}

export function LegacyReportsPage() {
    const [currentDate, setCurrentDate] = useState(new Date())
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [bankBalance, setBankBalance] = useState(0)
    const [accounts, setAccounts] = useState<{ id: string; type: string }[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const fetchReportData = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return

            const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString()
            const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59).toISOString()

            const { data, error } = await supabase
                .from('transactions')
                .select(`
                    *,
                    categories (name, color, icon)
                `)
                .eq('household_id', hhId)
                .gte('transaction_date', startOfMonth)
                .lte('transaction_date', endOfMonth)
                .order('transaction_date', { ascending: true })

            if (error) throw error
            setTransactions(data || [])

            // Fetch current liquid balance (bank + cash)
            // Tüm hesaplar çekiliyor: likit bakiye için bank/cash, kart ödemesi
            // tespiti için kredi kartlarının kimliği gerekiyor.
            const { data: accData, error: accError } = await supabase
                .from('accounts')
                .select('id, name, balance, opening_balance, type')
                .eq('household_id', hhId)

            if (accError) throw accError
            setAccounts(accData || [])
            const liquidAccounts = (accData || []).filter(a => ['bank', 'cash'].includes(a.type))

            // Bakiye saklanan balance'tan değil, hareketlerden türetiliyor:
            // gelecek tarihli hareketler bugünün bakiyesine karışmasın diye.
            const { data: allTx } = await supabase
                .from('transactions')
                .select('account_id, amount, type, cash_date')
                .eq('household_id', hhId)

            const balances = deriveAccountBalances(accData || [], allTx || [])
            const liquidBalance = liquidAccounts.reduce((sum, acc) => sum + (balances.get(acc.id) ?? 0), 0)
            setBankBalance(liquidBalance)
        } catch (error) {
            console.error("Error fetching report data:", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchReportData()
    }, [currentDate])

    // Aggregations
    const cardAccountIds = useMemo(
        () => new Set(accounts.filter(a => a.type === 'credit_card').map(a => a.id)),
        [accounts]
    )

    /**
     * Kart ödemesi = kredi kartı hesabına GELEN transfer bacağı.
     * Bu gerçek bir nakit çıkışıdır (borç kapatma); hesaplar arası normal transfer
     * ise para evin içinde kaldığı için çıkış sayılmaz.
     */
    const isCardPayment = (t: any) =>
        t.type === 'transfer' && t.transfer_direction === 'in' && cardAccountIds.has(t.account_id)

    const totals = useMemo(() => {
        let income = 0
        let expense = 0
        let ccPayments = 0
        transactions.forEach(t => {
            if (t.type === 'income') income += Number(t.amount)
            else if (t.type === 'expense') expense += Number(t.amount)
            else if (isCardPayment(t)) {
                ccPayments += Number(t.amount)
            }
        })
        const totalOutflow = expense + ccPayments
        const monthlySavings = income - totalOutflow
        const savingsRate = income > 0 ? (monthlySavings / income) * 100 : 0
        return { income, expense, ccPayments, totalOutflow, monthlySavings, savingsRate, bankBalance }
    }, [transactions, bankBalance, cardAccountIds])

    const categoryData = useMemo(() => {
        const categories: Record<string, { name: string, value: number, color: string }> = {}
        transactions.filter(t => t.type === 'expense').forEach(t => {
            const catName = t.categories?.name || 'Diğer'
            const catColor = t.categories?.color || '#94a3b8'
            if (!categories[catName]) {
                categories[catName] = { name: catName, value: 0, color: catColor }
            }
            categories[catName].value += Number(t.amount)
        })
        return Object.values(categories).sort((a, b) => b.value - a.value)
    }, [transactions])

    const trendData = useMemo(() => {
        const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
        const days = Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1
            return {
                day: day,
                income: 0,
                expense: 0
            }
        })

        transactions.forEach(t => {
            const day = new Date(t.transaction_date).getDate()
            if (day <= daysInMonth) {
                if (t.type === 'income') days[day - 1].income += Number(t.amount)
                else if (t.type === 'expense') days[day - 1].expense += Number(t.amount)
                else if (isCardPayment(t)) {
                    days[day - 1].expense += Number(t.amount)
                }
            }
        })

        return days
    }, [transactions, currentDate, cardAccountIds])

    const topExpenses = useMemo(() => {
        return [...transactions]
            .filter(t => t.type === 'expense')
            .sort((a, b) => Number(b.amount) - Number(a.amount))
            .slice(0, 5)
    }, [transactions])

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount)
    }

    const changeMonth = (offset: number) => {
        const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1)
        setCurrentDate(newDate)
    }

    const monthName = currentDate.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })

    return (
        <div className="flex flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header with Month Selector */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">Raporlar & Analiz</h1>
                    <p className="text-muted-foreground font-medium">Finansal röntgeninizi çekin ve geleceği planlayın.</p>
                </div>

                <div className="flex items-center gap-2 bg-muted/30 p-1.5 rounded-2xl border border-border/40 backdrop-blur-sm">
                    <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} className="rounded-xl hover:bg-background shadow-sm">
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div className="px-4 font-black text-sm tracking-tight min-w-[140px] text-center">
                        {monthName}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} className="rounded-xl hover:bg-background shadow-sm">
                        <ChevronRight className="h-5 w-5" />
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="rounded-[2rem] border-border/40 bg-card/50 backdrop-blur-xl shadow-2xl shadow-black/5 overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 bg-emerald-500/10 rounded-2xl text-emerald-600">
                                <TrendingUp className="w-5 h-5" />
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Aylık Gelir</div>
                        </div>
                        <h3 className="text-2xl font-black tracking-tighter text-emerald-600">{formatCurrency(totals.income)}</h3>
                        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold text-emerald-600/70 bg-emerald-500/5 w-fit px-2 py-0.5 rounded-full">
                            <ArrowUpRight className="w-3 h-3" /> Nakit Girişi
                        </div>
                    </CardContent>
                </Card>

                <Card className="rounded-[2rem] border-border/40 bg-card/50 backdrop-blur-xl shadow-2xl shadow-black/5 overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 bg-destructive/10 rounded-2xl text-destructive">
                                <TrendingDown className="w-5 h-5" />
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Toplam Gider</div>
                        </div>
                        <h3 className="text-2xl font-black tracking-tighter text-destructive">{formatCurrency(totals.totalOutflow)}</h3>
                        <div className="mt-2 space-y-1">
                            <div className="flex items-center gap-1.5 text-[9px] font-bold text-destructive/70 bg-destructive/5 w-fit px-2 py-0.5 rounded-full">
                                <ArrowDownRight className="w-3 h-3" /> Harcamalar: {formatCurrency(totals.expense)}
                            </div>
                            {totals.ccPayments > 0 && (
                                <div className="flex items-center gap-1.5 text-[9px] font-bold text-blue-600/70 bg-blue-500/5 w-fit px-2 py-0.5 rounded-full">
                                    <ArrowDownRight className="w-3 h-3" /> Kart Ödemeleri: {formatCurrency(totals.ccPayments)}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="rounded-[2rem] border-border/40 bg-card/50 backdrop-blur-xl shadow-2xl shadow-black/5 overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 bg-primary/10 rounded-2xl text-primary">
                                <Wallet className="w-5 h-5" />
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Bütçe Fazlası</div>
                        </div>
                        <h3 className={`text-2xl font-black tracking-tighter ${totals.bankBalance >= 0 ? 'text-primary' : 'text-destructive'}`}>
                            {formatCurrency(Math.abs(totals.bankBalance))}
                        </h3>
                        <div className={`mt-2 flex items-center gap-1.5 text-[10px] font-bold w-fit px-2 py-0.5 rounded-full ${totals.bankBalance >= 0 ? 'text-primary/70 bg-primary/5' : 'text-destructive/70 bg-destructive/5'}`}>
                            {totals.bankBalance >= 0 ? 'Kullanılabilir Nakit' : 'Bütçe Açığı (Genel)'}
                        </div>
                    </CardContent>
                </Card>

                <Card className="rounded-[2rem] border-border/40 bg-card/50 backdrop-blur-xl shadow-2xl shadow-black/5 overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2.5 bg-amber-500/10 rounded-2xl text-amber-600">
                                <Target className="w-5 h-5" />
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Tasarruf Oranı</div>
                        </div>
                        <h3 className="text-2xl font-black tracking-tighter text-amber-600">%{Math.round(totals.savingsRate)}</h3>
                        <div className="mt-2 text-[10px] font-medium text-muted-foreground">
                            {totals.savingsRate > 20 ? 'Harika gidiyorsun! 🚀' : totals.savingsRate > 0 ? 'Daha iyi olabilir. 📈' : 'Bütçeni gözden geçir. ⚠️'}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Section */}
            <div className="grid gap-8 lg:grid-cols-2">
                {/* 1. Category Distribution (Pie) */}
                <Card className="rounded-[2.5rem] border-border/40 bg-card/30 backdrop-blur-xl shadow-2xl shadow-black/5 overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                                <PieIcon className="w-5 h-5 text-primary" /> Kategori Dağılımı
                            </CardTitle>
                            <CardDescription className="text-[11px] font-bold uppercase tracking-wider">Harcamaların Yüzdesi</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full mt-4">
                            {isLoading ? (
                                <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/20" /></div>
                            ) : categoryData.length > 0 ? (
                                <ClientOnly>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={categoryData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={70}
                                                outerRadius={100}
                                                paddingAngle={5}
                                                dataKey="value"
                                                stroke="none"
                                            >
                                                {categoryData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.8} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '1rem', border: '1px solid hsl(var(--border))', fontWeight: 'bold' }}
                                                formatter={(value: any) => formatCurrency(Number(value))}
                                            />
                                            <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingTop: '20px' }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </ClientOnly>
                            ) : (
                                <div className="h-full flex items-center justify-center text-sm text-muted-foreground opacity-50 font-bold">Veri bulunamadı.</div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* 3. Investment Comparison (New Card) */}
                <Card className="rounded-[2.5rem] border-border/40 bg-gradient-to-br from-card to-muted/20 backdrop-blur-xl shadow-2xl shadow-black/5 overflow-hidden">
                    <CardHeader>
                        <CardTitle className="text-xl font-black flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-emerald-500" /> Yatırım Analizi
                        </CardTitle>
                        <CardDescription className="text-[11px] font-black uppercase tracking-widest">Fon ve Varlık Performansı</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 rounded-3xl bg-emerald-500/5 border border-emerald-500/10">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">En İyi Fon</span>
                                <p className="font-black text-emerald-600">Altın Hesabı</p>
                                <p className="text-xl font-black mt-2 text-emerald-500">+%32.4</p>
                            </div>
                            <div className="p-4 rounded-3xl bg-amber-500/5 border border-amber-500/10">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Enflasyon Bekl.</span>
                                <p className="font-black text-amber-600">Reel Getiri</p>
                                <p className="text-xl font-black mt-2 text-amber-500">-%2.1</p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Kıyaslama Paneli</p>
                            <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/40 group cursor-pointer hover:bg-muted/60 transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center font-bold text-xs shadow-sm">AU</div>
                                    <span className="text-xs font-black">Gram Altın</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-xs font-black text-emerald-500">₺2.940</span>
                                    <span className="text-[9px] block font-bold text-muted-foreground">▲ %1.2</span>
                                </div>
                            </div>
                            <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/40 group cursor-pointer hover:bg-muted/60 transition-colors text-muted-foreground opacity-60">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center font-bold text-xs shadow-sm">US</div>
                                    <span className="text-xs font-black">ABD Doları</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-xs font-black">₺34.12</span>
                                    <span className="text-[9px] block font-bold">▼ %0.1</span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
                {/* 2. Income vs Expense Trend (Area) */}
                <Card className="rounded-[2.5rem] border-border/40 bg-card/30 backdrop-blur-xl shadow-2xl shadow-black/5 overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-primary" /> Nakit Akışı Trendi
                            </CardTitle>
                            <CardDescription className="text-[11px] font-bold uppercase tracking-wider">Günlük Gelir/Gider Karşılaştırması</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full mt-4">
                            {isLoading ? (
                                <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/20" /></div>
                            ) : (
                                <ClientOnly>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={trendData}>
                                            <defs>
                                                <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', opacity: 0.5 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', opacity: 0.5 }} hide />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '1rem', border: '1px solid hsl(var(--border))', fontWeight: 'bold' }}
                                                formatter={(value: any) => formatCurrency(Number(value))}
                                            />
                                            <Area type="monotone" dataKey="income" name="Gelir" stroke="#10b981" fillOpacity={1} fill="url(#colorIncome)" strokeWidth={3} />
                                            <Area type="monotone" dataKey="expense" name="Gider" stroke="#ef4444" fillOpacity={1} fill="url(#colorExpense)" strokeWidth={3} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </ClientOnly>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <div className="grid gap-8 lg:grid-cols-2">
                    {/* 1. Top Consuming Categories List */}
                    <Card className="rounded-[2.5rem] border-border/40 bg-card/30 backdrop-blur-xl shadow-2xl shadow-black/5 overflow-hidden">
                        <CardHeader>
                            <CardTitle className="text-xl font-black tracking-tight">Kategori Özeti</CardTitle>
                            <CardDescription className="text-[11px] font-bold uppercase tracking-wider">Harcama Yoğunluğu</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {categoryData.length > 0 ? categoryData.map((cat, i) => (
                                    <div key={i} className="flex items-center justify-between group/cat p-2 -mx-2 rounded-2xl hover:bg-muted/10 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm text-white shadow-lg" style={{ backgroundColor: cat.color }}>
                                                {cat.name[0]}
                                            </div>
                                            <div>
                                                <p className="font-black tracking-tight text-sm">{cat.name}</p>
                                                <div className="w-32 bg-muted/20 h-1.5 rounded-full mt-1 overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full opacity-60"
                                                        style={{ backgroundColor: cat.color, width: `${(cat.value / totals.expense) * 100}%` }}
                                                    ></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black text-sm">{formatCurrency(cat.value)}</p>
                                            <p className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase mt-0.5">
                                                %{Math.round((cat.value / totals.expense) * 100)} GİDER
                                            </p>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="text-center py-8 text-muted-foreground font-medium italic opacity-50">Henüz harcama verisi yok.</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* 2. Biggest Spendings List */}
                    <Card className="rounded-[2.5rem] border-border/40 bg-card/30 backdrop-blur-xl shadow-2xl shadow-black/5 overflow-hidden">
                        <CardHeader>
                            <CardTitle className="text-xl font-black tracking-tight">En Büyük Harcamalar</CardTitle>
                            <CardDescription className="text-[11px] font-bold uppercase tracking-wider">Bu Ayın Zirveleri</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {topExpenses.length > 0 ? topExpenses.map((t, i) => (
                                    <div key={t.id} className="flex items-center justify-between p-3 rounded-2xl bg-muted/5 border border-border/10">
                                        <div className="flex items-center gap-3">
                                            <div className="flex flex-col items-center justify-center w-10 h-10 rounded-xl bg-background shadow-inner border border-border/5">
                                                <span className="text-[10px] font-black leading-none opacity-40">{new Date(t.transaction_date).getDate()}</span>
                                                <span className="text-[8px] font-bold uppercase tracking-tighter opacity-30">{new Date(t.transaction_date).toLocaleDateString('tr-TR', { month: 'short' })}</span>
                                            </div>
                                            <div>
                                                <p className="font-black text-xs tracking-tight">{t.description || t.categories?.name || 'İşlem'}</p>
                                                <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest">{t.categories?.name || 'Kategorisiz'}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black text-sm text-destructive tracking-tighter">-{formatCurrency(Number(t.amount))}</p>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="text-center py-8 text-muted-foreground font-medium italic opacity-50">Henüz harcama kaydı yok.</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
