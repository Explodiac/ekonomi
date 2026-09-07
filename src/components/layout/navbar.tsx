'use client'

import { Wallet, Settings, Search, User } from "lucide-react"
import Link from "next/link"

import { ModeToggle } from "@/components/mode-toggle"
import { NotificationBell } from "./NotificationBell"

export function Navbar() {
    return (
        <header className="sticky top-0 z-30 flex h-16 w-full items-center border-b bg-background/80 px-4 md:px-6 backdrop-blur-xl">
          {/* İç içerik, sayfa sütunuyla aynı ortalanmış hatta: arama solda,
              ikonlar sağda; ikisi de içerik kolonunun kenarlarıyla hizalı. */}
          <div className="mx-auto flex w-full max-w-[var(--content-max)] items-center justify-between gap-4">
            <div className="flex items-center gap-2 lg:hidden">
                <Wallet className="h-5 w-5" style={{ color: 'var(--accent)' }} />
                <span className="font-bold text-sm">Aile Bütçesi</span>
            </div>

            <div className="hidden flex-1 items-center gap-4 md:flex">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                        type="search"
                        placeholder="İşlem veya kategori ara..."
                        className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-4 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                </div>
            </div>

            <div className="flex items-center gap-4">
                {/* Ayarlar mobilde alt barda yok; buradan erişilir. */}
                <Link
                    href="/settings"
                    className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-muted lg:hidden"
                    style={{ color: 'var(--ink-3)' }}
                    aria-label="Ayarlar"
                >
                    <Settings className="h-5 w-5" />
                </Link>

                <ModeToggle />

                <NotificationBell />

                <div className="flex items-center gap-2 rounded-full border bg-card p-1 pr-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                        <User className="h-4 w-4" />
                    </div>
                    <span className="hidden text-sm font-medium md:inline">Ömer & Selin</span>
                </div>
            </div>
          </div>
        </header>
    )
}
