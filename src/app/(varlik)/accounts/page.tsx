"use client"

import { useState, useEffect } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Loader2, X, ChevronDown, Settings } from "lucide-react"
import { AccountModal } from "@/components/accounts/AccountModal"
import { ReconcileModal } from "@/components/accounts/ReconcileModal"
import { TransactionList, Transaction } from "@/components/transactions/TransactionList"
import { TransactionModal } from "@/components/transactions/TransactionModal"
import { DeleteConfirmModal } from "@/components/ui/DeleteConfirmModal"
import { deriveAccountBalances, transactionEffect } from "@/lib/balance"
import { PageHeader } from "@/components/ui/page-header"
import { PrimaryButton } from "@/components/ui/primary-button"

type Account = {
    id: string;
    name: string;
    type: 'bank' | 'credit_card' | 'investment' | 'cash' | 'esnek_hesap';
    balance: number;
    opening_balance: number;
    currency: string;
    credit_limit: number;
}

export default function AccountsPage() {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingAccount, setEditingAccount] = useState<Account | null>(null)
    const [reconcileAcc, setReconcileAcc] = useState<Account | null>(null)
    const [accounts, setAccounts] = useState<Account[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null)
    const [accountTransactions, setAccountTransactions] = useState<Transaction[]>([])
    const [isTxLoading, setIsTxLoading] = useState(false)
    const [isTxModalOpen, setIsTxModalOpen] = useState(false)
    const [editingTx, setEditingTx] = useState<Transaction | null>(null)
    const [txModalType, setTxModalType] = useState<'income' | 'expense' | 'transfer'>('expense')
    // Bakiye artık saklanan balance'tan değil, hareketlerden türetiliyor (bkz. lib/balance.ts).
    const [derivedBalances, setDerivedBalances] = useState<Map<string, number>>(new Map())

    // Delete Transaction State
    const [isDeleteTxModalOpen, setIsDeleteTxModalOpen] = useState(false)
    const [deletingTx, setDeletingTx] = useState<{ id: string, amount: number, type: string, account_id: string, to_account_id?: string } | null>(null)
    const [isDeleteTxLoading, setIsDeleteTxLoading] = useState(false)

    const fetchAccounts = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) {
                console.warn("No household ID found for user.")
                return
            }

            const { data, error } = await supabase
                .from('accounts')
                .select('*')
                .eq('household_id', hhId)
                .order('created_at', { ascending: false })

            if (data) setAccounts(data)
            if (error) console.error("Supabase Error:", error)

            // Türetilmiş bakiye için hesabın tüm geçmişi gerekiyor.
            const { data: txData } = await supabase
                .from('transactions')
                .select('account_id, amount, type, transaction_date, cash_date, transfer_direction')
                .eq('household_id', hhId)

            if (data) setDerivedBalances(deriveAccountBalances(data, txData || [], { warn: false }))
        } catch (error) {
            console.error("Error fetching accounts:", error)
        } finally {
            setIsLoading(false)
        }
    }

    const balanceOf = (account: Account) =>
        derivedBalances.get(account.id) ?? Number(account.balance)

    useEffect(() => {
        fetchAccounts()
    }, [])

    const fetchAccountTransactions = async (accountId: string) => {
        setIsTxLoading(true)
        try {
            const { data, error } = await supabase
                .from('transactions')
                .select('*, categories(name)')
                // Transferin hedef bacağı da kendi satırı olduğu için account_id yeterli.
                .eq('account_id', accountId)
                .order('transaction_date', { ascending: false })
                .limit(10)

            if (data) setAccountTransactions(data)
            if (error) throw error
        } catch (error) {
            console.error("Error fetching account transactions:", error)
        } finally {
            setIsTxLoading(false)
        }
    }

    const handleToggleAccount = (accountId: string) => {
        if (expandedAccountId === accountId) {
            setExpandedAccountId(null)
        } else {
            setExpandedAccountId(accountId)
            fetchAccountTransactions(accountId)
        }
    }

    const handleEditTx = (tx: Transaction) => {
        setEditingTx(tx)
        setTxModalType(tx.type)
        setIsTxModalOpen(true)
    }

    const handleDeleteTxClick = (id: string, amount: number, type: string, account_id: string, to_account_id?: string) => {
        setDeletingTx({ id, amount, type, account_id, to_account_id })
        setIsDeleteTxModalOpen(true)
    }

    const confirmDeleteTx = async () => {
        if (!deletingTx) return
        const { id } = deletingTx

        setIsDeleteTxLoading(true)
        try {
            // Transferde iki bacak birlikte silinir (DB trigger). Saklanan bakiyeyi geri
            // alabilmek için silmeden ÖNCE ilgili tüm bacakları okuyoruz.
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

            const { error: deleteError } = await supabase.from('transactions').delete().eq('id', id)
            if (deleteError) throw deleteError
            // accounts.balance yazılmaz — bakiye hareketlerden türetilir; silinen hareket otomatik düşer.

            const deletedIds = new Set(legs.map(l => l.id))
            setAccountTransactions(prev => prev.filter(t => !deletedIds.has(t.id)))
            fetchAccounts()
            setIsDeleteTxModalOpen(false)
            setDeletingTx(null)
        } catch (error: any) {
            alert("İşlem silinemedi: " + error.message)
        } finally {
            setIsDeleteTxLoading(false)
        }
    }

    // Esnek hesap (KMH) burada da görünür — aksi halde hiçbir grupta olmayıp kaybolur.
    const bankAndCash = accounts.filter(a => a.type === 'bank' || a.type === 'cash' || a.type === 'esnek_hesap')
    const creditCards = accounts.filter(a => a.type === 'credit_card')
    const investments = accounts.filter(a => a.type === 'investment')

    const totalBankBalance = bankAndCash.reduce((acc, curr) => acc + balanceOf(curr), 0)
    const totalCreditDebt = creditCards.reduce((acc, curr) => acc + balanceOf(curr), 0)
    const totalInvestments = investments.reduce((acc, curr) => acc + balanceOf(curr), 0)

    const formatCurrency = (amount: number, currency: string = 'TRY') => {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(amount)
    }

    const handleDeleteAcc = async (id: string, name: string) => {
        if (!confirm(`'${name}' hesabını silmek istediğinize emin misiniz?`)) return
        try {
            const { error } = await supabase.from('accounts').delete().eq('id', id)
            if (error) throw error
            setAccounts(prev => prev.filter(a => a.id !== id))
        } catch (error: any) {
            alert("Hesap silinemedi: " + error.message)
        }
    }

    const handleEditAcc = (account: Account) => {
        setEditingAccount(account)
        setIsModalOpen(true)
    }

    const groups = [
        { key: 'bank', label: 'Banka & Nakit', unit: 'hesap', total: totalBankBalance, items: bankAndCash },
        { key: 'card', label: 'Kredi Kartları', unit: 'kart', total: totalCreditDebt, items: creditCards },
        { key: 'inv', label: 'Yatırımlar', unit: 'portföy', total: totalInvestments, items: investments },
    ]

    return (
        <div className="flex flex-col gap-[var(--s3)] pb-10">
            <AccountModal
                isOpen={isModalOpen}
                account={editingAccount}
                onClose={() => { setIsModalOpen(false); setEditingAccount(null); }}
                onSuccess={() => fetchAccounts()}
            />

            <ReconcileModal
                isOpen={!!reconcileAcc}
                account={reconcileAcc}
                currentBalance={reconcileAcc ? balanceOf(reconcileAcc) : 0}
                onClose={() => setReconcileAcc(null)}
                onSuccess={() => { setReconcileAcc(null); fetchAccounts() }}
            />

            <TransactionModal
                isOpen={isTxModalOpen}
                onClose={() => { setIsTxModalOpen(false); setEditingTx(null); }}
                type={txModalType}
                initialData={editingTx || undefined}
                onSuccess={() => {
                    if (expandedAccountId) fetchAccountTransactions(expandedAccountId)
                    fetchAccounts()
                }}
            />

            <PageHeader title="Hesaplar" subtitle="Banka, nakit, kart ve yatırım hesapların tek yerde." />

            {isLoading ? (
                <div className="flex items-center justify-center py-32">
                    <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-3)' }} />
                </div>
            ) : (
                <>
                    {/* Özet — sade token satırları, renk yok, ince ayraç */}
                    <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                        <div className="flex flex-col gap-[var(--s3)]">
                            {groups.map((g, i) => (
                                <div key={g.key}>
                                    {i > 0 && <div className="h-px mb-[var(--s3)]" style={{ background: 'var(--border)' }} />}
                                    <div className="flex items-baseline justify-between">
                                        <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{g.label}</span>
                                        <span className="tnum" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{formatCurrency(g.total)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Hesap grupları — sade satır dili (dashboard hesap satırı gibi) */}
                    {groups.map(g => (
                        <div key={g.key} className="flex flex-col gap-[var(--s3)]">
                            <div className="flex items-center justify-between px-[2px]">
                                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{g.label}</span>
                                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{g.items.length} {g.unit}</span>
                            </div>
                            {g.items.length === 0 ? (
                                <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                                    <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>Bu türde hesap yok.</p>
                                </section>
                            ) : (
                                g.items.map(acc => (
                                    <AccountCard
                                        key={acc.id}
                                        account={acc}
                                        balance={balanceOf(acc)}
                                        isExpanded={expandedAccountId === acc.id}
                                        onToggle={() => handleToggleAccount(acc.id)}
                                        onEdit={handleEditAcc}
                                        onDelete={handleDeleteAcc}
                                        onReconcile={() => setReconcileAcc(acc)}
                                        formatCurrency={formatCurrency}
                                        transactions={accountTransactions}
                                        isTxLoading={isTxLoading}
                                        onEditTx={handleEditTx}
                                        onDeleteTx={handleDeleteTxClick}
                                    />
                                ))
                            )}
                        </div>
                    ))}

                    <div>
                        <PrimaryButton onClick={() => { setEditingAccount(null); setIsModalOpen(true); }}>
                            Hesap ekle
                        </PrimaryButton>
                    </div>
                </>
            )}

            <DeleteConfirmModal
                isOpen={isDeleteTxModalOpen}
                onClose={() => setIsDeleteTxModalOpen(false)}
                onConfirm={confirmDeleteTx}
                isLoading={isDeleteTxLoading}
                title="İşlemi Sil"
                description="Bu işlemi silmek istediğinize emin misiniz? Bu işlem hesap bakiyelerini güncelleyecektir."
            />
        </div>
    )
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
    cash: 'Nakit', credit_card: 'Kredi Kartı', investment: 'Yatırım', bank: 'Banka Hesabı',
}

/** Sade hesap satırı — dashboard dili: ad + tür + bakiye (--ink, işaretli), açılır detay. */
function AccountCard({
    account, balance, isExpanded, onToggle, onEdit, onDelete, onReconcile, formatCurrency,
    transactions, isTxLoading, onEditTx, onDeleteTx
}: {
    account: Account,
    balance: number,
    isExpanded: boolean,
    onToggle: () => void,
    onEdit: (a: Account) => void,
    onDelete: (id: string, name: string) => void,
    onReconcile: () => void,
    formatCurrency: (n: number, c: string) => string,
    transactions: Transaction[],
    isTxLoading: boolean,
    onEditTx: (tx: Transaction) => void,
    onDeleteTx: (id: string, amount: number, type: string, account_id: string, to_account_id?: string) => void
}) {
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
            <div onClick={onToggle} className="cursor-pointer p-[22px]">
                <div className="flex items-start justify-between">
                    <div className="min-w-0">
                        <div className="flex items-center gap-[var(--s2)]">
                            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{account.name}</span>
                            <ChevronDown className="h-[14px] w-[14px] transition-transform" style={{ color: 'var(--ink-3)', transform: isExpanded ? 'rotate(180deg)' : 'none' }} />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{ACCOUNT_TYPE_LABEL[account.type] ?? 'Hesap'}</div>
                    </div>
                    <div className="flex items-center gap-[var(--s1)]">
                        <button onClick={(e) => { e.stopPropagation(); onEdit(account) }} className="p-2 icon-btn" title="Düzenle">
                            <Settings className="h-[16px] w-[16px]" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onDelete(account.id, account.name) }} className="p-2 icon-btn" title="Hesabı Sil">
                            <X className="h-[16px] w-[16px]" />
                        </button>
                    </div>
                </div>

                <div className="mt-[var(--s4)] flex items-baseline justify-between">
                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Mevcut bakiye</span>
                    {/* Para rengi: --ink + işaret (Intl eksi işaretini verir); --flow-out sadece net değerde. */}
                    <span className="tnum" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>
                        {formatCurrency(balance, account.currency)}
                    </span>
                </div>
            </div>

            {isExpanded && (
                <div className="px-[22px] pb-[22px]" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s4)' }}>
                    <div className="mb-[var(--s3)] flex items-center justify-between">
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)' }}>Son işlemler</span>
                        <button
                            onClick={(e) => { e.stopPropagation(); onReconcile() }}
                            className="inline-flex items-center gap-[5px] px-[10px] py-[5px] transition-colors"
                            style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600 }}
                        >
                            Bakiye eşitle
                        </button>
                    </div>
                    <TransactionList
                        transactions={transactions}
                        isLoading={isTxLoading}
                        onEdit={onEditTx}
                        onDelete={onDeleteTx}
                    />
                </div>
            )}
        </section>
    )
}
