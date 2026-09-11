import { SectionTabs, ayarTabs } from "@/components/layout/section-tabs"

// Ayarlar bölümü kabuğu: Kategoriler / Bütçe / Tercihler / Veri sekmeleri.
// (Abonelikler ve Kontratlar ana menüye taşındı.)
export default function AyarlarLayout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <SectionTabs tabs={ayarTabs} />
            {children}
        </div>
    )
}
