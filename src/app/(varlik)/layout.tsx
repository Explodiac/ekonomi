import { SectionTabs, varlikTabs } from "@/components/layout/section-tabs"
import { NetWorthSummary } from "@/components/varlik/net-worth-summary"

// Borç & Varlık kabuğu: üstte net değer özeti, altında sekmeler ve mevcut
// sayfa içeriği (dokunulmadı). Özet katmanı her alt sekmede görünür.
export default function VarlikLayout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            {/* Özet + sekmeler dar sütunda (yeni tasarım dili); alt sayfa içeriği
                kendi genişliğinde korunur — içeriğe dokunulmadı. */}
            <div className="w-full">
                <NetWorthSummary />
                <SectionTabs tabs={varlikTabs} />
            </div>
            {children}
        </div>
    )
}
