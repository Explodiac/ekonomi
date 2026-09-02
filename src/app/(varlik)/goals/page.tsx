import { redirect } from "next/navigation"

// Hedefler artık ana menüde ayrı ekran (/hedefler). Eski Borç & Varlık sekmesi
// buraya gelenleri yeni ekrana taşır.
export default function GoalsRedirect() {
    redirect("/hedefler")
}
