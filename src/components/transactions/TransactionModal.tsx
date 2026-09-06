"use client"

import { useState, useEffect, useMemo } from "react"
import { supabase, ensureHouseholdExists, createNotification } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Loader2, Sparkles } from "lucide-react"
import { suggestCategory } from "@/lib/auto-categorize"
import { calculateCashDate, resolveCashDate } from "@/lib/cash-date"
import { previewInstallment, monthLocative, type UpcomingInput } from "@/lib/upcoming"
import { planTransferEdit } from "@/lib/transfer-edit"

type ModalProps = {
    isOpen: boolean
    onClose: () => void
    type: 'income' | 'expense' | 'transfer'
    onSuccess: () => void
    initialData?: any
    /** Açılışta taksit modunu açık başlat (yalnız yeni gider kaydında geçerli). */
    initialInstallment?: boolean
}

export function TransactionModal({ isOpen, onClose, type: initialType, onSuccess, initialData, initialInstallment }: ModalProps) {
    const [type, setType] = useState<'income' | 'expense' | 'transfer'>(initialType)
    const [amount, setAmount] = useState("")
    const [description, setDescription] = useState("")
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])

    const [accounts, setAccounts] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [selectedAccount, setSelectedAccount] = useState("")
    const [toAccount, setToAccount] = useState("")
    const [selectedCategory, setSelectedCategory] = useState("")

    const [isLoading, setIsLoading] = useState(false)
    const [isFetching, setIsFetching] = useState(false)
    const [householdId, setHouseholdId] = useState<string | null>(null)

    const [isInstallment, setIsInstallment] = useState(false)
    const [installmentCount, setInstallmentCount] = useState("3")
    // Taksitli ödemenin türü: kredi kartı (account_id=kart) ya da elden (source_account_id=banka).
    const [installmentKind, setInstallmentKind] = useState<'kart_taksidi' | 'elden'>('kart_taksidi')
    // Taksit ön uyarısı için mevcut yükümlülük tablosu (previewInstallment'a beslenir).
    const [upcomingBase, setUpcomingBase] = useState<UpcomingInput | null>(null)

    useEffect(() => {
        if (isOpen) {
            fetchDropdownData()
            if (initialData) {
                setAmount(initialData.amount.toString())
                setDescription(initialData.description || "")
                setDate(initialData.transaction_date.split('T')[0])
                setSelectedAccount(initialData.account_id)
                setSelectedCategory(initialData.category_id || "")
                setType(initialData.type)
                if (initialData.type === 'transfer') {
                    setToAccount(initialData.to_account_id || "")
                }
                setIsInstallment(false) // düzenlemede taksit oluşturma yok
            } else {
                setAmount("")
                setDescription("")
                setDate(new Date().toISOString().split('T')[0])
                setSelectedAccount("")
                setSelectedCategory("")
                setToAccount("")
                setType(initialType)
                setIsInstallment(!!initialInstallment && initialType === 'expense')
                setInstallmentKind('kart_taksidi')
            }
        }
    }, [isOpen, initialType, initialData, initialInstallment])

    const handleDescriptionChange = async (val: string) => {
        setDescription(val)
        if (!val || val.length < 3) return

        // 1. Static Suggestion (Keywords)
        const suggestedId = suggestCategory(val, categories)
        if (suggestedId) {
            setSelectedCategory(suggestedId)
            return
        }

        // 2. Personal History Suggestion (Learning)
        if (householdId) {
            const { data } = await supabase
                .from('transactions')
                .select('category_id')
                .eq('household_id', householdId)
                .ilike('description', `%${val}%`)
                .order('created_at', { ascending: false })
                .limit(1)

            if (data && data[0]?.category_id) {
                setSelectedCategory(data[0].category_id)
            }
        }
    }

    const fetchDropdownData = async () => {
        setIsFetching(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (hhId) {
                setHouseholdId(hhId)

                // Fetch accounts
                const { data: accData } = await supabase
                    .from('accounts')
                    .select('*')
                    .eq('household_id', hhId)

                if (accData) setAccounts(accData)
                else setAccounts([])

                // Fetch categories
                const { data: catData } = await supabase
                    .from('categories')
                    .select('*')
                    .eq('household_id', hhId)
                    .eq('type', type === 'income' ? 'income' : 'expense')

                if (catData) setCategories(catData)
                else setCategories([])

                // Taksit ön uyarısı için mevcut yükümlülükler. Sadece gider modunda gerekli.
                if (type === 'expense') {
                    const [txRes, subRes, instRes] = await Promise.all([
                        supabase.from('transactions')
                            .select('amount, type, cash_date, source_type, source_id')
                            .eq('household_id', hhId),
                        supabase.from('subscriptions')
                            .select('id, name, amount, frequency, next_payment_date, status')
                            .eq('household_id', hhId),
                        supabase.from('installments')
                            .select('id, description, kind, installment_payments(id, payment_date, amount)')
                            .eq('household_id', hhId),
                    ])
                    setUpcomingBase({
                        transactions: txRes.data || [],
                        subscriptions: subRes.data || [],
                        installments: (instRes.data || []).map((i: any) => ({
                            ...i,
                            payments: i.installment_payments || [],
                        })),
                    })
                }
            }
        } catch (error) {
            console.error(error)
        } finally {
            setIsFetching(false)
        }
    }

    // Taksit ön uyarısı: yeni taksidin mevcut yüke etkisi. Kayıt akışını etkilemez,
    // sadece kullanıcıya aylık yük artışını ve ilk rahatlama ayını gösterir.
    const installmentPreview = useMemo(() => {
        if (!isInstallment || !upcomingBase) return null
        const numAmount = parseFloat(amount)
        const count = parseInt(installmentCount) || 0
        if (!numAmount || count < 2) return null

        const account = accounts.find(a => a.id === selectedAccount)
        const startCashDate = calculateCashDate(date, account)
        return previewInstallment(
            upcomingBase,
            { monthlyAmount: numAmount / count, count, startCashDate, kind: 'kart_taksidi' },
        )
    }, [isInstallment, upcomingBase, amount, installmentCount, selectedAccount, date, accounts])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!amount || !selectedAccount || !householdId) return
        // Transfer düzenlemede hedef hesap formda yok (bacaklar DB'den okunur); yalnız yeni transferde gerekir.
        if (type === 'transfer' && !toAccount && !initialData) return

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Oturum bulunamadı")

            const numAmount = parseFloat(amount)
            const numInstallmentCount = parseInt(installmentCount) || 1
            const monthlyAmount = numAmount / numInstallmentCount

            // --- TRANSFER DÜZENLEME: İKİ BACAK BİRLİKTE ---
            // transfer_group_id dolu bir hareket düzenlenirken her iki bacağın tutar,
            // tarih ve açıklaması birlikte güncellenir; her bacak KENDİ cash_date'ini
            // kendi hesabından çözer (kaynak banka, hedef kart olabilir) ve her
            // hesabın bakiyesi transactionEffect ile düzeltilir. Yön ve hesaplar
            // değişmez (ayrı akış). Silmedeki iki-bacak bütünlüğünün eşidir.
            if (initialData && initialData.transfer_group_id) {
                const { data: legRows, error: legErr } = await supabase
                    .from('transactions')
                    .select('id, account_id, transfer_direction, cash_date')
                    .eq('transfer_group_id', initialData.transfer_group_id)
                if (legErr) throw legErr
                if (!legRows || legRows.length === 0) throw new Error('Transfer bacakları bulunamadı')

                const { data: freshAccounts } = await supabase.from('accounts').select('*').eq('household_id', householdId)
                const accs = freshAccounts || accounts

                const plan = planTransferEdit({
                    legs: legRows as any,
                    accounts: accs as any,
                    oldAmount: Number(initialData.amount),
                    newAmount: numAmount,
                    newDate: date,
                })

                const txnDate = new Date(date).toISOString()
                await Promise.all(plan.legUpdates.map(u =>
                    supabase.from('transactions').update({
                        amount: u.amount, transaction_date: txnDate, cash_date: u.cash_date, description,
                    }).eq('id', u.id)
                ))
                await Promise.all(plan.balanceUpdates.map(b =>
                    supabase.from('accounts').update({ balance: b.balance }).eq('id', b.accountId)
                ))

                await createNotification(householdId, 'Transfer Güncellendi', `${user.email?.split('@')[0] || 'Kullanıcı'}: transfer ₺${numAmount} olarak güncellendi.`, 'info')
                setAmount(""); setDescription("")
                onSuccess(); onClose()
                return
            }

            // --- UNDO OLD BALANCE EFFECTS IF EDITING ---
            if (initialData) {
                const oldAcc = accounts.find(a => a.id === initialData.account_id)
                if (oldAcc) {
                    let oldBalance = Number(oldAcc.balance)
                    if (initialData.type === 'income') oldBalance -= initialData.amount
                    else oldBalance += initialData.amount
                    await supabase.from('accounts').update({ balance: oldBalance }).eq('id', initialData.account_id)
                }

                if (initialData.type === 'transfer' && initialData.to_account_id) {
                    const oldToAcc = accounts.find(a => a.id === initialData.to_account_id)
                    if (oldToAcc) {
                        await supabase.from('accounts').update({ balance: Number(oldToAcc.balance) - initialData.amount }).eq('id', initialData.to_account_id)
                    }
                }
            }

            // --- PERFORM THE TRANSACTION ---
            const accountForCashDate = accounts.find(a => a.id === selectedAccount)

            if (isInstallment && type === 'expense' && !initialData) {
                const transactionRecords = []
                for (let i = 0; i < numInstallmentCount; i++) {
                    const pDate = new Date(date)
                    pDate.setMonth(pDate.getMonth() + i)

                    transactionRecords.push({
                        household_id: householdId,
                        account_id: selectedAccount,
                        category_id: selectedCategory || null,
                        user_id: user.id,
                        amount: monthlyAmount,
                        type: 'expense',
                        transaction_date: pDate.toISOString(),
                        cash_date: resolveCashDate({ transactionDate: pDate, targetAccount: accountForCashDate }),
                        description: `${description} (${i + 1}/${numInstallmentCount})`
                    })
                }

                const { data: txs, error: txError } = await supabase
                    .from('transactions')
                    .insert(transactionRecords)
                    .select()

                if (txError) throw txError

                const { data: instData, error: instError } = await supabase.from('installments').insert({
                    household_id: householdId,
                    account_id: selectedAccount,
                    category_id: selectedCategory || null,
                    description: description,
                    total_amount: numAmount,
                    installments_count: numInstallmentCount,
                    start_date: date,
                    kind: installmentKind,
                    // Elden: ödeme kaynağı zorunlu (banka hesabı). Kartta account_id kartın kendisi.
                    source_account_id: installmentKind === 'elden' ? selectedAccount : null,
                }).select().single()

                if (instError) throw instError

                if (instData && txs) {
                    const payments = txs.map((tx, i) => ({
                        installment_id: instData.id,
                        amount: monthlyAmount,
                        installment_number: i + 1,
                        payment_date: tx.transaction_date.split('T')[0],
                        status: i === 0 ? 'paid' : 'pending',
                        transaction_id: tx.id
                    }))

                    const { data: insertedPayments, error: pError } = await supabase
                        .from('installment_payments')
                        .insert(payments)
                        .select()
                    if (pError) throw pError

                    if (insertedPayments) {
                        await Promise.all(insertedPayments.map(p =>
                            supabase
                                .from('transactions')
                                .update({ source_type: 'installment', source_id: p.id })
                                .eq('id', p.transaction_id)
                        ))
                    }
                }
            } else {
                const txData: any = {
                    household_id: householdId,
                    account_id: selectedAccount,
                    category_id: selectedCategory || null,
                    user_id: user.id,
                    amount: numAmount,
                    type: type,
                    transaction_date: new Date(date).toISOString(),
                    // Düzenlemede eski cash_date verilir → gerçekleşmiş hareket ileriye atılmaz.
                    cash_date: resolveCashDate({ transactionDate: date, currentCashDate: initialData?.cash_date, targetAccount: accountForCashDate }),
                    description: description
                }

                if (initialData) {
                    const { error: txError } = await supabase
                        .from('transactions')
                        .update(txData)
                        .eq('id', initialData.id)
                    if (txError) throw txError
                } else if (type === 'transfer') {
                    // Transfer iki satır: kaynakta 'out', hedefte 'in'. Tek insert
                    // çağrısıyla yazılıyor — PostgREST bunu tek statement olarak
                    // çalıştırdığı için ya ikisi de yazılır ya hiçbiri; yarım transfer olmaz.
                    const groupId = crypto.randomUUID()
                    const toAccountObj = accounts.find(a => a.id === toAccount)

                    const { error: txError } = await supabase.from('transactions').insert([
                        {
                            ...txData,
                            transfer_group_id: groupId,
                            transfer_direction: 'out',
                        },
                        {
                            ...txData,
                            account_id: toAccount,
                            cash_date: resolveCashDate({ transactionDate: date, targetAccount: toAccountObj }),
                            transfer_group_id: groupId,
                            transfer_direction: 'in',
                        },
                    ])
                    if (txError) throw txError
                } else {
                    const { error: txError } = await supabase
                        .from('transactions')
                        .insert([txData])
                    if (txError) throw txError
                }
            }

            // --- APPLY NEW BALANCE EFFECTS ---
            // Refresh accounts before update
            const { data: freshAccounts } = await supabase.from('accounts').select('*').eq('household_id', householdId)
            const accs = freshAccounts || accounts

            const fromAccObj = accs.find(a => a.id === selectedAccount)
            if (fromAccObj) {
                let newBalance = Number(fromAccObj.balance)
                if (type === 'income') newBalance += numAmount
                else newBalance -= numAmount
                await supabase.from('accounts').update({ balance: newBalance }).eq('id', selectedAccount)
            }

            if (type === 'transfer' && toAccount) {
                const toAccObj = accs.find(a => a.id === toAccount)
                if (toAccObj) {
                    await supabase.from('accounts').update({ balance: Number(toAccObj.balance) + numAmount }).eq('id', toAccount)
                }
            }

            const userName = user.email?.split('@')[0] || 'Kullanıcı'
            let notificationTitle = initialData ? 'İşlem Güncellendi' : 'Yeni İşlem'
            let notificationMessage = `${userName}: ${description || type} işlemi. Tutar: ₺${numAmount}`

            if (type === 'transfer') {
                const fromAccName = accounts.find(a => a.id === selectedAccount)?.name
                const toAccName = accounts.find(a => a.id === toAccount)?.name
                notificationMessage = `${userName}: ${fromAccName} -> ${toAccName} arası ₺${numAmount} transfer yaptı.`
            }

            await createNotification(householdId, notificationTitle, notificationMessage, 'info')

            setAmount("")
            setDescription("")
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
                    <div className="flex flex-col">
                        <h2 className="text-xl font-bold">
                            {initialData ? 'İşlemi Düzenle' : (isInstallment ? 'Taksitli ödeme' : type === 'income' ? 'Gelir Ekle' : type === 'expense' ? 'Gider Ekle' : 'Transfer Yap')}
                        </h2>
                        {!initialData && (
                            <div className="flex gap-2 mt-2">
                                <button type="button" onClick={() => setType('expense')} className={`text-xs px-2 py-1 rounded-md border ${type === 'expense' ? 'bg-destructive text-white' : 'hover:bg-muted'}`}>Gider</button>
                                <button type="button" onClick={() => setType('income')} className={`text-xs px-2 py-1 rounded-md border ${type === 'income' ? 'bg-emerald-600 text-white' : 'hover:bg-muted'}`}>Gelir</button>
                                <button type="button" onClick={() => setType('transfer')} className={`text-xs px-2 py-1 rounded-md border ${type === 'transfer' ? 'bg-blue-600 text-white' : 'hover:bg-muted'}`}>Transfer</button>
                            </div>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Tutar (₺)</label>
                        <Input
                            type="number"
                            step="0.01"
                            required
                            placeholder="0.00"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="text-lg font-bold"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Tarih</label>
                            <Input
                                type="date"
                                required
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                            />
                        </div>
                        <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                        >
                            <option value="">Kategori...</option>
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Transfer düzenlemesinde hesap/yön değişmez (ayrı akış); yalnız
                        tutar, tarih ve açıklama düzenlenir, iki bacağa birlikte uygulanır. */}
                    {initialData && type === 'transfer' ? (
                        <p className="text-xs text-muted-foreground rounded-md bg-muted/30 border border-border/50 p-3">
                            Transferin tutarı, tarihi ve açıklaması iki bacağa birlikte uygulanır. Hesap ya da yön değiştirmek ayrı bir işlemdir.
                        </p>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{type === 'transfer' ? 'Kaynak Hesap' : isInstallment ? (installmentKind === 'elden' ? 'Ödemenin çıkacağı hesap' : 'Kart') : 'Hesap Seçin'}</label>
                                <select
                                    required
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                                    value={selectedAccount}
                                    onChange={(e) => setSelectedAccount(e.target.value)}
                                >
                                    <option value="" disabled>Hesap seçiniz...</option>
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.id}>{acc.name} (₺{acc.balance})</option>
                                    ))}
                                </select>
                            </div>

                            {type === 'transfer' && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Hedef Hesap</label>
                                    <select
                                        required
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                                        value={toAccount}
                                        onChange={(e) => setToAccount(e.target.value)}
                                    >
                                        <option value="" disabled>Hedef hesap seçiniz...</option>
                                        {accounts.filter(a => a.id !== selectedAccount).map(acc => (
                                            <option key={acc.id} value={acc.id}>{acc.name} (₺{acc.balance})</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-medium flex items-center gap-2">
                            Açıklama <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                        </label>
                        <Input
                            type="text"
                            placeholder={type === 'transfer' ? 'Transfer açıklaması...' : "Kısa bir not..."}
                            value={description}
                            onChange={(e) => type === 'transfer' ? setDescription(e.target.value) : handleDescriptionChange(e.target.value)}
                        />
                    </div>

                    {type === 'expense' && !initialData && (
                        <div className="space-y-4 p-4 bg-muted/30 rounded-xl border border-border/50">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <label className="text-sm font-semibold">Taksitlendir</label>
                                    <p className="text-[10px] text-muted-foreground italic">Gideri aylara bölerek takip et</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsInstallment(!isInstallment)}
                                    className={`w-12 h-6 rounded-full relative transition-colors duration-300 ${isInstallment ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${isInstallment ? 'left-7' : 'left-1'}`}></div>
                                </button>
                            </div>

                            {isInstallment && (
                                <div className="space-y-3 pt-2 border-t border-border/10 animate-in slide-in-from-top-1 duration-300">
                                    <p className="text-[11px] text-muted-foreground italic">Belirli sayıda taksit, sonra biter — elden alım, birine süreli ödeme (ör. anneme 7 ay). Süresiz düzenli ödeme için Abonelikler.</p>
                                    <div>
                                        <label className="text-xs font-bold text-primary uppercase tracking-widest">Ödeme türü</label>
                                        <div className="flex gap-2 mt-1">
                                            {([['kart_taksidi', 'Kredi kartı'], ['elden', 'Elden']] as const).map(([val, lbl]) => (
                                                <button key={val} type="button" onClick={() => setInstallmentKind(val)}
                                                    className={`flex-1 h-10 rounded-lg text-xs font-bold transition-all ${installmentKind === val ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-background hover:bg-muted border border-border/50'}`}>
                                                    {lbl}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <label className="text-xs font-bold text-primary uppercase tracking-widest">Taksit Sayısı</label>
                                    <div className="flex gap-2">
                                        {[2, 3, 4, 6, 9, 12].map(num => (
                                            <button
                                                key={num}
                                                type="button"
                                                onClick={() => setInstallmentCount(num.toString())}
                                                className={`flex-1 h-10 rounded-lg text-xs font-bold transition-all ${installmentCount === num.toString() ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-background hover:bg-muted border border-border/50'}`}
                                            >
                                                {num}
                                            </button>
                                        ))}
                                        <Input
                                            type="number"
                                            className="w-16 h-10 text-center font-bold"
                                            value={installmentCount}
                                            onChange={(e) => setInstallmentCount(e.target.value)}
                                        />
                                    </div>

                                    {installmentPreview && (
                                        <p className="text-xs leading-relaxed text-muted-foreground pt-1">
                                            {installmentCount} taksit → aylık yükünüz{' '}
                                            <span className="font-semibold text-foreground tabular-nums">
                                                {new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(installmentPreview.monthlyLoad)} ₺
                                            </span>{' '}
                                            artacak
                                            {installmentPreview.reliefMonth &&
                                                `, ilk rahatlama ${monthLocative(installmentPreview.reliefMonth)}.`}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="pt-4 flex justify-end gap-3">
                        <Button type="button" variant="outline" onClick={onClose}>İptal</Button>
                        <Button type="submit" disabled={isLoading || accounts.length === 0} className={type === 'income' ? 'bg-emerald-600 hover:bg-emerald-700' : type === 'transfer' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-destructive hover:bg-destructive/90'}>
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Kaydet'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
