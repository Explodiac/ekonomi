/**
 * Yıllık özet tablosu — Yıl | Yıllık toplam | Aylık ortalama.
 * Kategori detay paneli ve Akış derin paneli ortak kullanır (tek kaynak).
 * İçinde bulunulan yıl için ortalama yılın geçen kısmına göre (kısmi).
 */
export type YearRow = {
    year: number
    total: number
    monthlyAvg: number
    isCurrent: boolean
}

function formatTL(amount: number): string {
    const abs = Math.abs(Math.round(amount))
    const s = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs)
    return `${amount < 0 ? '−' : ''}${s} ₺`
}

export function KeyMetricsTable({ yearly, bare }: { yearly: YearRow[]; bare?: boolean }) {
    if (yearly.length === 0) return null
    const inner = (
        <>
            <div className="mb-[var(--s3)]" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Yıllık özet</div>
            <div className="flex items-baseline" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                <span className="flex-1">Yıl</span>
                <span className="w-[120px] text-right">Yıllık toplam</span>
                <span className="w-[110px] text-right">Aylık ort.</span>
            </div>
            <div className="mt-[var(--s2)] flex flex-col">
                {yearly.map(y => (
                    <div key={y.year} className="flex items-baseline py-[var(--s2)]" style={{ borderTop: '1px solid var(--border)' }}>
                        <span className="flex-1 tnum" style={{ fontSize: 14, color: 'var(--ink)' }}>
                            {y.year}{y.isCurrent && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}> · şu ana dek</span>}
                        </span>
                        <span className="tnum w-[120px] text-right" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{formatTL(y.total)}</span>
                        <span className="tnum w-[110px] text-right" style={{ fontSize: 14, color: 'var(--ink-2)' }}>{formatTL(y.monthlyAvg)}</span>
                    </div>
                ))}
            </div>
        </>
    )
    if (bare) return <div>{inner}</div>
    return <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">{inner}</section>
}
