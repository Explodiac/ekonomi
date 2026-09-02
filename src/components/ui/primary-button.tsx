'use client'

/**
 * Tek birincil buton stili — tüm uygulamada aynı. --accent zemin, beyaz metin.
 * Her ekran kendi mavisini uydurmaz; birincil aksiyon buradan gelir.
 * Enabled tam opak; yalnızca disabled durumunda soluk.
 */
export function PrimaryButton({
    children,
    className = "",
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            className={`px-[var(--s5)] py-[var(--s3)] transition-opacity disabled:opacity-40 ${className}`}
            style={{
                background: 'var(--accent)',
                borderRadius: 'var(--r-button)',
                color: '#fff',
                fontSize: 14.5,
                fontWeight: 600,
            }}
            {...props}
        >
            {children}
        </button>
    )
}
