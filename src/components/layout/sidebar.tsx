'use client'

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Wallet, LogOut, ChevronDown, ChevronRight } from "lucide-react"
import { mainNav, settingsNav, isNavActive, type NavItem } from "./nav-items"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { deriveAccountBalances } from "@/lib/balance"

type Acc = { id: string; name: string; type: string; balance: number; opening_balance: number; credit_limit: number }

function formatTL(n: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n)))} ₺`
}

// Masaüstü kenar çubuğu. Mobilde gizlidir; oradaki gezinme alt bardan (BottomNav) yapılır.
export function Sidebar() {
    const pathname = usePathname()
    const [accounts, setAccounts] = useState<Acc[]>([])
    const [balances, setBalances] = useState<Map<string, number>>(new Map())
    const [monthCount, setMonthCount] = useState(0)
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

    useEffect(() => {
        const load = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return
                const hhId = await ensureHouseholdExists(user.id)
                if (!hhId) return
                const [accRes, txRes] = await Promise.all([
                    supabase.from('accounts').select('id, name, type, balance, opening_balance, credit_limit').eq('household_id', hhId),
                    supabase.from('transactions').select('account_id, amount, type, cash_date, transaction_date, transfer_direction').eq('household_id', hhId),
                ])
                const accs = (accRes.data || []) as Acc[]
                setAccounts(accs)
                setBalances(deriveAccountBalances(accs, (txRes.data || []) as any, { warn: false }))
                // Bu ay eklenen hareket sayısı (transaction_date bu ayda).
                const ym = new Date().toISOString().slice(0, 7)
                setMonthCount((txRes.data || []).filter((t: any) => (t.transaction_date || '').slice(0, 7) === ym).length)
            } catch (e) {
                console.error('Sidebar verisi alınamadı:', e)
            }
        }
        load()
    }, [pathname])

    const bal = (id: string) => balances.get(id) ?? 0
    const cards = accounts.filter(a => a.type === 'credit_card')
    const banks = accounts.filter(a => a.type !== 'credit_card' && a.type !== 'investment')
    const toggle = (k: string) => setCollapsed(c => ({ ...c, [k]: !c[k] }))

    const renderItem = (item: NavItem, badge?: number) => {
        const active = isNavActive(item, pathname)
        return (
            <Link
                key={item.name}
                href={item.href}
                className="relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors"
                style={{
                    // Seçili öğe: --ink metin + hafif zemin + sol kenarda --accent çizgi.
                    background: active ? 'var(--fill-track)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
                    fontWeight: active ? 600 : 400,
                }}
            >
                {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full" style={{ background: 'var(--accent)' }} />
                )}
                <item.icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.75} />
                <span className="flex-1">{item.name}</span>
                {badge != null && badge > 0 && (
                    <span
                        className="tnum inline-flex min-w-[18px] items-center justify-center px-[5px]"
                        style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 'var(--r-pill)', fontSize: 11, fontWeight: 600, height: 18 }}
                    >
                        {badge}
                    </span>
                )}
            </Link>
        )
    }

    const AccountGroup = ({ id, title, list, dot }: { id: string; title: string; list: Acc[]; dot: string }) => {
        if (list.length === 0) return null
        const open = !collapsed[id]
        return (
            <div>
                <button onClick={() => toggle(id)} className="flex w-full items-center gap-1 px-3 py-1" style={{ color: 'var(--ink-4)' }}>
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{title}</span>
                </button>
                {open && list.map(a => {
                    const value = a.type === 'credit_card' ? Math.abs(Math.min(0, bal(a.id))) : bal(a.id)
                    return (
                        <Link
                            key={a.id}
                            href={`/varlik?hesap=${a.id}`}
                            className="flex items-center gap-2 rounded-[10px] py-[6px] pl-5 pr-3 transition-colors hover:bg-[var(--fill-track)]"
                        >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                            <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{a.name}</span>
                            <span className="tnum shrink-0" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{formatTL(value)}</span>
                        </Link>
                    )
                })}
            </div>
        )
    }

    return (
        <div
            className="hidden w-64 flex-col lg:flex"
            style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
        >
            <div className="flex h-16 shrink-0 items-center px-6">
                <Wallet className="h-6 w-6" style={{ color: 'var(--accent)' }} />
                <span className="ml-3 text-lg font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
                    Aile Bütçesi
                </span>
            </div>

            <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
                {mainNav.map(item => renderItem(item, item.href === '/hareketler' ? monthCount : undefined))}

                {/* HESAPLARIM — türe göre gruplu, türetilmiş bakiyeler */}
                {accounts.length > 0 && (
                    <div className="mt-4 space-y-1">
                        <div className="px-3 pb-1" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                            Hesaplarım
                        </div>
                        <AccountGroup id="g-cards" title="Kredi kartları" list={cards} dot="var(--flow-out)" />
                        <AccountGroup id="g-banks" title="Hesaplar" list={banks} dot="var(--accent)" />
                    </div>
                )}

                <div className="my-2 h-px" style={{ background: 'var(--border)' }} />
                {renderItem(settingsNav)}
            </div>

            <div className="mt-auto p-4" style={{ borderTop: '1px solid var(--border)' }}>
                <button
                    className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors"
                    style={{ color: 'var(--flow-out)' }}
                >
                    <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    Çıkış Yap
                </button>
            </div>
        </div>
    )
}
