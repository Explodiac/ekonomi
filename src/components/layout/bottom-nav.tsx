'use client'

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MoreHorizontal, X } from "lucide-react"
import { mobilePrimary, mobileMore, isNavActive } from "./nav-items"

/**
 * Mobil alt navigasyon barı. 5 birincil öğe + "Daha fazla" (Hedefler, Akış,
 * Nakit, Ayarlar bir alt sayfada). Masaüstünde gizli — orada Sidebar var.
 */
export function BottomNav() {
    const pathname = usePathname()
    const [moreOpen, setMoreOpen] = useState(false)
    const moreActive = mobileMore.some(i => isNavActive(i, pathname))

    return (
        <>
            <nav
                className="fixed inset-x-0 bottom-0 z-30 flex lg:hidden"
                style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                {mobilePrimary.map(item => {
                    const active = isNavActive(item, pathname)
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            className="flex flex-1 flex-col items-center gap-1 py-2"
                            style={{ color: active ? 'var(--accent)' : 'var(--ink-3)' }}
                        >
                            <item.icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.25 : 1.75} />
                            <span style={{ fontSize: 10, fontWeight: active ? 600 : 400, lineHeight: 1 }}>{item.name}</span>
                        </Link>
                    )
                })}
                <button
                    onClick={() => setMoreOpen(true)}
                    className="flex flex-1 flex-col items-center gap-1 py-2"
                    style={{ color: moreActive ? 'var(--accent)' : 'var(--ink-3)' }}
                >
                    <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={moreActive ? 2.25 : 1.75} />
                    <span style={{ fontSize: 10, fontWeight: moreActive ? 600 : 400, lineHeight: 1 }}>Daha fazla</span>
                </button>
            </nav>

            {/* "Daha fazla" alt sayfası */}
            {moreOpen && (
                <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden" onClick={() => setMoreOpen(false)}>
                    <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.4)' }} />
                    <div
                        className="relative rounded-t-[var(--r-card)] p-[var(--s4)]"
                        style={{ background: 'var(--surface)', paddingBottom: 'calc(env(safe-area-inset-bottom) + var(--s4))' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="mb-[var(--s3)] flex items-center justify-between">
                            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Daha fazla</span>
                            <button onClick={() => setMoreOpen(false)} className="icon-btn p-1" aria-label="Kapat"><X className="h-5 w-5" /></button>
                        </div>
                        <div className="grid grid-cols-4 gap-[var(--s2)]">
                            {mobileMore.map(item => {
                                const active = isNavActive(item, pathname)
                                return (
                                    <Link
                                        key={item.name}
                                        href={item.href}
                                        onClick={() => setMoreOpen(false)}
                                        className="flex flex-col items-center gap-[6px] rounded-[var(--r-button)] py-[var(--s3)]"
                                        style={{ background: active ? 'var(--fill-track)' : 'transparent', color: active ? 'var(--accent)' : 'var(--ink-2)' }}
                                    >
                                        <item.icon className="h-6 w-6" strokeWidth={active ? 2.25 : 1.75} />
                                        <span style={{ fontSize: 11, fontWeight: active ? 600 : 400 }}>{item.name}</span>
                                    </Link>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
