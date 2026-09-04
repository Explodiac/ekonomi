"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CreditCard, Calendar, AlertCircle, TrendingUp, CheckCircle2, Loader2, X, ArrowRightLeft, Wallet, PieChart, Timer, ChevronDown, ChevronUp, Edit, Settings, History } from "lucide-react"
import { AccountModal } from "@/components/accounts/AccountModal"
import { TransactionList, Transaction } from "@/components/transactions/TransactionList"
import { TransactionModal } from "@/components/transactions/TransactionModal"
import { calculateCashDate } from "@/lib/cash-date"
import { computeInterest } from "@/lib/interest"
import { deriveAccountBalances, transactionEffect, today } from "@/lib/balance"
import { LoanModal } from "@/components/loans/LoanModal"
import { Landmark } from "lucide-react"
import { PrimaryButton } from "@/components/ui/primary-button"

type Account = {
    id: string;
    name: string;
    type: string;
    balance: number;
    opening_balance: number;
    currency: string;
    credit_limit: number;
    cut_date?: number;
    due_date?: number;
    interest_rate?: number | null;
}

type Installment = {
    id: string;
    description: string;
    total_amount: number;
    installments_count: number;
    start_date: string;
    account_id: string;
    payments: InstallmentPayment[];
}

type InstallmentPayment = {
    id: string;
    amount: number;
    installment_number: number;
    payment_date: string;
    status: 'pending' | 'paid';
    transaction_id?: string;
}

export default function CreditCardsPage() {
    const [cards, setCards] = useState<Account[]>([])
    // Saklanan balance yerine hareketlerden türetilen bakiyeler (bkz. lib/balance.ts)
    const [derivedBalances, setDerivedBalances] = useState<Map<string, number>>(new Map())
    const [loans, setLoans] = useState<any[]>([])
    const [isLoanModalOpen, setIsLoanModalOpen] = useState(false)
    const [allAccounts, setAllAccounts] = useState<Account[]>([])
    const [installments, setInstallments] = useState<Installment[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
    const [selectedCard, setSelectedCard] = useState<Account | null>(null)
    const [editingCard, setEditingCard] = useState<Account | null>(null)
    const [paymentAmount, setPaymentAmount] = useState("")
    const [sourceAccountId, setSourceAccountId] = useState("")
    const [categories, setCategories] = useState<any[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [expandedCard, setExpandedCard] = useState<string | null>(null)
    const [cardTransactions, setCardTransactions] = useState<Transaction[]>([])
    const [isTxLoading, setIsTxLoading] = useState(false)
    const [isTxModalOpen, setIsTxModalOpen] = useState(false)
    const [editingTx, setEditingTx] = useState<Transaction | null>(null)
    const [txModalType, setTxModalType] = useState<'income' | 'expense' | 'transfer'>('expense')

    const fetchData = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return

            // Fetch accounts
            const { data: accData, error: accError } = await supabase
                .from('accounts')
                .select('*')
                .eq('household_id', hhId)

            if (accError) throw accError

            const accounts = accData as Account[]
            const creditCards = accounts.filter(a => a.type === 'credit_card')
            setCards(creditCards)
            setAllAccounts(accounts.filter(a => a.type !== 'credit_card'))

            // Kart borcu saklanan balance'tan değil hareketlerden türetiliyor:
            // gelecek tarihli taksitler bugünün borcuna karışmamalı.
            const { data: allTxForBalance } = await supabase
                .from('transactions')
                .select('account_id, amount, type, cash_date')
                .eq('household_id', hhId)

            setDerivedBalances(deriveAccountBalances(accounts, allTxForBalance || []))

            if (accounts.filter(a => a.type !== 'credit_card').length > 0) {
                setSourceAccountId(accounts.filter(a => a.type !== 'credit_card')[0].id)
            }

            // Fetch installments (sadece kart taksitleri — krediler ayrı listeleniyor)
            if (creditCards.length > 0) {
                const { data: instData, error: instError } = await supabase
                    .from('installments')
                    .select('*, installment_payments(*)')
                    .in('account_id', creditCards.map(c => c.id))
                    .eq('kind', 'kart_taksidi')
                    .order('created_at', { ascending: false })

                if (instError) throw instError

                if (instData) {
                    setInstallments(instData.map((inst: any) => ({
                        ...inst,
                        payments: inst.installment_payments || []
                    })))
                }
            }

            // Banka kredileri: aynı tablo, kind='kredi'
            const { data: loanData, error: loanError } = await supabase
                .from('installments')
                .select('*, installment_payments(*)')
                .eq('household_id', hhId)
                .eq('kind', 'kredi')
                .order('created_at', { ascending: false })

            if (loanError) throw loanError
            setLoans((loanData || []).map((l: any) => ({ ...l, payments: l.installment_payments || [] })))

            // Fetch categories for payment tagging
            const { data: catData } = await supabase
                .from('categories')
                .select('*')
                .eq('household_id', hhId)

            if (catData) setCategories(catData)
        } catch (error: any) {
            console.error("Fetch error:", error)
            alert("Veriler yüklenemedi: " + error.message)
        } finally {
            setIsLoading(false)
        }
    }

    const fetchCardTransactions = async (cardId: string) => {
        setIsTxLoading(true)
        try {
            const { data, error } = await supabase
                .from('transactions')
                .select('*, categories(name)')
                // Transferin hedef bacağı da kendi satırı olduğu için account_id yeterli.
                .eq('account_id', cardId)
                .order('transaction_date', { ascending: false })
                .limit(10)

            if (error) throw error
            setCardTransactions(data || [])
        } catch (error) {
            console.error("Error fetching card transactions:", error)
        } finally {
            setIsTxLoading(false)
        }
    }

    const handleToggleCard = (cardId: string) => {
        if (expandedCard === cardId) {
            setExpandedCard(null)
        } else {
            setExpandedCard(cardId)
            fetchCardTransactions(cardId)
        }
    }

    const handleEditTx = (tx: Transaction) => {
        setEditingTx(tx)
        setTxModalType(tx.type)
        setIsTxModalOpen(true)
    }

    const handleDeleteTx = async (id: string, amount: number) => {
        if (!confirm("Bu işlemi silmek istediğinize emin misiniz?")) return
        try {
            // Transferde (ör. kart ödemesi) iki bacak birlikte silinir — DB trigger
            // karşı bacağı da siler. Saklanan bakiyeyi geri alabilmek için önce okuyoruz.
            const legFields = 'id, account_id, amount, type, transfer_group_id, transfer_direction'
            const { data: target } = await supabase
                .from('transactions').select(legFields).eq('id', id).single()
            if (!target) throw new Error("İşlem bulunamadı")

            let legs = [target]
            if (target.transfer_group_id) {
                const { data: groupLegs } = await supabase
                    .from('transactions').select(legFields)
                    .eq('transfer_group_id', target.transfer_group_id)
                if (groupLegs?.length) legs = groupLegs
            }

            const { error } = await supabase.from('transactions').delete().eq('id', id)
            if (error) throw error

            for (const leg of legs) {
                if (!leg.account_id) continue
                const { data: acc } = await supabase.from('accounts').select('balance').eq('id', leg.account_id).single()
                if (!acc) continue
                await supabase.from('accounts')
                    .update({ balance: Number(acc.balance) - transactionEffect(leg) })
                    .eq('id', leg.account_id)
            }

            const deletedIds = new Set(legs.map(l => l.id))
            setCardTransactions(prev => prev.filter(t => !deletedIds.has(t.id)))
            fetchData() // Refresh cards and balances
        } catch (error: any) {
            alert("Hata: " + error.message)
        }
    }

    useEffect(() => {
        fetchData()
    }, [])

    const handlePayment = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedCard || !sourceAccountId || !paymentAmount) return

        setIsSubmitting(true)
        try {
            const amount = parseFloat(paymentAmount)
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı")

            const hhId = await ensureHouseholdExists(user.id)

            // 1. Transaction: Single Transfer to credit card (reduces debt)
            // Use 'transfer' type with category_id to ensure it shows in history but stays out of budget
            const creditCardCategory = categories.find(c => c.name === 'Kredi Kartı Ödemesi' || c.name === 'Borç Ödemesi')

            // Kart ödemesi de bir transfer: banka hesabından çıkar, karta girer.
            // İki bacak tek insert çağrısında yazılıyor — biri başarısız olursa hiçbiri yazılmaz.
            const groupId = crypto.randomUUID()
            const common = {
                household_id: hhId,
                user_id: user.id,
                amount: amount,
                type: 'transfer',
                category_id: creditCardCategory?.id || null,
                transaction_date: new Date().toISOString(),
                description: `${selectedCard.name} Kart Ödemesi`,
                transfer_group_id: groupId,
            }

            const { error: txError } = await supabase.from('transactions').insert([
                {
                    ...common,
                    account_id: sourceAccountId,
                    cash_date: calculateCashDate(new Date(), allAccounts.find(a => a.id === sourceAccountId)),
                    transfer_direction: 'out',
                },
                {
                    ...common,
                    account_id: selectedCard.id,
                    // Ödemenin karta ulaşması ekstre dönemine bağlı değil, aynı gün düşer.
                    cash_date: calculateCashDate(new Date(), null),
                    transfer_direction: 'in',
                },
            ])
            if (txError) throw txError

            // 3. Update source balance
            const sourceAcc = allAccounts.find(a => a.id === sourceAccountId)
            if (sourceAcc) {
                await supabase.from('accounts').update({ balance: sourceAcc.balance - amount }).eq('id', sourceAccountId)
            }

            // 4. Update card balance
            await supabase.from('accounts').update({ balance: selectedCard.balance + amount }).eq('id', selectedCard.id)

            alert("Ödeme başarıyla kaydedildi!")
            setIsPaymentModalOpen(false)
            setPaymentAmount("")
            fetchData()
        } catch (error: any) {
            alert("İşlem başarısız: " + error.message)
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDeleteInstallment = async (installment: Installment) => {
        if (!confirm(`'${installment.description}' taksitli harcamasını ve tüm bağlı taksit işlemlerini silmek istediğinize emin misiniz? Bu işlem kart limitinizi de düzeltecektir.`)) return

        setIsLoading(true)
        try {
            // 1. Get all transaction IDs from payments
            const txIds = installment.payments
                .map(p => p.transaction_id)
                .filter(id => id !== null)

            // 2. Delete transactions
            if (txIds.length > 0) {
                const { error: txError } = await supabase
                    .from('transactions')
                    .delete()
                    .in('id', txIds)
                if (txError) throw txError
            }

            // 3. Delete installment (cascades to installment_payments)
            const { error: instError } = await supabase
                .from('installments')
                .delete()
                .eq('id', installment.id)
            if (instError) throw instError

            // 4. Revert balance (add back the total amount)
            const card = cards.find(c => c.id === installment.account_id)
            if (card) {
                const { error: accError } = await supabase
                    .from('accounts')
                    .update({ balance: Number(card.balance) + Number(installment.total_amount) })
                    .eq('id', card.id)
                if (accError) throw accError
            }

            alert("Taksit başarıyla silindi!")
            fetchData()
        } catch (error: any) {
            alert("Silme hatası: " + error.message)
        } finally {
            setIsLoading(false)
        }
    }

    const handleDeleteCard = async (card: Account) => {
        if (!confirm(`'${card.name}' kredi kartını silmek istediğinize emin misiniz? Bu işlem karta bağlı tüm harcamaları, taksitleri ve ödeme geçmişini KALICI OLARAK silecektir.`)) return

        setIsLoading(true)
        try {
            // 1. Delete all installment payments related to installments of this card
            const cardInstallments = installments.filter(i => i.account_id === card.id)
            const instIds = cardInstallments.map(i => i.id)

            if (instIds.length > 0) {
                const { error: pError } = await supabase
                    .from('installment_payments')
                    .delete()
                    .in('installment_id', instIds)
                if (pError) throw pError

                // 2. Delete installments
                const { error: instError } = await supabase
                    .from('installments')
                    .delete()
                    .in('id', instIds)
                if (instError) throw instError
            }

            // 3. Delete all transactions associated with this card
            const { error: txError } = await supabase
                .from('transactions')
                .delete()
                .eq('account_id', card.id)
            if (txError) throw txError

            // 4. Delete the account itself
            const { error: accError } = await supabase
                .from('accounts')
                .delete()
                .eq('id', card.id)
            if (accError) throw accError

            alert("Kredi kartı ve tüm bağlı veriler başarıyla silindi.")
            fetchData()
        } catch (error: any) {
            console.error("Delete error:", error)
            alert("Silme işlemi başarısız: " + error.message)
        } finally {
            setIsLoading(false)
        }
    }

    const formatCurrency = (amount: number, currency: string = 'TRY') => {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(amount)
    }

    const balanceOf = (acc: Account) => derivedBalances.get(acc.id) ?? Number(acc.balance)

    const totalDebt = cards.reduce((sum, card) => sum + Math.max(0, -balanceOf(card)), 0)
    const totalLimit = cards.reduce((sum, card) => sum + (Number(card.credit_limit) || 0), 0)

    const calculateMinimumPayment = (limit: number, debt: number) => {
        if (debt <= 0) return 0
        const ratio = limit <= 25000 ? 0.20 : 0.40
        return debt * ratio
    }

    const calculateInterestEstimate = (debt: number, isLate: boolean) => {
        if (debt <= 0) return 0

        // BDDK 2026 Rates (Monthly)
        let rate = 0
        if (debt < 30000) {
            rate = isLate ? 0.0355 : 0.0325
        } else if (debt < 180000) {
            rate = isLate ? 0.0405 : 0.0375
        } else {
            rate = isLate ? 0.0455 : 0.0425
        }

        return debt * rate
    }

    const handleRollover = async (card: Account, interestAmount: number) => {
        if (!confirm(`${card.name} için ${formatCurrency(interestAmount)} tutarında faiz işleterek borcu bir sonraki aya devretmek istediğinize emin misiniz?`)) return

        setIsSubmitting(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı")

            const hhId = await ensureHouseholdExists(user.id)

            // 1. Create Interest Transaction
            const { error: txError } = await supabase.from('transactions').insert([{
                household_id: hhId,
                account_id: card.id,
                user_id: user.id,
                amount: interestAmount,
                type: 'expense',
                transaction_date: new Date().toISOString(),
                cash_date: calculateCashDate(new Date(), card),
                description: `Kredi Kartı Faiz İşletimi (BDDK 2026)`
            }])

            if (txError) throw txError

            // 2. Update card balance (Available limit decreases further by adding interest as debt)
            const { error: accError } = await supabase
                .from('accounts')
                .update({ balance: Number(card.balance) - interestAmount })
                .eq('id', card.id)

            if (accError) throw accError

            alert("Borç başarıyla devredildi ve faiz işletildi!")
            fetchData()
        } catch (error: any) {
            alert("İşlem başarısız: " + error.message)
        } finally {
            setIsSubmitting(false)
        }
    }

    const getStatementDates = (cutDay: number | null | undefined, dueDay: number | null | undefined) => {
        if (!cutDay || !dueDay) return { cut: "-", due: "-", status: "normal" }

        const now = new Date()
        const currentMonth = now.getMonth()
        const currentYear = now.getFullYear()

        let cutDate = new Date(currentYear, currentMonth, cutDay)
        let dueDate = new Date(currentYear, currentMonth, dueDay)

        if (dueDay < cutDay) {
            dueDate.setMonth(dueDate.getMonth() + 1)
        }

        const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
        const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        let status = "normal"
        if (diffDays < 0) status = "danger"
        else if (diffDays <= 5) status = "warning"

        return {
            cut: cutDate.toLocaleDateString('tr-TR', options),
            due: dueDate.toLocaleDateString('tr-TR', options),
            status,
            diffDays
        }
    }

    // Calculate this month's installment total
    const currentMonthStr = new Date().toISOString().substring(0, 7) // "YYYY-MM"
    const thisMonthInstallmentsTotal = installments.reduce((sum, inst) => {
        const thisMonthPayment = inst.payments.find(p => p.payment_date.startsWith(currentMonthStr))
        return sum + (thisMonthPayment ? thisMonthPayment.amount : 0)
    }, 0)

    return (
        <div className="flex flex-col gap-[var(--s3)] pb-10">
            <div className="mb-[var(--s1)] space-y-1">
                <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Kredi Kartları</h1>
                <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Ekstre takibi, asgari ödemeler ve taksitli harcamalar.</p>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-32">
                    <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} />
                </div>
            ) : (
                <>
                    {/* Özet — sade satırlar, renk yok, ince ayraçla */}
                    <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                        <div className="flex flex-col gap-[var(--s3)]">
                            <div className="flex items-baseline justify-between">
                                <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Toplam borç</span>
                                <span className="tnum" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{formatCurrency(totalDebt)}</span>
                            </div>
                            <div className="h-px" style={{ background: 'var(--border)' }} />
                            <div className="flex items-baseline justify-between">
                                <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Bu ayki taksitler</span>
                                <span className="tnum" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{formatCurrency(thisMonthInstallmentsTotal)}</span>
                            </div>
                            <div className="h-px" style={{ background: 'var(--border)' }} />
                            <div className="flex items-baseline justify-between">
                                <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Kullanılabilir limit</span>
                                <span className="tnum" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{formatCurrency(totalLimit - totalDebt)}</span>
                            </div>
                        </div>
                    </section>

                    {/* Kredi Kartı Detayları — sade satırlar */}
                    <div className="flex flex-col gap-[var(--s3)]">
                        {cards.length === 0 ? (
                            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                                <p style={{ fontSize: 14.5, color: 'var(--ink-3)' }} className="mb-[var(--s3)]">Henüz kayıtlı kredi kartı yok.</p>
                                <a href="/accounts" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--accent)' }}>Hesaplar sayfasından ekle</a>
                            </section>
                        ) : (
                            cards.map((card) => {
                                const debt = Math.max(0, -balanceOf(card))
                                const asgari = calculateMinimumPayment(Number(card.credit_limit), debt)
                                const usagePercent = Number(card.credit_limit) > 0 ? Math.min((debt / Number(card.credit_limit)) * 100, 100) : 0
                                const dates = getStatementDates(card.cut_date, card.due_date)
                                const cardInstallments = installments.filter(i => i.account_id === card.id)
                                const isOpen = expandedCard === card.id

                                return (
                                    <section key={card.id} style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                                        {/* Sade kart satırı — dashboard hesap satırı dili */}
                                        <div onClick={() => handleToggleCard(card.id)} className="cursor-pointer p-[22px]">
                                            <div className="flex items-start justify-between">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-[var(--s2)]">
                                                        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{card.name}</span>
                                                        <ChevronDown className="h-[14px] w-[14px] transition-transform" style={{ color: 'var(--ink-3)', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                                                    </div>
                                                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Kredi Kartı</div>
                                                </div>
                                                <div className="flex items-center gap-[var(--s1)]">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setEditingCard(card); setIsAccountModalOpen(true) }}
                                                        className="p-2 transition-colors icon-btn" title="Düzenle"
                                                    >
                                                        <Settings className="h-[16px] w-[16px]" />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteCard(card) }}
                                                        className="p-2 transition-colors icon-btn" title="Kartı Sil"
                                                    >
                                                        <X className="h-[16px] w-[16px]" />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Limit kullanım oranı — ince çubuk */}
                                            <div className="mt-[var(--s4)]">
                                                <div className="flex items-baseline justify-between mb-[var(--s2)]">
                                                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Güncel borç</span>
                                                    <span className="tnum" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                                                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{formatCurrency(debt)}</span> · %{Math.round(usagePercent)}
                                                    </span>
                                                </div>
                                                <div className="h-[6px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                                                    <div className="h-full" style={{ width: `${usagePercent}%`, background: 'var(--ink)', borderRadius: 'var(--r-bar)' }} />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Açılır detay */}
                                        {isOpen && (
                                            <div className="px-[22px] pb-[22px] space-y-[var(--s4)]" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s4)' }}>
                                                <div className="flex justify-between">
                                                    <div>
                                                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Kesim tarihi</div>
                                                        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{dates.cut}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Son ödeme</div>
                                                        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{dates.due}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Asgari ödeme</div>
                                                        <div className="tnum" style={{ fontSize: 14, color: 'var(--ink)' }}>{formatCurrency(asgari)}</div>
                                                    </div>
                                                </div>

                                                {/* Asgari ödeme tuzağı — borç kaç ayda kapanır / kapanmaz. */}
                                                {debt > 0 && (() => {
                                                    const minPct = Number(card.credit_limit) <= 25000 ? 20 : 40
                                                    const sc = card.interest_rate != null
                                                        ? computeInterest({
                                                            accounts: [{ id: card.id, type: 'credit_card', balance: balanceOf(card), interest_rate: card.interest_rate }],
                                                            transactions: [], today: new Date().toISOString().slice(0, 10), minPaymentPct: minPct,
                                                        }).paidByAccount[0]?.minimumPaymentScenario ?? null
                                                        : null
                                                    if (card.interest_rate == null) {
                                                        return (
                                                            <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-3)' }}>
                                                                Kartın yıllık faiz oranını girersen (Düzenle), asgari ödemeyle borcun kaç ayda kapanacağını gösteririm.
                                                            </p>
                                                        )
                                                    }
                                                    if (sc && sc.months == null) {
                                                        // EN KRİTİK UYARI — asgari ödeme faizi karşılamıyor.
                                                        return (
                                                            <div className="p-[var(--s4)]" style={{ background: 'color-mix(in srgb, var(--flow-out) 12%, transparent)', borderRadius: 'var(--r-button)', border: '1px solid color-mix(in srgb, var(--flow-out) 35%, transparent)' }}>
                                                                <p style={{ fontSize: 14, lineHeight: 1.5, fontWeight: 600, color: 'var(--flow-out)' }}>
                                                                    Asgari ödeme bu kartın faizini karşılamıyor — borç asgariyle ödenmez, her ay büyür.
                                                                </p>
                                                            </div>
                                                        )
                                                    }
                                                    if (sc && sc.months != null) {
                                                        return (
                                                            <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                                                                Asgari ödersen bu borç <b className="tnum" style={{ color: 'var(--ink)' }}>{sc.months} ayda</b> kapanır ve{' '}
                                                                <b className="tnum" style={{ color: 'var(--flow-out)' }}>{formatCurrency(sc.totalInterest ?? 0)}</b> faiz ödersin.
                                                            </p>
                                                        )
                                                    }
                                                    return null
                                                })()}

                                                {/* Borç devir faizi */}
                                                {debt > 0 && (
                                                    <div className="flex items-center justify-between" style={{ background: 'var(--bg)', borderRadius: 'var(--r-button)', padding: 'var(--s3) var(--s4)' }}>
                                                        <div>
                                                            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Borç devir faizi</div>
                                                            <div className="tnum" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                                                                {formatCurrency(calculateInterestEstimate(debt, dates.status === 'danger'))}
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleRollover(card, calculateInterestEstimate(debt, dates.status === 'danger'))}
                                                            disabled={isSubmitting}
                                                            style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}
                                                            className="disabled:opacity-40"
                                                        >
                                                            {isSubmitting ? '…' : 'Borcu devret'}
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Taksitler */}
                                                {cardInstallments.length > 0 && (
                                                    <div className="space-y-[var(--s2)]">
                                                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)' }}>Aktif taksitler ({cardInstallments.length})</div>
                                                        {cardInstallments.map((inst) => {
                                                            const paidCount = inst.payments.filter(p => p.status === 'paid').length
                                                            return (
                                                                <div key={inst.id} className="group/inst">
                                                                    <div className="flex items-baseline justify-between">
                                                                        <span style={{ fontSize: 13.5, color: 'var(--ink)' }} className="truncate">{inst.description}</span>
                                                                        <div className="flex items-center gap-[var(--s2)] shrink-0">
                                                                            <span className="tnum" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{paidCount}/{inst.installments_count}</span>
                                                                            <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{formatCurrency(inst.total_amount / inst.installments_count)}</span>
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); handleDeleteInstallment(inst) }}
                                                                                className="opacity-0 group-hover/inst:opacity-100 icon-btn transition-all" title="Taksiti Sil"
                                                                            >
                                                                                <X className="h-[13px] w-[13px]" />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div className="mt-[3px] h-[4px] w-full overflow-hidden" style={{ background: 'var(--fill-track)', borderRadius: 'var(--r-bar)' }}>
                                                                        <div className="h-full" style={{ width: `${(paidCount / inst.installments_count) * 100}%`, background: 'var(--ink-4)', borderRadius: 'var(--r-bar)' }} />
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )}

                                                {debt > 0 ? (
                                                    <PrimaryButton
                                                        onClick={() => { setSelectedCard(card); setIsPaymentModalOpen(true) }}
                                                        className="w-full"
                                                    >
                                                        Borç öde
                                                    </PrimaryButton>
                                                ) : (
                                                    <div style={{ fontSize: 13, color: 'var(--ink-3)' }} className="text-center py-[var(--s2)]">Tamamen ödendi</div>
                                                )}

                                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s4)' }}>
                                                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)' }} className="mb-[var(--s3)]">Son kart hareketleri</div>
                                                    <TransactionList
                                                        transactions={cardTransactions}
                                                        isLoading={isTxLoading}
                                                        onEdit={handleEditTx}
                                                        onDelete={handleDeleteTx}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </section>
                                )
                            })
                        )}
                    </div>

                    {/* Banka Kredileri — kart taksitleriyle aynı tabloda (installments.kind='kredi'). */}
                    <div className="space-y-[var(--s3)]">
                        <div className="flex items-center justify-between">
                            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Banka Kredileri</span>
                            <button onClick={() => setIsLoanModalOpen(true)} style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--accent)' }}>
                                Kredi ekle
                            </button>
                        </div>

                        {loans.length === 0 ? (
                            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                                <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-3)' }}>
                                    Kayıtlı banka kredisi yok. Kredi eklediğinde taksitleri gelecek aylara yazılır
                                    ve yaklaşan yükler görünümüne dahil olur.
                                </p>
                            </section>
                        ) : (
                            <div className="flex flex-col gap-[var(--s3)]">
                                {loans.map(loan => {
                                    const payments = loan.payments || []
                                    const kalan = payments.filter((p: any) => p.payment_date >= today()).length
                                    const aylik = Number(loan.total_amount) / loan.installments_count
                                    const sourceName = allAccounts.find(a => a.id === loan.source_account_id)?.name

                                    return (
                                        <section key={loan.id} style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                                            <div className="mb-[var(--s3)]">
                                                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{loan.description}</div>
                                                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{sourceName || 'Hesap silinmiş'}</div>
                                            </div>
                                            <div className="flex flex-col gap-[var(--s2)]" style={{ fontSize: 14 }}>
                                                <div className="flex justify-between">
                                                    <span style={{ color: 'var(--ink-2)' }}>Aylık ödeme</span>
                                                    <span className="tnum" style={{ fontWeight: 500, color: 'var(--ink)' }}>{formatCurrency(aylik)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span style={{ color: 'var(--ink-2)' }}>Kalan taksit</span>
                                                    <span className="tnum" style={{ fontWeight: 500, color: 'var(--ink)' }}>{kalan} / {loan.installments_count}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span style={{ color: 'var(--ink-2)' }}>Kalan borç</span>
                                                    <span className="tnum" style={{ fontWeight: 500, color: 'var(--ink)' }}>{formatCurrency(kalan * aylik)}</span>
                                                </div>
                                            </div>
                                        </section>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}

            <LoanModal
                isOpen={isLoanModalOpen}
                onClose={() => setIsLoanModalOpen(false)}
                onSuccess={fetchData}
            />

            {/* Borç Ödeme Modal */}
            {isPaymentModalOpen && selectedCard && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-card w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden border border-border/40 animate-in zoom-in-95 duration-300">
                        <div className="flex justify-between items-center p-8 border-b border-border/10 bg-muted/20">
                            <div className="space-y-1">
                                <h2 className="text-xl font-black tracking-tight">Kredi Kartı Ödemesi</h2>
                                <p className="text-xs text-muted-foreground font-medium">{selectedCard.name} borcu kapatılıyor.</p>
                            </div>
                            <button onClick={() => setIsPaymentModalOpen(false)} className="p-3 hover:bg-muted rounded-full transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handlePayment} className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest ml-1 text-muted-foreground">Ödeme Tutarı (₺)</label>
                                    <Input
                                        type="number"
                                        step="any"
                                        required
                                        placeholder="0.00"
                                        autoFocus
                                        value={paymentAmount}
                                        className="h-16 rounded-2xl bg-muted/20 border-border/50 text-2xl font-black text-center"
                                        onChange={(e) => setPaymentAmount(e.target.value)}
                                    />
                                    <div className="flex justify-between px-2">
                                        <button
                                            type="button"
                                            onClick={() => setPaymentAmount(Math.abs(balanceOf(selectedCard)).toString())}
                                            className="text-[10px] font-black text-primary hover:underline uppercase tracking-tight"
                                        >
                                            Bütün Borcu Kapat
                                        </button>
                                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-tight">
                                            Kalan Borç: {formatCurrency(Math.abs(balanceOf(selectedCard)))}
                                        </span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest ml-1 text-muted-foreground">Kaynak Hesap</label>
                                    <select
                                        className="flex h-14 w-full rounded-2xl border border-border/50 bg-muted/20 px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                                        value={sourceAccountId}
                                        required
                                        onChange={(e) => setSourceAccountId(e.target.value)}
                                    >
                                        <option value="" disabled>Hesap Seçin</option>
                                        {allAccounts.map(acc => (
                                            <option key={acc.id} value={acc.id}>
                                                {acc.name} ({formatCurrency(balanceOf(acc), acc.currency)})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center justify-center py-4 text-muted-foreground">
                                <ArrowRightLeft className="w-8 h-8 opacity-20" />
                            </div>

                            <div className="pt-2">
                                <PrimaryButton
                                    type="submit"
                                    disabled={isSubmitting || !sourceAccountId || !paymentAmount}
                                    className="w-full"
                                >
                                    {isSubmitting ? '…' : 'Ödemeyi Tamamla'}
                                </PrimaryButton>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Hesap Düzenleme Modal */}
            <AccountModal
                isOpen={isAccountModalOpen}
                onClose={() => {
                    setIsAccountModalOpen(false)
                    setEditingCard(null)
                }}
                onSuccess={() => {
                    fetchData()
                }}
                account={editingCard}
            />

            <TransactionModal
                isOpen={isTxModalOpen}
                onClose={() => {
                    setIsTxModalOpen(false)
                    setEditingTx(null)
                }}
                type={txModalType}
                initialData={editingTx || undefined}
                onSuccess={() => {
                    if (expandedCard) fetchCardTransactions(expandedCard)
                    fetchData()
                }}
            />
        </div>
    )
}
