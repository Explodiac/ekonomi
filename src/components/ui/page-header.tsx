import Link from "next/link"
import { ChevronLeft } from "lucide-react"

/**
 * Tek başlık stili — tüm ekranlar aynı dili konuşsun. Sol tarafta opsiyonel
 * ikon (kategori kimlik rengi gibi) veya geri bağlantısı; sağda başlık + alt
 * satır. Renk yalnızca ikonda; başlık daima --ink.
 */
export function PageHeader({
    title,
    subtitle,
    icon,
    backHref,
}: {
    title: string
    subtitle?: string
    icon?: React.ReactNode
    backHref?: string
}) {
    return (
        <div className="mb-[var(--s4)] flex items-center gap-[var(--s3)]">
            {backHref && (
                <Link href={backHref} className="icon-btn -ml-1 p-1" aria-label="Geri">
                    <ChevronLeft className="h-5 w-5" />
                </Link>
            )}
            {icon}
            <div className="min-w-0 space-y-1">
                <h1
                    className="truncate"
                    style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}
                >
                    {title}
                </h1>
                {subtitle && (
                    <p className="truncate" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                        {subtitle}
                    </p>
                )}
            </div>
        </div>
    )
}
