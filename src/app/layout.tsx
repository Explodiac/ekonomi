import type { Metadata } from "next"
import { Plus_Jakarta_Sans } from "next/font/google"
import "../styles/tokens.css"
import "./globals.css"
import { ClientLayout } from "@/components/layout/ClientLayout"

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Aile Bütçesi",
  description: "Eşinizle ortak ev ekonomisi yönetimi",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <body className={jakarta.className} suppressHydrationWarning>
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  )
}
