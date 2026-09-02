import { Landmark, Wallet, CreditCard, type LucideIcon } from "lucide-react"

/**
 * Hesap ikonu — NÖTR (kategori gibi renkli değil). Hareket satırında sol ikon
 * hesabı (banka/nakit/kart) gösterir; kategori kimliği CategoryPill'de taşınır,
 * böylece renk tek yerde kalır (çift kodlama olmaz).
 */
const ACCOUNT_ICON: Record<string, LucideIcon> = {
    bank: Landmark,
    cash: Wallet,
    credit_card: CreditCard,
}

export function AccountIcon({ type, size = 30 }: { type?: string | null; size?: number }) {
    const Icon = ACCOUNT_ICON[type || ''] ?? Wallet
    const icon = Math.round(size / 2)
    return (
        <span
            className="inline-flex shrink-0 items-center justify-center"
            style={{ height: size, width: size, background: 'var(--fill-track)', color: 'var(--ink-3)', borderRadius: 'var(--r-tile)' }}
            aria-hidden
        >
            <Icon style={{ height: icon, width: icon }} strokeWidth={1.75} />
        </span>
    )
}

/** "Vadesiz (Maaş)" → "Maaş", "Bonus Kart" → "Bonus", "Nakit" → "Nakit". */
export function shortAccount(name?: string | null): string {
    if (!name) return ''
    const paren = name.match(/\(([^)]+)\)/)
    if (paren) return paren[1]
    return name.replace(/\s+(Kart|Hesabı)$/i, '')
}
