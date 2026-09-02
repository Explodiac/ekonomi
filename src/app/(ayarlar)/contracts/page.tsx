"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollText, Plus, Search, Calendar, ArrowDownLeft, Loader2, X, Trash2, Edit2, TrendingUp } from "lucide-react"
import { calculateCashDate } from "@/lib/cash-date"
import { PrimaryButton } from "@/components/ui/primary-button"
import { CategoryTile } from "@/components/dashboard/category-tile"

const TR_MONTHS_CON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
function formatTLcon(n: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(n))} ₺`
}

type ContractPayment = {
    id: string;
    contract_id: string;
    amount: number;
    expected_date: string;
    status: 'pending' | 'paid';
    account_id?: string;
}

type Account = {
    id: string;
    name: string;
    balance: number;
    type?: string;
    cut_date?: number | null;
    due_date?: number | null;
}

type Contract = {
    id: string;
    name: string;
    client_name?: string;
    amount: number;
    frequency: string;
    next_payment_date: string;
    end_date?: string;
    status: string;
    category_id?: string;
    payments?: ContractPayment[];
}

type Category = {
    id: string;
    name: string;
}

export default function ContractsPage() {
    const [contracts, setContracts] = useState<Contract[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [accounts, setAccounts] = useState<Account[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')

    // Form states
    const [name, setName] = useState('')
    const [clientName, setClientName] = useState('')
    const [amount, setAmount] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [frequency, setFrequency] = useState('monthly')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [milestones, setMilestones] = useState<{ amount: string, date: string, account_id: string }[]>([])
    const [editingContractId, setEditingContractId] = useState<string | null>(null)
    const [defaultAccountId, setDefaultAccountId] = useState('')
    const [isActionLoading, setIsActionLoading] = useState(false)

    // Payment Confirmation Modal
    const [isPaymentConfirmOpen, setIsPaymentConfirmOpen] = useState(false)
    const [currentPaymentToConfirm, setCurrentPaymentToConfirm] = useState<ContractPayment | null>(null)
    const [selectedConfirmAccountId, setSelectedConfirmAccountId] = useState('')

    const fetchInitialData = async () => {
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
                .eq('type', 'income')
            setCategories(catData || [])

            // Accounts
            const { data: accData } = await supabase
                .from('accounts')
                .select('id, name, balance, type, cut_date, due_date')
                .eq('household_id', hhId)
            setAccounts(accData || [])

            // Fetch Contracts with their payments
            const { data: conData, error } = await supabase
                .from('contracts')
                .select(`
                    *,
                    payments:contract_payments(*)
                `)
                .eq('household_id', hhId)
                .order('next_payment_date')

            if (error) throw error

            let fetchedContracts = conData || [];

            // Ensure missing payments are generated (up to the current month)
            const newPaymentsToInsert: any[] = [];
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();

            for (const con of fetchedContracts) {
                if (con.frequency !== 'monthly' && con.frequency !== 'yearly') continue;
                if (con.status !== 'active') continue;

                const [sYear, sMonth, sDay] = con.next_payment_date.split('-').map(Number);
                const startDate = new Date(sYear, sMonth - 1, sDay);
                
                let endDate = null;
                if (con.end_date) {
                    const [eYear, eMonth, eDay] = con.end_date.split('-').map(Number);
                    endDate = new Date(eYear, eMonth - 1, eDay);
                }

                const existingDates = new Set((con.payments || []).map((p: any) => p.expected_date));

                const limitDate = new Date();
                limitDate.setFullYear(limitDate.getFullYear() + 2); // 2 yıl (24 ay) ileriye kadar oluştur (end_date yoksa)

                let i = 0;
                while (true) {
                    const d = new Date(sYear, sMonth - 1, sDay);
                    if (con.frequency === 'monthly') {
                        d.setMonth(d.getMonth() + i);
                        if (d.getDate() !== sDay) {
                            d.setDate(0);
                        }
                    } else if (con.frequency === 'yearly') {
                        d.setFullYear(d.getFullYear() + i);
                    }

                    if (endDate && d > endDate) break;
                    
                    if (!endDate && d > limitDate) break;

                    const localISOTime = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                    if (!existingDates.has(localISOTime)) {
                        newPaymentsToInsert.push({
                            contract_id: con.id,
                            amount: con.amount,
                            expected_date: localISOTime,
                            status: 'pending'
                        });
                    }
                    
                    i++;
                    if (i > 1200) break; // fail-safe against infinite loops
                }
            }

            if (newPaymentsToInsert.length > 0) {
                const { error: insertError } = await supabase.from('contract_payments').insert(newPaymentsToInsert);
                if (!insertError) {
                    const { data: refreshedConData } = await supabase
                        .from('contracts')
                        .select('*, payments:contract_payments(*)')
                        .eq('household_id', hhId)
                        .order('next_payment_date');
                    
                    if (refreshedConData) {
                        fetchedContracts = refreshedConData;
                    }
                }
            }

            setContracts(fetchedContracts)
        } catch (error: any) {
            console.error("Error fetching contracts:", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchInitialData()
    }, [])

    const handleAddContract = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsActionLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)

            let contractId = editingContractId

            if (editingContractId) {
                // UPDATE
                const { error: updateError } = await supabase
                    .from('contracts')
                    .update({
                        name,
                        client_name: clientName || null,
                        amount: parseFloat(amount),
                        category_id: categoryId || null,
                        frequency,
                        next_payment_date: frequency === 'once' && milestones.length > 0 ? milestones[0].date : startDate,
                        end_date: endDate || null
                    })
                    .eq('id', editingContractId)
                if (updateError) throw updateError

                // Delete old payments and re-add (safest for milestones)
                await supabase.from('contract_payments').delete().eq('contract_id', editingContractId)
            } else {
                // CREATE
                const { data: contract, error: contractError } = await supabase
                    .from('contracts')
                    .insert({
                        household_id: hhId,
                        name,
                        client_name: clientName || null,
                        amount: parseFloat(amount),
                        category_id: categoryId || null,
                        frequency,
                        next_payment_date: frequency === 'once' && milestones.length > 0 ? milestones[0].date : startDate,
                        end_date: endDate || null,
                        status: 'active'
                    })
                    .select()
                    .single()

                if (contractError) throw contractError
                contractId = contract.id
            }

            // Handle payments/milestones
            if (frequency === 'once' && milestones.length > 0) {
                const mList = milestones.map(m => ({
                    contract_id: contractId,
                    amount: parseFloat(m.amount),
                    expected_date: m.date,
                    account_id: null,
                    status: 'pending'
                }));

                const milestonesSum = milestones.reduce((s, m) => s + parseFloat(m.amount || '0'), 0);
                const totalAmt = parseFloat(amount);

                // If there's an unallocated amount, add it as an "Open Position"
                if (milestonesSum < totalAmt) {
                    mList.push({
                        contract_id: contractId,
                        amount: totalAmt - milestonesSum,
                        expected_date: new Date().toISOString().split('T')[0], // Today
                        account_id: null,
                        status: 'pending'
                    });
                }

                const { error: paymentsError } = await supabase
                    .from('contract_payments')
                    .insert(mList)
                if (paymentsError) throw paymentsError
            } else if (frequency !== 'once') {
                await supabase.from('contract_payments').insert({
                    contract_id: contractId,
                    amount: parseFloat(amount),
                    expected_date: startDate,
                    account_id: null,
                    status: 'pending'
                })
            }

            setIsModalOpen(false)
            resetForm()
            fetchInitialData()
        } catch (error: any) {
            alert("Kontrat kaydedilemedi: " + error.message)
        } finally {
            setIsActionLoading(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Bu kontratı silmek istediğinize emin misiniz?")) return
        try {
            await supabase.from('contracts').delete().eq('id', id)
            setContracts(prev => prev.filter(c => c.id !== id))
        } catch (error) {
            console.error("Delete failed", error)
        }
    }

    const handleEditClick = (con: Contract) => {
        setEditingContractId(con.id)
        setName(con.name)
        setClientName(con.client_name || '')
        setAmount(con.amount.toString())
        setCategoryId(con.category_id || '')
        setFrequency(con.frequency)
        setStartDate(con.next_payment_date)
        setEndDate(con.end_date || '')
        if (con.frequency === 'once' && con.payments) {
            setMilestones(con.payments.map(p => ({
                amount: p.amount.toString(),
                date: p.expected_date,
                account_id: ''
            })))
            setDefaultAccountId('')
        } else {
            setMilestones([]) // Clear milestones if not 'once'
            setDefaultAccountId('')
        }
        setIsModalOpen(true)
    }

    const togglePaymentStatus = async (payment: ContractPayment, currentStatus: string) => {
        if (currentStatus === 'paid') {
            // Simply mark as pending again
            setIsActionLoading(true)
            try {
                const { error } = await supabase
                    .from('contract_payments')
                    .update({ status: 'pending' })
                    .eq('id', payment.id);
                if (error) throw error;
                fetchInitialData();
            } catch (error: any) {
                alert("İşlem başarısız: " + error.message);
            } finally {
                setIsActionLoading(false);
            }
        } else {
            // Open confirmation modal to select account
            setCurrentPaymentToConfirm(payment);
            setSelectedConfirmAccountId('');
            setIsPaymentConfirmOpen(true);
        }
    }

    const handleConfirmPayment = async () => {
        if (!currentPaymentToConfirm || !selectedConfirmAccountId) return;

        setIsActionLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const hhId = await ensureHouseholdExists(user.id);

            // 1. Transaction creation
            const contract = contracts.find(c => c.id === currentPaymentToConfirm.contract_id);
            const { error: transError } = await supabase
                .from('transactions')
                .insert({
                    household_id: hhId,
                    account_id: selectedConfirmAccountId,
                    amount: currentPaymentToConfirm.amount,
                    type: 'income',
                    transaction_date: new Date().toISOString(),
                    cash_date: calculateCashDate(new Date(), accounts.find(a => a.id === selectedConfirmAccountId)),
                    description: `${contract?.name || 'Kontrat'} Ödemesi`,
                    user_id: user.id,
                    source_type: 'contract',
                    source_id: currentPaymentToConfirm.id
                });
            if (transError) throw transError;

            // 2. Update Account Balance
            const targetAccount = accounts.find(a => a.id === selectedConfirmAccountId);
            if (targetAccount) {
                const { error: accError } = await supabase
                    .from('accounts')
                    .update({ balance: targetAccount.balance + currentPaymentToConfirm.amount })
                    .eq('id', selectedConfirmAccountId);
                if (accError) throw accError;
            }

            // 3. Update Payment Status
            const { error: payError } = await supabase
                .from('contract_payments')
                .update({
                    status: 'paid',
                    account_id: selectedConfirmAccountId
                })
                .eq('id', currentPaymentToConfirm.id);
            if (payError) throw payError;

            setIsPaymentConfirmOpen(false);
            setCurrentPaymentToConfirm(null);
            fetchInitialData();
        } catch (error: any) {
            alert("İşlem başarısız: " + error.message);
        } finally {
            setIsActionLoading(false);
        }
    }

    const resetForm = () => {
        setName('')
        setClientName('')
        setAmount('')
        setCategoryId('')
        setFrequency('monthly')
        setStartDate('')
        setEndDate('')
        setMilestones([])
        setEditingContractId(null)
        setDefaultAccountId('')
    }

    const filteredContracts = contracts.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    // Calculate current month's expected income
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const totalPendingIncome = contracts.reduce((sum, con) => {
        const relevantPayments = con.payments?.filter(p => {
            const d = new Date(p.expected_date);
            const isPastPending = p.status === 'pending' && (d.getFullYear() < currentYear || (d.getFullYear() === currentYear && d.getMonth() < currentMonth));
            const isCurrentMonth = d.getMonth() === currentMonth && d.getFullYear() === currentYear && p.status === 'pending';
            return isCurrentMonth || isPastPending;
        }) || [];
        return sum + relevantPayments.reduce((pSum, p) => pSum + Number(p.amount), 0);
    }, 0);

    const totalPaidIncome = contracts.reduce((sum, con) => {
        const paidPayments = con.payments?.filter(p => {
            const d = new Date(p.expected_date);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear && p.status === 'paid';
        }) || [];
        return sum + paidPayments.reduce((pSum, p) => pSum + Number(p.amount), 0);
    }, 0);

    // Calculate projection for next 4 months
    const projection = Array.from({ length: 4 }).map((_, i) => {
        const d = new Date(currentYear, currentMonth + i, 1);
        const monthName = d.toLocaleString('tr-TR', { month: 'short' });
        const month = d.getMonth();
        const year = d.getFullYear();

        const monthTotal = contracts.reduce((sum, con) => {
            // 1. One-time or manually added payments for this month
            const payments = con.payments?.filter(p => {
                const pd = new Date(p.expected_date);
                return pd.getMonth() === month && pd.getFullYear() === year;
            }) || [];
            const manualSum = payments.reduce((pSum, p) => pSum + Number(p.amount), 0);

            // 2. Projected recurring payments
            // If it's a future month and it's monthly/yearly, assume it will happen
            let projectedSum = 0;
            if (i > 0) { // Only for future months
                if (con.frequency === 'monthly') {
                    // Check if it's within start and end dates
                    const startDate = new Date(con.next_payment_date);
                    const endDate = con.end_date ? new Date(con.end_date) : null;
                    const thisProjDate = new Date(year, month, 1);

                    if (thisProjDate >= new Date(startDate.getFullYear(), startDate.getMonth(), 1) && (!endDate || thisProjDate <= endDate)) {
                        // If there's no manual payment record for this month yet, add it
                        if (manualSum === 0) projectedSum = Number(con.amount);
                    }
                }
            }

            return sum + manualSum + projectedSum;
        }, 0);

        return { monthName, total: monthTotal };
    });

    return (
        <div className="flex flex-col gap-[var(--s4)] pb-10">
            <div className="flex items-center justify-between gap-[var(--s3)]">
                <div className="min-w-0">
                    <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Kontratlar</h1>
                    <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Kira, maaş ve marka işbirlikleri — düzenli gelirler.</p>
                </div>
                <PrimaryButton onClick={() => setIsModalOpen(true)}>
                    <Plus className="h-4 w-4" /> Yeni kontrat
                </PrimaryButton>
            </div>

            <div className="grid gap-[var(--s3)] md:grid-cols-4">
                <div className="p-[var(--s4)]" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                    <div className="mb-[var(--s2)] flex items-center justify-between">
                        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Toplam tahsil edilen</span>
                        <ArrowDownLeft className="h-4 w-4" style={{ color: 'var(--flow-in)' }} />
                    </div>
                    <div className="tnum" style={{ fontSize: 22, fontWeight: 700, color: 'var(--flow-in)' }}>
                        ₺{new Intl.NumberFormat('tr-TR').format(totalPaidIncome)}
                    </div>
                    <div className="tnum mt-[var(--s1)]" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        kalan beklenen ₺{new Intl.NumberFormat('tr-TR').format(totalPendingIncome)}
                    </div>
                </div>

                <div className="p-[var(--s4)]" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                    <div className="mb-[var(--s2)] flex items-center justify-between">
                        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Genel beklenen</span>
                        <ScrollText className="h-4 w-4" style={{ color: 'var(--ink-3)' }} />
                    </div>
                    <div className="tnum" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>
                        ₺{new Intl.NumberFormat('tr-TR').format(totalPendingIncome + totalPaidIncome)}
                    </div>
                    <p className="mt-[var(--s1)]" style={{ fontSize: 12, color: 'var(--ink-3)' }}>Tahsil + beklenen</p>
                </div>

                <div className="p-[var(--s4)] md:col-span-2" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                    <div className="mb-[var(--s2)] flex items-center justify-between">
                        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Nakit akışı projeksiyonu</span>
                        <TrendingUp className="h-4 w-4" style={{ color: 'var(--accent)' }} />
                    </div>
                    <div className="flex h-16 items-end gap-2 pt-2">
                            {projection.map((p, i) => {
                                const maxVal = Math.max(...projection.map(x => x.total), 1);
                                const height = (p.total / maxVal) * 100;
                                return (
                                    <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                                        <div className="w-full rounded-t-sm relative flex items-end overflow-hidden h-full" style={{ background: 'var(--fill-track)' }}>
                                            <div
                                                className="w-full transition-all rounded-t-sm"
                                                style={{ height: `${height}%`, background: 'var(--accent)' }}
                                            />
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="tnum text-[10px] font-bold" style={{ color: 'var(--accent)' }}>₺{new Intl.NumberFormat('tr-TR', { notation: 'compact' }).format(p.total)}</span>
                                            <span className="text-[9px] uppercase font-medium" style={{ color: 'var(--ink-4)' }}>{p.monthName}</span>
                                        </div>
                                    </div>
                                )
                            })}
                    </div>
                </div>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
                <input
                    type="search" placeholder="Kontrat veya marka ara…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    className="w-full py-[var(--s3)] pl-9 pr-[var(--s3)] outline-none"
                    style={{ background: 'var(--surface)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 14 }}
                />
            </div>

            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="overflow-hidden">
                {isLoading ? (
                    <div className="flex items-center justify-center py-[var(--s6)]"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
                ) : filteredContracts.length === 0 ? (
                    <p className="px-[22px] py-[var(--s5)]" style={{ fontSize: 14.5, color: 'var(--ink-3)' }}>Kontrat bulunamadı.</p>
                ) : (
                    <ul>
                        {filteredContracts.map((con, i) => {
                            const topPending = (con.payments || []).filter(p => p.status === 'pending').sort((a, b) => new Date(a.expected_date).getTime() - new Date(b.expected_date).getTime());
                            const nextPayment = topPending.length > 0 ? topPending[0] : null;
                            const freq = con.frequency === 'monthly' ? 'Aylık' : con.frequency === 'yearly' ? 'Yıllık' : con.frequency === 'weekly' ? 'Haftalık' : 'Tek seferlik';
                            const overdue = nextPayment && new Date(nextPayment.expected_date) < new Date(new Date().setHours(0, 0, 0, 0));
                            const nd = nextPayment ? new Date(nextPayment.expected_date) : null;
                            return (
                                <li key={con.id} className="group flex items-center gap-[var(--s3)] px-[22px] py-[13px]" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                                    <CategoryTile name={categories.find(c => c.id === con.category_id)?.name || con.name} size={34} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{con.name}</div>
                                        <div className="truncate" style={{ fontSize: 12, color: overdue ? 'var(--flow-out)' : 'var(--ink-3)' }}>
                                            {freq}{con.client_name ? ` · ${con.client_name}` : ''}{nd ? ` · ${overdue ? 'gecikmiş' : `sonraki ${nd.getDate()} ${TR_MONTHS_CON[nd.getMonth()]}`}` : ' · planlı ödeme yok'}
                                        </div>
                                    </div>
                                    <div className="tnum shrink-0 text-right" style={{ fontSize: 14.5, color: 'var(--flow-in)' }}>
                                        {formatTLcon(nextPayment ? nextPayment.amount : con.amount)}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-[var(--s1)]">
                                        {nextPayment && (
                                            <button
                                                onClick={() => togglePaymentStatus(nextPayment, 'pending')}
                                                className="tnum px-[var(--s3)] py-[6px]"
                                                style={{ background: 'color-mix(in srgb, var(--flow-in) 15%, transparent)', color: 'var(--flow-in)', borderRadius: 'var(--r-button)', fontSize: 12.5, fontWeight: 600 }}
                                            >
                                                Tahsil et
                                            </button>
                                        )}
                                        <button onClick={() => handleEditClick(con)} className="icon-btn p-2" title="Düzenle"><Edit2 className="h-4 w-4" /></button>
                                        <button onClick={() => handleDelete(con.id)} className="icon-btn p-2" title="Sil"><Trash2 className="h-4 w-4" /></button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="my-8 w-full max-w-lg overflow-hidden" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                        <div className="flex items-center justify-between p-[var(--s4)]" style={{ borderBottom: '1px solid var(--border)' }}>
                            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                                {editingContractId ? 'Kontratı düzenle' : 'Yeni kontrat / gelir kalemi'}
                            </h2>
                            <button onClick={() => { setIsModalOpen(false); resetForm(); }} className="icon-btn p-1" aria-label="Kapat">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <form onSubmit={handleAddContract} className="p-5 space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Gelir Adı / Hizmet</label>
                                    <Input placeholder="Örn: Yazılım Danışmanlığı..." value={name} onChange={e => setName(e.target.value)} required />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Müşteri / Marka</label>
                                    <Input placeholder="Örn: ABC Teknoloji..." value={clientName} onChange={e => setClientName(e.target.value)} />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Toplam Tutar (₺)</label>
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
                                        <option value="once">Tek Seferlik / Proje</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Kategori</label>
                                    <select
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        value={categoryId}
                                        onChange={e => setCategoryId(e.target.value)}
                                    >
                                        <option value="">Seçin</option>
                                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            {frequency === 'once' ? (
                                <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
                                    <div className="flex items-center justify-between">
                                        <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Ödeme planı</h4>
                                        <button
                                            type="button"
                                            onClick={() => setMilestones([...milestones, { amount: '', date: '', account_id: '' }])}
                                            className="inline-flex items-center gap-1 px-[var(--s2)] py-[4px]"
                                            style={{ background: 'var(--surface-2)', color: 'var(--ink)', borderRadius: 'var(--r-button)', fontSize: 12 }}
                                        >
                                            <Plus className="h-3 w-3" /> Ödeme ekle
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground italic">Tek seferlik projeleri farklı aylara bölebilirsiniz.</p>

                                    <div className="space-y-2 max-h-[150px] overflow-y-auto pr-2">
                                        {milestones.map((m, i) => (
                                            <div key={i} className="flex flex-col gap-2 p-3 bg-muted/20 rounded-md border border-dashed animate-in fade-in slide-in-from-top-1">
                                                <div className="flex gap-2 items-center">
                                                    <Input
                                                        placeholder="Miktar"
                                                        type="number"
                                                        className="h-8 text-xs flex-1"
                                                        value={m.amount}
                                                        onChange={e => {
                                                            const newVal = [...milestones];
                                                            newVal[i].amount = e.target.value;
                                                            setMilestones(newVal);
                                                        }}
                                                    />
                                                    <Input
                                                        type="date"
                                                        className="h-8 text-xs flex-1"
                                                        value={m.date}
                                                        onChange={e => {
                                                            const newVal = [...milestones];
                                                            newVal[i].date = e.target.value;
                                                            setMilestones(newVal);
                                                        }}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="icon-btn p-2"
                                                        style={{ color: 'var(--flow-out)' }}
                                                        onClick={() => setMilestones(milestones.filter((_, idx) => idx !== i))}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {milestones.length === 0 && <p className="text-center text-xs text-muted-foreground p-2">Lütfen en az bir ödeme tarihi ekleyin.</p>}
                                    </div>

                                    <div className="pt-2 border-t flex flex-col gap-1 text-xs">
                                        <div className="flex justify-between items-center font-semibold">
                                            <span style={{ color: 'var(--ink-2)' }}>Planlanan tutar:</span>
                                            <span className="tnum" style={{ color: 'var(--flow-in)' }}>
                                                ₺{new Intl.NumberFormat('tr-TR').format(milestones.reduce((s, m) => s + Number(m.amount), 0))}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-[10px] text-muted-foreground italic">
                                            <span>Kalan (Açık Pozisyon):</span>
                                            <span className="font-bold">
                                                ₺{new Intl.NumberFormat('tr-TR').format(Math.max(0, Number(amount) - milestones.reduce((s, m) => s + Number(m.amount), 0)))}
                                            </span>
                                        </div>
                                        {Number(milestones.reduce((s, m) => s + Number(m.amount), 0)) > Number(amount) && (
                                            <p className="text-[10px] font-bold mt-1" style={{ color: 'var(--flow-out)' }}>Uyarı: Planlanan tutar toplam tutarı aşıyor!</p>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">İlk Ödeme Tarihi</label>
                                            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Bitiş Tarihi (Opsiyonel)</label>
                                            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-end gap-[var(--s2)] pt-[var(--s4)]" style={{ borderTop: '1px solid var(--border)' }}>
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-[var(--s4)] py-[var(--s3)]" style={{ background: 'var(--surface-2)', color: 'var(--ink)', borderRadius: 'var(--r-button)', fontSize: 14 }}>İptal</button>
                                <PrimaryButton type="submit" disabled={isActionLoading || (frequency === 'once' && Number(milestones.reduce((s, m) => s + Number(m.amount), 0)) > Number(amount))}>
                                    {isActionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Kontratı kaydet
                                </PrimaryButton>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Payment Confirmation Modal */}
            {isPaymentConfirmOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="w-full max-w-sm" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                        <div className="space-y-[var(--s4)] p-[var(--s5)]">
                            <div className="flex items-center gap-[var(--s3)]">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--flow-in) 15%, transparent)', color: 'var(--flow-in)' }}>
                                    <ArrowDownLeft className="h-5 w-5" />
                                </div>
                                <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Ödemeyi tahsil et</h3>
                            </div>

                            <div>
                                <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Tahsil edilecek tutar:</p>
                                <p className="tnum" style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)' }}>{formatTLcon(currentPaymentToConfirm?.amount || 0)}</p>
                            </div>

                            <div className="space-y-[var(--s2)]">
                                <label style={{ fontSize: 13, color: 'var(--ink-3)' }}>Paranın yatacağı hesap</label>
                                <select
                                    className="w-full px-[var(--s3)] py-[var(--s3)] outline-none"
                                    style={{ background: 'var(--bg)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 14 }}
                                    value={selectedConfirmAccountId}
                                    onChange={e => setSelectedConfirmAccountId(e.target.value)}
                                >
                                    <option value="">Hesap seçin</option>
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.id}>
                                            {acc.name} (Bakiye: ₺{new Intl.NumberFormat('tr-TR', { notation: 'compact' }).format(acc.balance)})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex gap-[var(--s2)] pt-[var(--s1)]">
                                <button
                                    className="flex-1 px-[var(--s4)] py-[var(--s3)]"
                                    style={{ background: 'var(--surface-2)', color: 'var(--ink)', borderRadius: 'var(--r-button)', fontSize: 14 }}
                                    onClick={() => setIsPaymentConfirmOpen(false)}
                                    disabled={isActionLoading}
                                >
                                    Vazgeç
                                </button>
                                <PrimaryButton
                                    className="flex-1"
                                    onClick={handleConfirmPayment}
                                    disabled={!selectedConfirmAccountId || isActionLoading}
                                >
                                    {isActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hesaba aktar"}
                                </PrimaryButton>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
