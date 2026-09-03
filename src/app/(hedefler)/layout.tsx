import { SectionTabs, hedeflerTabs } from "@/components/layout/section-tabs"

// Hedefler kabuğu: Hedefler ve Alım listesi aynı nefes payından beslenir, bu
// yüzden tek sekmeli bölümde toplanır. Üstte sekmeler, altında mevcut sayfa
// içeriği (dokunulmadı). URL'ler korunur: /hedefler ve /alim-listesi.
export default function HedeflerLayout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <div className="w-full">
                <SectionTabs tabs={hedeflerTabs} />
            </div>
            {children}
        </div>
    )
}
