import {
    ShoppingCart, Bus, UtensilsCrossed, ReceiptText, HeartPulse,
    Clapperboard, Shirt, GraduationCap, RefreshCw, Home, Tag,
    Zap, Droplet, Flame, Wifi, Building2,
    type LucideIcon,
} from "lucide-react"

/**
 * Kategori kimliği: renk YALNIZCA kategoriyi ayırt etmek içindir.
 * Durum, uyarı veya artı/eksi bildirimi için kullanılmaz.
 */
type CategoryStyle = { bg: string; ink: string; Icon: LucideIcon }

const CATEGORIES: Record<string, CategoryStyle> = {
    market: { bg: 'var(--cat-market-bg)', ink: 'var(--cat-market)', Icon: ShoppingCart },
    ulasim: { bg: 'var(--cat-transport-bg)', ink: 'var(--cat-transport)', Icon: Bus },
    yemek: { bg: 'var(--cat-food-bg)', ink: 'var(--cat-food)', Icon: UtensilsCrossed },
    fatura: { bg: 'var(--cat-home-bg)', ink: 'var(--cat-home)', Icon: ReceiptText },
    saglik: { bg: 'var(--cat-health-bg)', ink: 'var(--cat-health)', Icon: HeartPulse },
    eglence: { bg: 'var(--cat-fun-bg)', ink: 'var(--cat-fun)', Icon: Clapperboard },
    giyim: { bg: 'var(--cat-shopping-bg)', ink: 'var(--cat-shopping)', Icon: Shirt },
    egitim: { bg: 'var(--cat-edu-bg)', ink: 'var(--cat-edu)', Icon: GraduationCap },
    abonelik: { bg: 'var(--cat-sub-bg)', ink: 'var(--cat-sub)', Icon: RefreshCw },
    ev: { bg: 'var(--cat-home-bg)', ink: 'var(--cat-home)', Icon: Home },
    // Ev alt kategorileri — ayırt edici kimlik renkleri (yığılmış barda okunur).
    elektrik: { bg: 'var(--cat-transport-bg)', ink: 'var(--cat-transport)', Icon: Zap },
    su: { bg: 'var(--cat-edu-bg)', ink: 'var(--cat-edu)', Icon: Droplet },
    dogalgaz: { bg: 'var(--cat-food-bg)', ink: 'var(--cat-food)', Icon: Flame },
    internet: { bg: 'var(--cat-sub-bg)', ink: 'var(--cat-sub)', Icon: Wifi },
    aidat: { bg: 'var(--cat-health-bg)', ink: 'var(--cat-health)', Icon: Building2 },
    // Tablo dışı her kategori buraya düşer — dolu genel ikon, boş/kesikli daire ASLA.
    diger: { bg: 'var(--cat-other-bg)', ink: 'var(--cat-other)', Icon: Tag },
}

/** Kategori adını token anahtarına eşler; Türkçe karakterler sadeleştirilir. */
export function categoryKey(name: string | null | undefined): keyof typeof CATEGORIES {
    if (!name) return 'diger'
    // ̇: "İ".toLowerCase() araya birleşik nokta ekler → "internet" gibi eşleşmeleri bozar.
    const n = name.toLowerCase()
        .replace(/̇/g, '')
        .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
        .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')

    if (n.includes('market') || n.includes('gida')) return 'market'
    if (n.includes('ulasim') || n.includes('yakit') || n.includes('benzin')) return 'ulasim'
    if (n.includes('yemek') || n.includes('restoran') || n.includes('kahve')) return 'yemek'
    if (n.includes('elektrik')) return 'elektrik'
    if (n === 'su' || n.includes('su faturas')) return 'su'
    if (n.includes('dogalgaz') || n.includes('gaz')) return 'dogalgaz'
    if (n.includes('internet')) return 'internet'
    if (n.includes('aidat')) return 'aidat'
    if (n.includes('fatura')) return 'fatura'
    if (n.includes('saglik') || n.includes('eczane')) return 'saglik'
    if (n.includes('eglence')) return 'eglence'
    if (n.includes('giyim') || n.includes('alisveris')) return 'giyim'
    if (n.includes('egitim') || n.includes('okul') || n.includes('kurs')) return 'egitim'
    if (n.includes('abonelik')) return 'abonelik'
    if (n === 'ev' || n.includes('konut')) return 'ev'
    return 'diger'
}

/** Kategori kimlik rengi (ink); flow barları gibi zeminsiz yerlerde kullanılır. */
export function categoryInk(name: string | null | undefined): string {
    return CATEGORIES[categoryKey(name)].ink
}

export function CategoryTile({ name, size = 30 }: { name?: string | null; size?: number }) {
    const { bg, ink, Icon } = CATEGORIES[categoryKey(name)]
    const icon = Math.round(size / 2)

    return (
        <span
            className="inline-flex shrink-0 items-center justify-center"
            style={{ height: size, width: size, background: bg, color: ink, borderRadius: 'var(--r-tile)' }}
            aria-hidden
        >
            <Icon style={{ height: icon, width: icon }} strokeWidth={1.75} />
        </span>
    )
}

/**
 * CategoryPill — Copilot tarzı kategori etiketi: küçük ikon + BÜYÜK HARF ad,
 * kategori kimlik renginde metin, o rengin %15 alfa zemini, --r-pill.
 *
 * KURAL: pill'li satırda TUTAR nötr (--ink) bırakılır — satır kimlik rengini
 * zaten pill'den alır; rakam da renklenirse bir öğe iki rol taşır.
 */
export function CategoryPill({ name }: { name?: string | null }) {
    const { ink, Icon } = CATEGORIES[categoryKey(name)]
    return (
        <span
            className="inline-flex shrink-0 items-center gap-[4px] px-[7px] py-[2px]"
            style={{ background: `color-mix(in srgb, ${ink} 15%, transparent)`, color: ink, borderRadius: 'var(--r-pill)' }}
        >
            <Icon style={{ height: 11, width: 11 }} strokeWidth={2} />
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.2 }}>
                {name || 'Diğer'}
            </span>
        </span>
    )
}
