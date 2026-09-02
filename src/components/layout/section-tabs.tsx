'use client'

import Link from "next/link"
import { usePathname } from "next/navigation"

export type SectionTab = {
    name: string
    href: string
    /** Sağa yaslı ikincil aksiyon (ör. "Alım simüle et"). */
    secondary?: boolean
}

/**
 * Bölüm sekme çubuğu. İçerik birleştirmez — her sekme mevcut sayfaya yönlendirir.
 * Sekmeli kabuklar (Hareketler, Borç & Varlık, Ayarlar) ve alt sayfaları bunu
 * üstte gösterir; böylece kullanıcı hangi bölümde olduğunu görür, sekmeler arası
 * gezinir. Aktif sekme --ink + altında --accent çizgi.
 */
export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
    const pathname = usePathname()
    const primary = tabs.filter(t => !t.secondary)
    const secondary = tabs.filter(t => t.secondary)

    const renderTab = (tab: SectionTab) => {
        const active = pathname === tab.href
        return (
            <Link
                key={tab.href}
                href={tab.href}
                className="relative whitespace-nowrap px-1 py-2 transition-colors"
                style={{
                    fontSize: 14,
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--ink)' : tab.secondary ? 'var(--accent)' : 'var(--ink-3)',
                }}
            >
                {tab.name}
                {active && (
                    <span
                        className="absolute inset-x-0 -bottom-px h-[2px] rounded-full"
                        style={{ background: 'var(--accent)' }}
                    />
                )}
            </Link>
        )
    }

    return (
        <div
            className="mb-[var(--s5)] flex items-center justify-between gap-[var(--s4)] overflow-x-auto"
            style={{ borderBottom: '1px solid var(--border)' }}
        >
            <div className="flex items-center gap-[var(--s5)]">
                {primary.map(renderTab)}
            </div>
            {secondary.length > 0 && (
                <div className="flex items-center gap-[var(--s4)]">{secondary.map(renderTab)}</div>
            )}
        </div>
    )
}

// --- Bölüm sekme tanımları (tek kaynak) ---

// Hareketler artık sekmeli kabuk değil, tek liste (/hareketler); Gider/Gelir filtre.

export const varlikTabs: SectionTab[] = [
    { name: "Kartlar", href: "/credit-cards" },
    { name: "Hesaplar", href: "/accounts" },
    { name: "Yatırımlar", href: "/investments" },
    { name: "Alım simüle et", href: "/simulations/asset-purchase", secondary: true },
]

export const ayarTabs: SectionTab[] = [
    { name: "Kategoriler", href: "/settings" },
    { name: "Bütçe", href: "/budget" },
    { name: "Abonelikler", href: "/subscriptions" },
    { name: "Kontratlar", href: "/contracts" },
    { name: "Tercihler", href: "/tercihler" },
    { name: "Veri", href: "/data-management" },
]
