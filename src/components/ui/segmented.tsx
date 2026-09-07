'use client'

/**
 * Tek seçili-durum stili — filtre/segment seçicileri için. Menüyle tutarlı:
 * dolu mavi blok yok; seçili = --ink metin + hafif --ink-4 zemin.
 * Akış, Hareketler, Varlık simülasyonu vb. hepsi bunu kullanır.
 */
export function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string }[]
    value: T
    onChange: (value: T) => void
}) {
    return (
        <div className="flex gap-[var(--s2)]">
            {options.map(o => {
                const active = value === o.value
                return (
                    <button
                        key={o.value}
                        type="button"
                        onClick={() => onChange(o.value)}
                        className="shrink-0 whitespace-nowrap px-[var(--s4)] py-[var(--s2)] transition-colors"
                        style={{
                            fontSize: 13.5,
                            borderRadius: 'var(--r-button)',
                            background: active ? 'var(--ink-4)' : 'transparent',
                            color: active ? 'var(--ink)' : 'var(--ink-3)',
                            fontWeight: active ? 600 : 400,
                        }}
                    >
                        {o.label}
                    </button>
                )
            })}
        </div>
    )
}
