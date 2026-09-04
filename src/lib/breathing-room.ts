/**
 * Nefes payı (breathing room) — bir taksit/yük aylık bütçede ne kadar yer bırakıyor.
 *
 * KRİTİK: Alışkanlık harcaması (market, yemek, ulaşım …) çıkışa DAHİL edilir.
 * Teorik olarak kısılabilir ama pratikte kısılmaz; hesaptan çıkarmak nefes payını
 * olduğundan büyük gösterir. Ama iki tür çıkış aynı değildir, AYRI tutulur:
 *
 *   ZORUNLU (mandatory):   sabit gider + taksit + kredi + hedef payı — kaçınılamaz.
 *   ALIŞKANLIK (habitual): değişken harcama tahmini (estimate.ts, son 3 ay ortalaması)
 *                          — kısılabilir ama kısılmaz; kısma imkânı olarak gösterilir.
 *
 * İki rakam döner:
 *   breathingRoom   (gerçek)  = taban gelir − zorunlu − alışkanlık
 *   theoreticalRoom (teorik)  = taban gelir − zorunlu   (alışkanlığın tamamı kısılsa)
 *
 * Açık varsa `requiredCutRatio`, alışkanlıktan ne kadar kısmak gerektiğini söyler
 * (kuru "yetmiyor"dan farkı budur). Oran > 1 ise senaryo imkânsızdır.
 *
 * Saf fonksiyon, salt okuma. estimate.ts alışkanlık tahmininin tek kaynağıdır.
 */

import { estimateAllCategories, MIN_BASIS_MONTHS, type EstimateTransaction } from './estimate.ts'

function toNum(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

export type HabitualCategory = {
    categoryId: string
    label: string
    /** Aylık ortalama (pozitif). */
    amount: number
}

export type BreathingRoomInput = {
    /** Güvenilir aylık taban gelir. Kırılganlık testi için değişken gelir sıfırlanmış hâli verilir. */
    baseIncome: number
    /** Zorunlu aylık çıkış: sabit gider + taksit + kredi + hedef payı (çağıran toplar). */
    mandatoryOutflow: number
    /** Alışkanlık tahmini için hareketler (estimate.ts kuralıyla). */
    transactions: EstimateTransaction[]
    /** 'YYYY-MM' — içinde bulunulan ay. Alışkanlık son 3 tam aydan hesaplanır. */
    currentMonth: string
    /** Değerlendirilen taksit/yük (varsa). afterPurchase = breathingRoom − bu. */
    monthlyInstallment?: number
}

export type BreathingRoom = {
    baseIncome: number
    /** Sabit + taksit + kredi + hedef payı. */
    mandatoryOutflow: number
    /** Değişken tahmin toplamı (yeterli veri yoksa 0). */
    habitualOutflow: number
    /** Alışkanlık kırılımı, tutara göre azalan (kısma önerisi için). */
    habitualByCategory: HabitualCategory[]
    /** Gerçek: gelir − zorunlu − alışkanlık. */
    breathingRoom: number
    /** Teorik: gelir − zorunlu (alışkanlığın tamamı kısılsa kalan). */
    theoreticalRoom: number
    /** Taksit verildiyse breathingRoom − taksit; verilmediyse null. */
    afterPurchase: number | null
    /** Açık varsa gereken kısma oranı = açık / alışkanlık toplamı. Alışkanlık 0/veri yoksa null. > 1 → imkânsız. */
    requiredCutRatio: number | null
    /**
     * Alışkanlık gerçekten hesaplanabildi mi. false → son 3 tam ay verisi yok
     * (genç hesap); alışkanlık 0 sayıldı, çağıran "sadece zorunlu" olduğunu belirtmeli.
     * (Veri var ama değişken harcama gerçekten yoksa true + habitualOutflow 0.)
     */
    habitualEstimated: boolean
    /** Basis penceresinde sınıflanmamış (spend_nature null) değişken hareket sayısı. */
    unclassifiedCount: number
    /** Sınıflanmamış değişken harcamanın AYLIK ortalaması (habitualOutflow ile aynı ölçek). */
    unclassifiedTotal: number
}

function toNumber(value: number | null | undefined): number {
    return Number.isFinite(value as number) ? (value as number) : 0
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
function round4(n: number): number { return Math.round(n * 10000) / 10000 }

/** currentMonth'tan delta ay kaydırır (delta negatif = geçmiş). */
function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function computeBreathingRoom(input: BreathingRoomInput): BreathingRoom {
    const baseIncome = round2(toNumber(input.baseIncome))
    const mandatoryOutflow = round2(toNumber(input.mandatoryOutflow))

    // Alışkanlık = son 3 tam ay ortalaması, kategori bazında (estimate.ts tek kaynak).
    const estimates = estimateAllCategories(input.transactions, input.currentMonth)
    const rawHabitual: HabitualCategory[] = estimates.map(e => ({ categoryId: e.categoryId, label: e.label, amount: e.amount }))

    // Yeterli veri var mı? Son 3 tam ayın kaçında herhangi bir gider hareketi var.
    // < 3 → hesap genç, tahmin güvenilmez (yalnız zorunlu hesapla, belirt).
    const basis = new Set([1, 2, 3].map(i => shiftMonth(input.currentMonth, -i)))
    const monthsWithData = new Set<string>()
    // Sınıflanmamış (spend_nature null) değişken harcama — ortalamaya giriyor ama belirsiz.
    let unclassifiedSum = 0, unclassifiedCount = 0
    for (const t of input.transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        const mk = t.cash_date.slice(0, 7)
        if (!basis.has(mk)) continue
        monthsWithData.add(mk)
        if (!t.source_type && (t.spend_nature == null)) {
            unclassifiedSum += Math.abs(toNum(t.amount))
            unclassifiedCount++
        }
    }
    const habitualEstimated = monthsWithData.size >= MIN_BASIS_MONTHS
    const unclassifiedTotal = round2(unclassifiedSum / MIN_BASIS_MONTHS)

    const habitualByCategory = habitualEstimated ? rawHabitual : []
    const habitualOutflow = round2(habitualByCategory.reduce((s, c) => s + c.amount, 0))

    const theoreticalRoom = round2(baseIncome - mandatoryOutflow)
    const breathingRoom = round2(theoreticalRoom - habitualOutflow)

    const hasInstallment = input.monthlyInstallment != null
    const afterPurchase = hasInstallment ? round2(breathingRoom - round2(toNumber(input.monthlyInstallment))) : null

    // Açık: taksit varsa taksit sonrası, yoksa nefes payının kendisi negatifse.
    const effectiveRoom = hasInstallment ? (afterPurchase as number) : breathingRoom
    const deficit = effectiveRoom < 0 ? -effectiveRoom : 0
    const requiredCutRatio = deficit > 0 && habitualOutflow > 0 ? round4(deficit / habitualOutflow) : null

    return {
        baseIncome,
        mandatoryOutflow,
        habitualOutflow,
        habitualByCategory,
        breathingRoom,
        theoreticalRoom,
        afterPurchase,
        requiredCutRatio,
        habitualEstimated,
        unclassifiedCount,
        unclassifiedTotal,
    }
}
