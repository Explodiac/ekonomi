import { redirect } from "next/navigation"

// Raporların işini artık Akış (/akis) üstleniyor — geçmiş dönem para akışı.
// Eski rapor kodu legacy-report.tsx'te duruyor (silinmedi), route buraya yönlenir.
export default function ReportsPage() {
    redirect("/akis")
}
