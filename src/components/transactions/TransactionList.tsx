"use client"

import { ArrowUpRight, ArrowDownLeft, ArrowRightLeft, Edit2, Trash2, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"

export type Transaction = {
    id: string;
    amount: number;
    transaction_date: string;
    description: string;
    type: 'income' | 'expense' | 'transfer';
    category_id?: string;
    account_id: string; // Added account_id
    to_account_id?: string;
    categories?: { name: string };
    accounts?: { name: string };
}

interface TransactionListProps {
    transactions: Transaction[];
    onEdit: (tx: Transaction) => void;
    onDelete: (id: string, amount: number, type: string, account_id: string, to_account_id?: string) => void;
    isLoading?: boolean;
}

export function TransactionList({ transactions, onEdit, onDelete, isLoading }: TransactionListProps) {
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount)
    }

    if (isLoading) {
        return (
            <div className="flex justify-center p-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
        )
    }

    if (transactions.length === 0) {
        return (
            <div className="text-center p-8 text-muted-foreground text-sm font-medium">
                Bu hesaba ait henüz işlem bulunmuyor.
            </div>
        )
    }

    return (
        <div className="divide-y divide-border/40">
            {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-3 group">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className={`p-2 rounded-full shrink-0 ${tx.type === 'income' ? 'bg-emerald-500/10 text-emerald-500' :
                            tx.type === 'expense' ? 'bg-destructive/10 text-destructive' :
                                'bg-blue-500/10 text-blue-500'
                            }`}>
                            {tx.type === 'income' ? <ArrowDownLeft className="w-4 h-4" /> :
                                tx.type === 'expense' ? <ArrowUpRight className="w-4 h-4" /> :
                                    <ArrowRightLeft className="w-4 h-4" />}
                        </div>
                        <div className="overflow-hidden min-w-0">
                            <p className="text-sm font-bold truncate leading-none mb-1">{tx.description || 'İşlem'}</p>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(tx.transaction_date).toLocaleDateString('tr-TR')}</span>
                                <span>•</span>
                                <span>{tx.categories?.name || 'Kategorisiz'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                        <p className={`text-sm font-black text-right ${tx.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' :
                            tx.type === 'expense' ? 'text-destructive' :
                                'text-blue-600 dark:text-blue-400'
                            }`}>
                            {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                        </p>

                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onEdit(tx)}
                                className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10 rounded-lg"
                            >
                                <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    console.log("TransactionList: Trash button clicked for ID:", tx.id);
                                    onDelete(tx.id, tx.amount, tx.type, tx.account_id, tx.to_account_id);
                                }}
                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}
