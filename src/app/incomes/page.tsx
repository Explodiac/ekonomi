"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowDownLeft, Search, SlidersHorizontal, Plus, Loader2, X, AlertCircle } from "lucide-react"
import { TransactionModal } from "@/components/transactions/TransactionModal"
import { DeleteConfirmModal } from "@/components/ui/DeleteConfirmModal"

type Transaction = {
    id: string;
    account_id: string;
    amount: number;
    transaction_date: string;
    description: string;
    type: string;
    to_account_id?: string;
    accounts?: { name: string };
    categories?: { name: string };
}

export default function IncomesPage() {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [modalType, setModalType] = useState<'income' | 'transfer'>('income')
    const [editingTransaction, setEditingTransaction] = useState<any>(null)
    const [incomes, setIncomes] = useState<Transaction[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

    // Delete state
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [deletingTx, setDeletingTx] = useState<{ id: string, amount: number, account_id: string } | null>(null)
    const [isDeleteLoading, setIsDeleteLoading] = useState(false)

    const fetchIncomes = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return

            const startDate = new Date(selectedYear, selectedMonth - 1, 1).toISOString()
            const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59).toISOString()

            const { data, error } = await supabase
                .from('transactions')
                .select('*, accounts!account_id(name), categories(name)')
                .eq('household_id', hhId)
                .eq('type', 'income')
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate)
                .order('transaction_date', { ascending: false })

            if (error) throw error
            if (data) setIncomes(data as any)

        } catch (error: any) {
            console.error("Error fetching incomes:", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchIncomes()
    }, [selectedMonth, selectedYear])

    const handleDeleteClick = (id: string, amount: number, account_id: string) => {
        setDeletingTx({ id, amount, account_id })
        setIsDeleteModalOpen(true)
    }

    const confirmDelete = async () => {
        if (!deletingTx) return;
        const { id, amount, account_id } = deletingTx;

        setIsDeleteLoading(true);
        try {
            const { error: deleteError } = await supabase.from('transactions').delete().eq('id', id);
            if (deleteError) throw new Error("İşlem silinirken hata oluştu: " + deleteError.message);
            // accounts.balance yazılmaz — bakiye hareketlerden türetilir.

            setIncomes(prev => prev.filter(tx => tx.id !== id));
            setIsDeleteModalOpen(false);
            setDeletingTx(null);
        } catch (e: any) {
            console.error("Delete Exception:", e);
            alert("Silinemedi: " + e.message);
        } finally {
            setIsDeleteLoading(false);
        }
    }

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount)
    }

    return (
        <div className="flex flex-col gap-8 h-full">
            <TransactionModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false)
                    setEditingTransaction(null)
                }}
                type={modalType}
                initialData={editingTransaction}
                onSuccess={() => {
                    fetchIncomes()
                }}
            />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-500">Gelirler</h1>
                    <p className="text-muted-foreground mt-1">Tüm gelir kalemlerinizi buradan yönetin</p>
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
                            className="w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => {
                                setModalType('income')
                                setEditingTransaction(null)
                                setIsModalOpen(true)
                            }}
                        >
                            <Plus className="mr-2 h-4 w-4" /> Gelir Ekle
                        </Button>
                    </div>
                </div>
            </div>

            <Card className="flex-1 flex flex-col overflow-hidden border-t-4 border-t-emerald-500">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-b bg-card">
                    <div className="relative w-full sm:max-w-xs">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input type="search" placeholder="Gelirlerde ara..." className="pl-9 bg-muted/50" />
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button variant="outline" className="w-full sm:w-auto">
                            <SlidersHorizontal className="mr-2 h-4 w-4" /> Filtrele
                        </Button>
                    </div>
                </div>

                <CardContent className="flex-1 p-0 overflow-auto">
                    <div className="w-full">
                        <div className="grid grid-cols-12 gap-4 border-b bg-muted/30 p-4 text-sm font-medium text-muted-foreground">
                            <div className="col-span-6 md:col-span-5">Gelir Kaynağı</div>
                            <div className="hidden md:block col-span-2">Kategori</div>
                            <div className="hidden lg:block col-span-2">Hesap</div>
                            <div className="col-span-6 md:col-span-3 text-right">Tutar</div>
                        </div>

                        {isLoading ? (
                            <div className="flex items-center justify-center p-12">
                                <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
                            </div>
                        ) : incomes.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
                                <p>Henüz gelir eklenmemiş.</p>
                            </div>
                        ) : (
                            <div className="divide-y">
                                {incomes.map((tx) => (
                                    <div key={tx.id} className="group grid grid-cols-12 gap-4 items-center p-4 hover:bg-muted/10 transition-colors">
                                        <div className="col-span-6 md:col-span-5 flex items-center gap-4">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                                                <ArrowDownLeft className="h-4 w-4 text-emerald-500" />
                                            </div>
                                            <div className="overflow-hidden">
                                                <p className="truncate font-medium leading-none">{tx.description || 'Gelir İşlemi'}</p>
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
                                            <p className="font-semibold text-emerald-600 dark:text-emerald-500">
                                                +{formatCurrency(tx.amount)}
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
                                                <button onClick={() => handleDeleteClick(tx.id, tx.amount, tx.account_id)} className="p-1.5 bg-destructive/10 text-destructive hover:bg-destructive hover:text-white rounded-md transition-all">
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

            <DeleteConfirmModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={confirmDelete}
                isLoading={isDeleteLoading}
                title="Gelir Sil"
                description="Bu gelir işlemini silmek istediğinize emin misiniz? Bu işlem hesabınızın bakiyesini etkileyecektir."
            />
        </div>
    )
}
