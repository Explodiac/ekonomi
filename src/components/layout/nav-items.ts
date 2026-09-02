import {
    LayoutDashboard, Activity, CalendarRange, Banknote,
    ArrowLeftRight, Landmark, Target, PieChart, Settings, type LucideIcon,
} from "lucide-react"

export type NavItem = {
    name: string
    href: string
    icon: LucideIcon
    /** Bu ana öğeye ait alt route'lar; aktiflik vurgusu bunları da kapsar. */
    match?: string[]
}

// Ana navigasyon — Copilot sırası: Bugün, Hareketler, Hedefler, Akış, Nakit,
// Yaklaşan, Kategoriler, Hesaplar. Alt sayfalar sekmeli kabuklar altında toplanır.
export const mainNav: NavItem[] = [
    { name: "Bugün", href: "/dashboard", icon: LayoutDashboard },
    { name: "Hareketler", href: "/hareketler", icon: ArrowLeftRight, match: ["/expenses", "/incomes"] },
    { name: "Hedefler", href: "/hedefler", icon: Target, match: ["/goals"] },
    { name: "Akış", href: "/akis", icon: Activity, match: ["/reports"] },
    { name: "Nakit", href: "/nakit", icon: Banknote },
    { name: "Yaklaşan", href: "/yaklasan", icon: CalendarRange },
    { name: "Kategoriler", href: "/kategoriler", icon: PieChart, match: ["/kategori"] },
    {
        name: "Hesaplar", href: "/varlik", icon: Landmark,
        match: ["/credit-cards", "/accounts", "/investments", "/simulations/asset-purchase"],
    },
]

export const settingsNav: NavItem = {
    name: "Ayarlar", href: "/settings", icon: Settings,
    match: ["/budget", "/subscriptions", "/contracts", "/tercihler", "/data-management"],
}

// Mobil alt bar 5 öğe taşır; kalanlar "Daha fazla" altında.
export const mobilePrimary: NavItem[] = [
    mainNav[0], // Bugün
    mainNav[1], // Hareketler
    mainNav[6], // Kategoriler
    mainNav[5], // Yaklaşan
    mainNav[7], // Hesaplar
]
export const mobileMore: NavItem[] = [
    mainNav[2], // Hedefler
    mainNav[3], // Akış
    mainNav[4], // Nakit
    settingsNav, // Ayarlar
]

/** Bir path verilen nav öğesini aktif kılıyor mu? */
export function isNavActive(item: NavItem, pathname: string): boolean {
    if (pathname === item.href) return true
    return (item.match ?? []).some(m => pathname === m || pathname.startsWith(m + "/"))
}
