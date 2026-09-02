/**
 * DeltaChip — bir değişimin (delta) yönünü ve büyüklüğünü taşıyan çip.
 *
 * Renk rolü 2 (yön): artı → --flow-in, eksi → --flow-out. Renk YALNIZCA çipin
 * içinde; çevresindeki bağlam metni nötr (--ink-3). Zemin, yön renginin %15
 * alfası — sayı ve ok net okunur, kart düzeni sakin kalır.
 *
 * value === 0 → "sabit", nötr (--ink-3), yön oku yok.
 */

function formatTL(amount: number): string {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(amount)))} ₺`
}

export function DeltaChip({ value, context, className = "", directionValue }: {
    value: number
    /** Çipin yanındaki nötr bağlam ("1 ayda", "önceki aya göre" …). */
    context?: string
    className?: string
    /**
     * Ok yönü bu değerin işaretinden gelir (matematiksel değişim: arttı ↑ / azaldı ↓).
     * `value` ise RENK ve büyüklük içindir (iyilik yönü). Verilmezse ok da value'dan.
     * Örn. harcama arttı: directionValue > 0 (↑) ama value < 0 (kötü → --flow-out).
     */
    directionValue?: number
}) {
    const zero = Math.round(value) === 0
    const positive = value > 0
    const color = zero ? 'var(--ink-3)' : positive ? 'var(--flow-in)' : 'var(--flow-out)'
    const dir = directionValue ?? value
    const arrow = Math.round(dir) === 0 ? '' : dir > 0 ? '↑' : '↓'

    return (
        <span className={`inline-flex items-center gap-[var(--s2)] ${className}`}>
            <span
                className="tnum inline-flex items-center gap-[3px] px-[7px] py-[2px]"
                style={{
                    fontSize: 12, fontWeight: 600,
                    color,
                    background: zero ? 'var(--fill-track)' : `color-mix(in srgb, ${color} 15%, transparent)`,
                    borderRadius: 'var(--r-pill)',
                }}
            >
                {arrow && <span aria-hidden>{arrow}</span>}
                {zero ? 'sabit' : formatTL(value)}
            </span>
            {context && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{context}</span>}
        </span>
    )
}
