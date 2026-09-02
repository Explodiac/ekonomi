import { SectionTabs, ayarTabs } from "@/components/layout/section-tabs"

// Ayarlar bölümü kabuğu: Kategoriler / Abonelikler / Kontratlar / Veri sekmeleri.
export default function AyarlarLayout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <SectionTabs tabs={ayarTabs} />
            {children}
        </div>
    )
}
