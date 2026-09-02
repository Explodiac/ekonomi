import { redirect } from "next/navigation"

// Kategori detayı tek sayfada yaşıyor: /kategoriler?kategori=<id>. Eski derin
// bağlantılar oraya yönlenir (çift bakım olmasın).
export default async function KategoriRedirect({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    redirect(`/kategoriler?kategori=${id}`)
}
