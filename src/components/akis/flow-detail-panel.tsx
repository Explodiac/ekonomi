'use client'

import { useState, useEffect } from "react"
import Link from "next/link"
import { X, ChevronDown } from "lucide-react"
import { categoryInk, CategoryPill } from "@/components/dashboard/category-tile"
import { KeyMetricsTable, type YearRow } from "@/components/categories/key-metrics"
import type { CashflowResult } from "@/lib/flow"

const TR_MON_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const TR_MON_LETTER = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A']
const RECURRING_KEY = '__recurring__'

function formatTL(amount: number): string {
    const abs = Math.abs(Math.round(amount))
    const s = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs)
    return `${amount < 0 ? '−' : ''}${s} ₺`
}
function monthLabel(mk: string) { const [y, m] = mk.split('-').map(Number); return `${TR_MON_SHORT[m - 1]} ${y}` }

export type PanelKind = 'harcama' | 'gelir' | 'net'
const KIND_LABEL: Record<PanelKind, string> = { harcama: 'Harcama', gelir: 'Gelir', net: 'Net akış' }
const KIND_DESC: Record<PanelKind, string> = {
    harcama: 'Aylık harcama — ödenmemiş düzenli ödemeler hariç',
    gelir: 'Aylık gelir — gerçekleşen tahsilatlar',
    net: 'Aylık net akış — giren eksi çıkan',
}

/** Bir aya derin bakış — sağdan tam yükseklikte panel (mobilde tam ekran). */
export function FlowDetailPanel({ kind, month, result, yearly, onKindChange, onMonthChange, onClose }: {
    kind: PanelKind
    month: string
    result: CashflowResult
    yearly: YearRow[]
    onKindChange: (k: PanelKind) => void
    onMonthChange: (m: string) => void
    onClose: () => void
}) {
    const [menuOpen, setMenuOpen] = useState(false)

    // ESC ile kapat
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    const months = result.months
    const totalOf = (m: CashflowResult['months'][number]) => kind === 'harcama' ? m.expense : kind === 'gelir' ? m.income : m.net
    const idx = Math.max(0, months.findIndex(m => m.month === month))
    const selMonth = months[idx]
    const total = selMonth ? totalOf(selMonth) : 0
    const totalColor = kind === 'net' ? (total >= 0 ? 'var(--flow-in)' : 'var(--flow-out)') : kind === 'gelir' ? 'var(--flow-in)' : 'var(--flow-out)'

    // Çok aylı şerit
    const maxAbs = Math.max(1, ...months.map(m => Math.abs(totalOf(m))))

    // Kategoriler / kaynaklar (seçili ay)
    const listFor = (cats: { key: string; label: string; monthly: number[] }[]) =>
        cats.map(c => ({ key: c.key, label: c.label, amount: c.monthly[idx] ?? 0 }))
            .filter(c => c.amount > 0)
            .sort((a, b) => b.amount - a.amount)
    const expenseRows = listFor(result.expenseCategories)
    const incomeRows = listFor(result.incomeSources)

    return (
        <div className="fixed inset-0 z-50 flex">
            <div className="animate-in fade-in flex-1 duration-200" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
            <div
                className="animate-in slide-in-from-right ml-auto flex h-full w-full flex-col overflow-y-auto duration-300 lg:max-w-[720px]"
                style={{ background: 'var(--surface)', boxShadow: '-16px 0 48px rgba(0,0,0,0.3)' }}
            >
                {/* Başlık */}
                <div className="flex items-start justify-between gap-[var(--s4)] p-[var(--s5)]" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="min-w-0">
                        <div className="relative">
                            <button onClick={() => setMenuOpen(o => !o)} className="inline-flex items-center gap-[6px]" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                                {KIND_LABEL[kind]} <ChevronDown className="h-4 w-4" style={{ color: 'var(--ink-3)' }} />
                            </button>
                            {menuOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                                    <div className="absolute left-0 top-full z-20 mt-[var(--s1)] overflow-hidden py-[var(--s1)]" style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-button)', border: '1px solid var(--border)', boxShadow: '0 12px 32px rgba(0,0,0,0.28)', minWidth: 160 }}>
                                        {(['harcama', 'gelir', 'net'] as PanelKind[]).map(k => (
                                            <button key={k} onClick={() => { onKindChange(k); setMenuOpen(false) }} className="block w-full px-[var(--s3)] py-[var(--s2)] text-left transition-colors hover:bg-[var(--fill-track)]"
                                                style={{ fontSize: 14, color: k === kind ? 'var(--accent)' : 'var(--ink)', fontWeight: k === kind ? 600 : 400 }}>
                                                {KIND_LABEL[k]}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="mt-[2px]" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{KIND_DESC[kind]}</div>
                    </div>
                    <div className="flex items-start gap-[var(--s3)]">
                        <div className="text-right">
                            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{selMonth ? monthLabel(selMonth.month) : ''}</div>
                            <div className="tnum" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: totalColor }}>{formatTL(total)}</div>
                        </div>
                        <button onClick={onClose} className="icon-btn p-1" aria-label="Kapat"><X className="h-5 w-5" /></button>
                    </div>
                </div>

                <div className="flex flex-col gap-[var(--s4)] p-[var(--s5)]">
                    {/* Çok aylı şerit */}
                    <div>
                        <div className="flex h-[72px] items-end gap-[3px]">
                            {months.map((m, i) => {
                                const v = Math.abs(totalOf(m))
                                const empty = v === 0
                                const hPct = empty ? 0 : Math.max(4, (v / maxAbs) * 100)
                                return (
                                    <button key={m.month} onClick={() => onMonthChange(m.month)} className="flex-1" style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }} title={`${monthLabel(m.month)} · ${formatTL(totalOf(m))}`}>
                                        {empty
                                            ? <span className="w-full" style={{ height: 2, background: 'var(--border)', borderRadius: 1 }} />
                                            : <span className="w-full" style={{ height: `${hPct}%`, background: i === idx ? 'var(--ink)' : 'var(--ink-4)', borderRadius: 2 }} />}
                                    </button>
                                )
                            })}
                        </div>
                        <div className="mt-[var(--s2)] flex gap-[3px]">
                            {months.map((m, i) => (
                                <span key={m.month} className="flex-1 text-center" style={{ fontSize: 9.5, fontWeight: i === idx ? 700 : 400, color: i === idx ? 'var(--ink)' : 'var(--ink-4)' }}>
                                    {TR_MON_LETTER[Number(m.month.slice(5, 7)) - 1]}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Key metrics */}
                    <div className="pt-[var(--s2)]" style={{ borderTop: '1px solid var(--border)' }}>
                        <KeyMetricsTable yearly={yearly} bare />
                    </div>

                    {/* Liste */}
                    <div className="pt-[var(--s2)]" style={{ borderTop: '1px solid var(--border)' }}>
                        {kind === 'net' ? (
                            <div className="grid grid-cols-1 gap-[var(--s4)] sm:grid-cols-2">
                                <NetBlock title="Giren" color="var(--flow-in)" total={selMonth?.income ?? 0} rows={incomeRows} />
                                <NetBlock title="Çıkan" color="var(--flow-out)" total={selMonth?.expense ?? 0} rows={expenseRows} linkExpense />
                            </div>
                        ) : (
                            <>
                                <div className="mb-[var(--s3)]" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                                    {kind === 'harcama' ? 'Kategoriler' : 'Gelir kaynakları'}
                                </div>
                                <div className="flex flex-col gap-[var(--s1)]">
                                    {(kind === 'harcama' ? expenseRows : incomeRows).map(r => (
                                        <CatRow key={r.key} rowKey={r.key} label={r.label} amount={r.amount} link={kind === 'harcama'} />
                                    ))}
                                    {(kind === 'harcama' ? expenseRows : incomeRows).length === 0 && (
                                        <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Bu ay kayıt yok.</p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

/** Kategori/kaynak satırı — kimlik noktası + pill + tutar, zemin kimlik renginin düşük alfası. */
function CatRow({ rowKey, label, amount, link }: { rowKey: string; label: string; amount: number; link: boolean }) {
    const ink = categoryInk(label)
    const isRecurring = rowKey === RECURRING_KEY
    const body = (
        <div className="flex items-center gap-[var(--s2)] rounded-[var(--r-button)] px-[var(--s2)] py-[7px]" style={{ background: `color-mix(in srgb, ${ink} 7%, transparent)` }}>
            <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: isRecurring ? 'var(--ink-3)' : ink }} />
            <span className="min-w-0 flex-1"><CategoryPill name={label} /></span>
            <span className="tnum shrink-0" style={{ fontSize: 13.5, color: 'var(--ink)' }}>{formatTL(amount)}</span>
        </div>
    )
    // Yalnız gerçek kategoriler (UUID key) linklenir; düzenli/kategorisiz düz satır.
    const isUuid = /^[0-9a-f]{8}-/.test(rowKey)
    return link && isUuid
        ? <Link href={`/kategoriler?kategori=${rowKey}`} className="block transition-opacity hover:opacity-80">{body}</Link>
        : body
}

/** Net türünde Giren / Çıkan blok — başlık + toplam + kompakt liste. */
function NetBlock({ title, color, total, rows, linkExpense }: {
    title: string; color: string; total: number; rows: { key: string; label: string; amount: number }[]; linkExpense?: boolean
}) {
    return (
        <div>
            <div className="mb-[var(--s2)] flex items-baseline justify-between">
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{title}</span>
                <span className="tnum" style={{ fontSize: 15, fontWeight: 700, color }}>{formatTL(total)}</span>
            </div>
            <div className="flex flex-col gap-[var(--s1)]">
                {rows.map(r => <CatRow key={r.key} rowKey={r.key} label={r.label} amount={r.amount} link={!!linkExpense} />)}
                {rows.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Kayıt yok.</p>}
            </div>
        </div>
    )
}
