"use client"

import { usePathname } from "next/navigation"
import { Sidebar } from "./sidebar"
import { Navbar } from "./navbar"
import { BottomNav } from "./bottom-nav"
import { ThemeProvider } from "@/components/theme-provider"

export function ClientLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const isLoginPage = pathname === '/login' || pathname === '/'

    return (
        <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
        >
            {isLoginPage ? (
                <div className="h-screen w-full overflow-auto">
                    {children}
                </div>
            ) : (
                <div className="flex h-screen w-full overflow-hidden bg-background">
                    <Sidebar />
                    <div className="flex flex-1 flex-col overflow-hidden w-full">
                        <Navbar />
                        {/* Sayfa zemini tasarım token'ından (--bg) gelir; ek tint uygulanmaz.
                            Mobilde alt navigasyon barı için ekstra alt boşluk. */}
                        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 lg:pb-6">
                            {/* Tüm ekranlar için TEK ortak hizalama container'ı: masaüstünde
                                ortalanmış tek sütun (Navbar aramasıyla aynı hat), mobilde tam
                                genişlik. Ekran içerikleri kendi tasarımıyla bunun içine oturur. */}
                            <div className="mx-auto w-full max-w-[var(--content-max)]">
                                {children}
                            </div>
                        </main>
                    </div>
                    <BottomNav />
                </div>
            )}
        </ThemeProvider>
    )
}
