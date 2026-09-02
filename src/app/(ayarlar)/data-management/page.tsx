'use client'

import { useState } from "react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { PrimaryButton } from "@/components/ui/primary-button"
import { Download, Upload, FileJson, FileText, Table, AlertTriangle, CheckCircle2, Loader2, Database, ShieldCheck, Trash2 } from "lucide-react"

export default function DataManagementPage() {
    const [isLoading, setIsLoading] = useState(false)
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)

    const handleExportJSON = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)

            // Tüm kullanıcı verisi. household_id ile filtrelenenler + alt tablolar
            // (contract_payments / installment_payments household_id taşımaz; RLS
            // onları zaten aileye kısıtlar, select('*') yeterli). select('*')
            // olduğu için tüm kolonlar dahil: spend_nature, default_nature, note,
            // transfer_group_id, transfer_direction vb. otomatik gelir.
            const byHh = (t: string) => supabase.from(t).select('*').eq('household_id', hhId)
            const all = (t: string) => supabase.from(t).select('*')

            const [
                transactions, accounts, categories, investments,
                goals, goal_contributions, budget_periods, settings,
                subscriptions, contracts, contract_payments,
                installments, installment_payments, dismissed_recurring,
            ] = await Promise.all([
                byHh('transactions'), byHh('accounts'), byHh('categories'), byHh('investments'),
                byHh('goals'), byHh('goal_contributions'), byHh('budget_periods'), byHh('settings'),
                byHh('subscriptions'), byHh('contracts'), all('contract_payments'),
                byHh('installments'), all('installment_payments'), byHh('dismissed_recurring'),
            ])

            // Bir tablo bile hata verirse yedek eksik olur — sessizce yutma.
            const results = { transactions, accounts, categories, investments, goals, goal_contributions, budget_periods, settings, subscriptions, contracts, contract_payments, installments, installment_payments, dismissed_recurring }
            const failed = Object.entries(results).filter(([, r]) => r.error).map(([k, r]) => `${k}: ${r.error!.message}`)
            if (failed.length) throw new Error('Bazı tablolar alınamadı — ' + failed.join('; '))

            const fullData = {
                export_date: new Date().toISOString(),
                schema_version: '2026-08-18',
                transactions: transactions.data,
                accounts: accounts.data,
                categories: categories.data,
                investments: investments.data,
                goals: goals.data,
                goal_contributions: goal_contributions.data,
                budget_periods: budget_periods.data,
                settings: settings.data,
                subscriptions: subscriptions.data,
                contracts: contracts.data,
                contract_payments: contract_payments.data,
                installments: installments.data,
                installment_payments: installment_payments.data,
                dismissed_recurring: dismissed_recurring.data,
            }

            const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `ekonomi_yedek_${new Date().toISOString().split('T')[0]}.json`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            setStatus({ type: 'success', message: 'Tüm verileriniz JSON formatında başarıyla indirildi.' })
        } catch (error: any) {
            setStatus({ type: 'error', message: 'Dışa aktarma sırasında hata oluştu: ' + error.message })
        } finally {
            setIsLoading(false)
        }
    }

    const handleExportCSV = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            const { data } = await supabase.from('transactions').select('*, categories(name)').eq('household_id', hhId)

            if (!data || data.length === 0) {
                setStatus({ type: 'error', message: 'Dışa aktarılacak işlem bulunamadı.' })
                return
            }

            const headers = ['Tarih', 'Açıklama', 'Miktar', 'Kategori', 'Tip']
            const rows = data.map(t => [
                new Date(t.transaction_date).toLocaleDateString('tr-TR'),
                t.description,
                t.amount,
                t.categories?.name || 'Kategorisiz',
                t.type
            ])

            const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n")
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `harcamalar_${new Date().toISOString().split('T')[0]}.csv`
            a.click()
            URL.revokeObjectURL(url)

            setStatus({ type: 'success', message: 'Harcamalarınız CSV formatında dışa aktarıldı.' })
        } catch (error: any) {
            setStatus({ type: 'error', message: 'CSV dışa aktarma hatası: ' + error.message })
        } finally {
            setIsLoading(false)
        }
    }

    const handleResetData = async () => {
        if (!window.confirm("BÜYÜK UYARI: Bu işlem hesaplar, harcamalar, kategoriler dahil TÜM verilerinizi kalıcı olarak silecektir. Emin misiniz?")) return;
        if (!window.confirm("Son Kararınız mı? Bu işlem GERİ ALINAMAZ ve verileriniz sonsuza dek kaybolur.")) return;

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) throw new Error("Aile bilgisi bulunamadı.")

            // Veritabanındaki tüm tabloları sırasıyla temizliyoruz.
            // İlişkisel bütünlük (foreign keys) sebebiyle sıraya dikkat ediyoruz.
            const tables = [
                'installment_payments',
                'installments',
                'contract_payments',
                'contracts',
                'subscriptions',
                'transactions',
                'goals',
                'investments',
                'accounts',
                'categories',
                'notifications'
            ];

            for (const table of tables) {
                const { error } = await supabase.from(table).delete().eq('household_id', hhId);
                if (error) {
                    console.error(`${table} silinirken hata:`, error);
                }
            }

            setStatus({ type: 'success', message: 'Tüm verileriniz başarıyla sıfırlandı. Yepyeni bir başlangıç yapabilirsiniz!' })
            
            setTimeout(() => {
                window.location.href = '/dashboard'
            }, 2000)
            
        } catch (error: any) {
            setStatus({ type: 'error', message: 'Sıfırlama sırasında hata oluştu: ' + error.message })
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="flex flex-col gap-[var(--s4)] pb-10">
            <div>
                <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Veri ve yedekleme</h1>
                <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Verilerinizi dışa aktarın veya sıfırdan başlayın.</p>
            </div>

            {status && (
                <div className="flex items-center gap-[var(--s3)] p-[var(--s3)]" style={{
                    borderRadius: 'var(--r-card)',
                    background: `color-mix(in srgb, ${status.type === 'success' ? 'var(--flow-in)' : 'var(--flow-out)'} 12%, transparent)`,
                    color: status.type === 'success' ? 'var(--flow-in)' : 'var(--flow-out)',
                }}>
                    {status.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{status.message}</span>
                </div>
            )}

            {/* Dışa aktar */}
            <section className="space-y-[var(--s3)] p-[22px]" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Verileri dışa aktar</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Tüm geçmişinizi ve ayarlarınızı yerel bir dosyaya kaydedin.</div>
                </div>
                <PrimaryButton onClick={handleExportJSON} disabled={isLoading} className="w-full">
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
                    JSON olarak indir (tam yedek)
                </PrimaryButton>
                <button
                    onClick={handleExportCSV} disabled={isLoading}
                    className="flex w-full items-center justify-center gap-[var(--s2)] py-[var(--s3)]"
                    style={{ background: 'var(--surface-2)', color: 'var(--ink)', borderRadius: 'var(--r-button)', fontSize: 14 }}
                >
                    <Table className="h-4 w-4" /> Harcamaları CSV olarak indir
                </button>
            </section>

            {/* İçe aktar — geliştiriliyor */}
            <section className="p-[22px]" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)', opacity: 0.75 }}>
                <div className="flex items-center justify-between">
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Veri içe aktar</div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 'var(--r-pill)' }}>Geliştiriliyor</span>
                </div>
                <p className="mt-[var(--s2)]" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                    CSV banka dökümlerinizi otomatik kategorize edip sisteme ekleyebileceksiniz.
                </p>
            </section>

            {/* Güvenlik notu */}
            <div className="flex items-start gap-[var(--s3)] p-[var(--s4)]" style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }}>
                <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: 'var(--accent)' }} />
                <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Veri gizliliği ve güvenliği</div>
                    <p className="mt-[2px]" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                        Dışa aktardığınız dosya tüm finansal geçmişinizi içerir; güvenli bir yerde saklayın.
                    </p>
                </div>
            </div>

            {/* Tehlikeli alan */}
            <section className="space-y-[var(--s3)] p-[22px]" style={{ background: 'color-mix(in srgb, var(--flow-out) 6%, var(--surface))', borderRadius: 'var(--r-card)', border: '1px solid color-mix(in srgb, var(--flow-out) 30%, transparent)' }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--flow-out)' }}>Tüm verileri sıfırla</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Hesaplar, harcamalar, hedefler ve ayarlar kalıcı olarak silinir.</div>
                </div>
                <button
                    onClick={handleResetData} disabled={isLoading}
                    className="flex w-full items-center justify-center gap-[var(--s2)] py-[var(--s3)]"
                    style={{ background: 'color-mix(in srgb, var(--flow-out) 15%, transparent)', color: 'var(--flow-out)', borderRadius: 'var(--r-button)', fontSize: 14, fontWeight: 600 }}
                >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Verilerimi kalıcı olarak sil
                </button>
            </section>
        </div>
    )
}
