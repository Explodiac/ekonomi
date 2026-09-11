'use client'

import { useState, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import { resolveCashDate } from "@/lib/cash-date"
import { findSimilar, type SimilarTx } from "@/lib/similar"
import { CategoryPill } from "@/components/dashboard/category-tile"
import { AccountIcon, shortAccount } from "@/components/dashboard/account-icon"
import { TransactionModal } from "@/components/transactions/TransactionModal"
import { Calendar, ChevronDown, Pencil, Trash2, X, RefreshCw } from "lucide-react"

function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(amount)))} ₺`
}

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const TR_DAYS_FULL = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

function todayISO() { return new Date().toISOString().slice(0, 10) }

/** "2026-08-10" → "10 Ağustos 2026 Pazartesi" */
function longDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number)
    const dow = TR_DAYS_FULL[new Date(y, m - 1, d).getDay()]
    return `${d} ${TR_MONTHS[m - 1]} ${y} ${dow}`
}

/** "2026-04-25" → "25 Nisan" */
function shortDate(iso: string): string {
    const [, m, d] = iso.split('-').map(Number)
    return `${d} ${TR_MONTHS[m - 1]}`
}

type Tx = {
    id: string
    amount: number
    type: string
    transaction_date: string
    cash_date: string
    description?: string | null
    note?: string | null
    category_id?: string | null
    categoryName?: string | null
    account_id: string | null
    source_type?: string | null
    spend_nature?: string | null
    transfer_group_id?: string | null
    transfer_direction?: string | null
}

export function TransactionDetail({ tx, accounts, categories, allTxs, onChanged, onClose }: {
    tx: Tx
    accounts: any[]
    categories: any[]
    allTxs: Tx[]
    onChanged: () => void
    onClose: () => void
}) {
    const [editing, setEditing] = useState<'category' | 'account' | null>(null)
    const [note, setNote] = useState(tx.note ?? '')
    const [saving, setSaving] = useState(false)
    const [showEdit, setShowEdit] = useState(false)

    const isTransfer = tx.type === 'transfer'
    const account = accounts.find(a => a.id === tx.account_id)
    const category = categories.find(c => c.id === tx.category_id)
    const catName = category?.name ?? tx.categoryName ?? null
    const expenseCats = categories.filter(c => c.type === (tx.type === 'income' ? 'income' : 'expense'))

    const recurringName = tx.source_type
        ? (tx.description || '').replace(/\s*\d+\s*\/\s*\d+\s*$/, '').trim() || 'Düzenli'
        : null

    // Transfer: karşı hesabı + yönü göster ("Garanti - Banka → Halkbank Paraf").
    const transferLabel = useMemo(() => {
        if (!isTransfer || !tx.transfer_group_id) return null
        const legs = allTxs.filter(t => t.transfer_group_id === tx.transfer_group_id)
        const outAcc = legs.find(l => l.transfer_direction !== 'in')?.account_id
        const inAcc = legs.find(l => l.transfer_direction === 'in')?.account_id
        const from = outAcc ? accounts.find(a => a.id === outAcc)?.name : undefined
        const to = inAcc ? accounts.find(a => a.id === inAcc)?.name : undefined
        if (!from && !to) return null
        return `${from ?? '—'} → ${to ?? '—'}`
    }, [isTransfer, tx.transfer_group_id, allTxs, accounts])

    // Kart harcamasında nakit çıkışı ileri tarihe sarkıyorsa not.
    const txDay = tx.transaction_date?.slice(0, 10)
    const cardDefer = account?.type === 'credit_card' && tx.cash_date && txDay && tx.cash_date > txDay

    const similar = useMemo(() => {
        const pool: SimilarTx[] = allTxs.map(t => ({
            id: t.id, description: t.description, category_id: t.category_id,
            categoryName: t.categoryName, amount: t.amount, type: t.type,
            cash_date: t.cash_date, transaction_date: t.transaction_date,
        }))
        return findSimilar(
            { id: tx.id, description: tx.description, category_id: tx.category_id, amount: tx.amount, type: tx.type, cash_date: tx.cash_date, transaction_date: tx.transaction_date },
            pool, { asOf: todayISO() }
        )
    }, [tx, allTxs])

    const patch = async (fields: Record<string, any>) => {
        setSaving(true)
        try {
            const { error } = await supabase.from('transactions').update(fields).eq('id', tx.id)
            if (error) throw error
            onChanged()
        } catch (e) {
            console.error('Hareket güncellenemedi:', e)
        } finally {
            setSaving(false)
        }
    }

    // Transferde ortak alanlar (not gibi) İKİ BACAĞA birlikte yazılır — silme ve
    // düzenlemeyle aynı iki-bacak bütünlüğü.
    const patchGroup = async (fields: Record<string, any>) => {
        setSaving(true)
        try {
            const { error } = await supabase.from('transactions').update(fields).eq('transfer_group_id', tx.transfer_group_id)
            if (error) throw error
            onChanged()
        } catch (e) {
            console.error('Transfer güncellenemedi:', e)
        } finally {
            setSaving(false)
        }
    }

    const changeCategory = (categoryId: string) => { setEditing(null); patch({ category_id: categoryId || null }) }

    const changeAccount = (accountId: string) => {
        setEditing(null)
        const newAcc = accounts.find(a => a.id === accountId)
        // Hesap değişince nakit çıkış tarihi yeniden çözülür (tek kaynak: resolveCashDate).
        // Kart değilse transaction_date; gerçekleşmiş hareket ileriye atılmaz.
        const newCash = resolveCashDate({
            transactionDate: tx.transaction_date,
            currentCashDate: tx.cash_date,
            targetAccount: newAcc,
        })
        patch({ account_id: accountId, cash_date: newCash })
    }

    const saveNote = () => {
        if ((tx.note ?? '') === note) return
        const fields = { note: note || null }
        if (isTransfer && tx.transfer_group_id) patchGroup(fields); else patch(fields)
    }

    const remove = async () => {
        if (!confirm('Bu hareket silinsin mi?')) return
        setSaving(true)
        try {
            if (isTransfer && tx.transfer_group_id) {
                await supabase.from('transactions').delete().eq('transfer_group_id', tx.transfer_group_id)
            } else {
                await supabase.from('transactions').delete().eq('id', tx.id)
            }
            onClose()
            onChanged()
        } catch (e) {
            console.error('Silinemedi:', e)
            setSaving(false)
        }
    }

    return (
        <div className="p-[22px]">
            {/* Başlık şeridi: kapat + aksiyonlar */}
            <div className="mb-[var(--s3)] flex items-center justify-between">
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Hareket</span>
                <button onClick={onClose} aria-label="Kapat" className="lg:inline-flex hidden"><X className="h-[16px] w-[16px]" style={{ color: 'var(--ink-3)' }} /></button>
                <button onClick={onClose} aria-label="Kapat" className="lg:hidden"><ChevronDown className="h-[18px] w-[18px]" style={{ color: 'var(--ink-3)' }} /></button>
            </div>

            {/* Tarih — hareketin YAPILDIĞI gün (transaction_date). Kart harcamasında
                paranın çıkacağı gün aşağıda ayrı satırda ("… çıkacak"). */}
            <div className="flex items-center gap-[var(--s2)]" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                <Calendar className="h-[14px] w-[14px]" />
                {longDate(txDay || tx.cash_date)}
            </div>

            {/* Açıklama + tutar */}
            <div className="mt-[var(--s2)] flex items-start justify-between gap-[var(--s3)]">
                <h2 className="min-w-0" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                    {transferLabel || tx.description || catName || (isTransfer ? 'Transfer' : 'Hareket')}
                </h2>
                <span className="tnum shrink-0" style={{ fontSize: 22, fontWeight: 600, color: isTransfer ? 'var(--ink-3)' : 'var(--ink)' }}>
                    {tx.type === 'income' ? '+' : ''}{formatTL(Number(tx.amount))}
                </span>
            </div>

            {/* Üç alan: Kategori / Hesap / Tekrar eden */}
            <div className="mt-[var(--s4)] flex flex-wrap items-start gap-x-[var(--s5)] gap-y-[var(--s3)]">
                <Field label="Kategori">
                    <button onClick={() => setEditing(editing === 'category' ? null : 'category')} disabled={isTransfer} className="inline-flex items-center gap-[4px]">
                        {catName ? <CategoryPill name={catName} /> : <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>—</span>}
                        {!isTransfer && <ChevronDown className="h-[13px] w-[13px]" style={{ color: 'var(--ink-3)' }} />}
                    </button>
                </Field>

                <Field label="Hesap">
                    {/* Transferde hesap değişimi ayrı akış (yön + cash_date yeniden hesap); burada kilitli. */}
                    <button onClick={() => setEditing(editing === 'account' ? null : 'account')} disabled={isTransfer} className="inline-flex items-center gap-[var(--s2)]">
                        <AccountIcon type={account?.type} size={22} />
                        <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>{shortAccount(account?.name) || '—'}</span>
                        {!isTransfer && <ChevronDown className="h-[13px] w-[13px]" style={{ color: 'var(--ink-3)' }} />}
                    </button>
                </Field>

                {recurringName && (
                    <Field label="Tekrar eden">
                        <span className="inline-flex items-center gap-[4px]" style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                            <RefreshCw className="h-[13px] w-[13px]" style={{ color: 'var(--ink-3)' }} />
                            {recurringName}
                        </span>
                    </Field>
                )}
            </div>

            {/* Seçim açılır listeleri */}
            {editing === 'category' && (
                <EditList
                    options={[{ id: '', name: 'Kategorisiz' }, ...expenseCats.map(c => ({ id: c.id, name: c.name }))]}
                    activeId={tx.category_id ?? ''} onPick={changeCategory}
                />
            )}
            {editing === 'account' && (
                <EditList
                    options={accounts.map(a => ({ id: a.id, name: a.name }))}
                    activeId={tx.account_id ?? ''} onPick={changeAccount}
                />
            )}

            {cardDefer && (
                <div className="mt-[var(--s3)]" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                    {shortDate(tx.cash_date)}&apos;da hesabından çıkacak
                </div>
            )}

            {/* Not */}
            <div className="mt-[var(--s5)]">
                <div className="mb-[var(--s2)]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Not</div>
                <textarea
                    value={note} onChange={e => setNote(e.target.value)} onBlur={saveNote}
                    placeholder="Serbest not ekle…" rows={2}
                    className="w-full resize-none px-[var(--s3)] py-[var(--s2)] outline-none"
                    style={{ fontSize: 14, color: 'var(--ink)', background: 'var(--surface-2)', borderRadius: 'var(--r-button)', border: '1px solid var(--border)' }}
                />
            </div>

            {/* Harcama doğası — yalnız değişken gider (source_type yok) */}
            {tx.type === 'expense' && !tx.source_type && (
                <div className="mt-[var(--s5)]">
                    <div className="mb-[var(--s2)]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                        Harcama doğası {tx.spend_nature == null && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-4)' }}>· sınıflanmamış</span>}
                    </div>
                    <div className="flex gap-[var(--s2)]">
                        {([['aliskanlik', 'Alışkanlık'], ['tek_seferlik', 'Tek seferlik']] as const).map(([val, lbl]) => {
                            const active = tx.spend_nature === val
                            return (
                                <button
                                    key={val}
                                    onClick={() => patch({ spend_nature: active ? null : val })}
                                    className="px-[var(--s3)] py-[6px] transition-colors"
                                    style={{
                                        fontSize: 12.5, fontWeight: active ? 600 : 400,
                                        borderRadius: 'var(--r-pill)',
                                        color: active ? 'var(--accent)' : 'var(--ink-2)',
                                        background: active ? 'var(--accent-bg)' : 'var(--surface-2)',
                                    }}
                                >
                                    {lbl}
                                </button>
                            )
                        })}
                    </div>
                    <p className="mt-[var(--s2)]" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                        Tek seferlik harcamalar alışkanlık ortalamasına — nefes payı hesabına — girmez.
                    </p>
                </div>
            )}

            {/* Benzer hareketler */}
            {similar.length > 0 && (
                <div className="mt-[var(--s5)]">
                    <div className="mb-[var(--s3)]" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>Benzer hareketler</div>
                    <div className="flex flex-col gap-[var(--s4)]">
                        {similar.map(month => (
                            <div key={month.month}>
                                <div className="flex items-baseline justify-between">
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{monthTitle(month.month)}</span>
                                    <span className="tnum" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{formatTL(month.total)}</span>
                                </div>
                                <ul className="mt-[var(--s2)] flex flex-col gap-[var(--s2)]">
                                    {month.items.map(it => (
                                        <li key={it.id} className="flex items-center justify-between gap-[var(--s2)]">
                                            <span className="min-w-0 truncate" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                                                {shortDate((it.transaction_date || it.cash_date || '').slice(0, 10))} · {it.description || it.categoryName || 'Hareket'}
                                            </span>
                                            <span className="tnum shrink-0" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{formatTL(Number(it.amount))}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Aksiyonlar */}
            <div className="mt-[var(--s5)] flex items-center gap-[var(--s3)] pt-[var(--s4)]" style={{ borderTop: '1px solid var(--border)' }}>
                <button
                    onClick={() => setShowEdit(true)}
                    className="inline-flex items-center gap-[var(--s2)] px-[var(--s4)] py-[var(--s2)]"
                    style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', background: 'var(--surface-2)', borderRadius: 'var(--r-button)' }}
                >
                    <Pencil className="h-[14px] w-[14px]" /> Düzenle
                </button>
                <button
                    onClick={remove} disabled={saving}
                    className="inline-flex items-center gap-[var(--s2)] px-[var(--s4)] py-[var(--s2)]"
                    style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--flow-out)' }}
                >
                    <Trash2 className="h-[14px] w-[14px]" /> Sil
                </button>
            </div>

            {showEdit && (
                <TransactionModal
                    isOpen={showEdit}
                    onClose={() => setShowEdit(false)}
                    type={tx.type as 'income' | 'expense' | 'transfer'}
                    onSuccess={() => { setShowEdit(false); onChanged() }}
                    initialData={tx}
                />
            )}
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-[var(--s2)]">
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{label}</span>
            {children}
        </div>
    )
}

function EditList({ options, activeId, onPick }: { options: { id: string; name: string }[]; activeId: string; onPick: (id: string) => void }) {
    return (
        <div className="mt-[var(--s3)] flex max-h-[220px] flex-col gap-[2px] overflow-y-auto p-[var(--s2)]"
            style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-button)', border: '1px solid var(--border)' }}>
            {options.map(o => {
                const on = o.id === activeId
                return (
                    <button
                        key={o.id || 'none'} onClick={() => onPick(o.id)}
                        className="px-[var(--s3)] py-[var(--s2)] text-left transition-colors"
                        style={{ fontSize: 13.5, borderRadius: 'var(--r-button)', background: on ? 'var(--accent-bg)' : 'transparent', color: on ? 'var(--accent)' : 'var(--ink-2)', fontWeight: on ? 600 : 400 }}
                    >
                        {o.name}
                    </button>
                )
            })}
        </div>
    )
}

function monthTitle(mk: string): string {
    const [y, m] = mk.split('-').map(Number)
    return `${TR_MONTHS[m - 1]} ${y}`
}
