/**
 * Hedef ilerlemesi — birikim, tik şeridi, ETA ve tarihe yetişme.
 *
 * Saf fonksiyon. Birim-agnostiktir: tüm hedef değerleri (targetAmount, savedAmount,
 * monthlyAlloc) İLERLEME BİRİMİ cinsindedir. TRY hedefte lira, GRAM_ALTIN hedefte gram.
 * Çağıran taraf is_fiat/asset_unit'e bakıp doğru birimi verir.
 *
 * saved = savedAmount + Σ katkı. savedAmount, hedef sisteme girmeden ÖNCE birikmiş
 * başlangıç bakiyesidir (goals.saved_tl/saved_gold …); goal_contributions ise gerçekleşen
 * katkılardır (kaynak). Böylece çift sayma olmaz.
 *
 * BİRİM ÇEVİRİSİ: katkılar TL girilir (goal_contributions.amount). TRY hedefte doğrudan
 * sayılır. TRY dışı hedefte katkının birim karşılığı (unitAmount) gerekir — çağıran o günkü
 * kurla doldurur. Dolduramadıysa (kur yok) o katkı birim ilerlemesine GİRMEZ ve
 * unconvertedCount ile bildirilir.
 */

export type GoalProgressGoal = {
    /** Hedef tutarı (ilerleme birimi cinsinden). */
    targetAmount: number | string
    /** Başlangıç bakiyesi — hedeften önce birikmiş (ilerleme birimi). Varsayılan 0. */
    savedAmount?: number | string | null
    /** Aylık ayrılan pay (ilerleme birimi). Yoksa ETA hesaplanamaz. */
    monthlyAlloc?: number | string | null
    /** 'YYYY-MM-DD' hedef tarihi (deadline). Yoksa onTrack null. */
    targetDate?: string | null
    /** 'TRY' (varsayılan) | 'USD' | 'EUR' | 'GRAM_ALTIN' … */
    unit?: string | null
}

export type GoalContributionInput = {
    /** 'YYYY-MM-DD' ya da 'YYYY-MM' — ay bazına indirgenir. */
    period: string
    /** TL cinsinden katkı tutarı (tik şeridi ve TRY ilerlemesi bundan). */
    amount: number | string
    /** Birim karşılığı (TRY dışı hedefte). null/verilmemiş → çevrilemedi. */
    unitAmount?: number | string | null
}

export type GoalProgressInput = {
    goal: GoalProgressGoal
    contributions: GoalContributionInput[]
    /** Bugün — 'YYYY-MM-DD' ya da Date. */
    today: string | Date
}

export type MonthlyHistoryPoint = {
    /** Ay başı 'YYYY-MM-01'. */
    period: string
    /** O ayki katkı toplamı (TL). */
    amount: number
    /** O ay katkı yapılmış mı (amount > 0). */
    done: boolean
}

export type GoalProgress = {
    /** İlerleme birimi cinsinden biriken (başlangıç + çevrilebilen katkılar). */
    saved: number
    /** Kalan; hedef aşıldıysa 0'a kırpılır. */
    remaining: number
    /** saved / target; hedef aşımında 1'i geçebilir (kırpılmaz). */
    progress: number
    /** Son 12 ay tik şeridi (eskiden yeniye). */
    monthlyHistory: MonthlyHistoryPoint[]
    /** Bu hızla ulaşılacak tarih; monthly_alloc yoksa null. */
    eta: Date | null
    /** ETA'nın Türkçe süresi ("2 yıl 4 ay", "8 ay", "bu ay"); hesaplanamıyorsa ''. */
    etaText: string
    /** target_date'e yetişiyor mu; target_date yoksa null. */
    onTrack: boolean | null
    /** target_date'e yetişmek için gereken aylık pay; target_date yoksa null. */
    requiredMonthly: number | null
    /** İlerleme birimi (giriş neyse). */
    unit: string
    /** TRY dışı hedefte kur yokluğundan ilerlemeye giremeyen katkı sayısı. */
    unconvertedCount: number
}

function toNumber(v: number | string | null | undefined): number {
    const n = typeof v === 'string' ? parseFloat(v) : v
    return Number.isFinite(n as number) ? (n as number) : 0
}
function round2(n: number): number { return Math.round(n * 100) / 100 }

function toDate(v: string | Date): Date {
    if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate())
    const [y, m, d] = v.slice(0, 10).split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
}
function monthKey(v: string): string { return v.slice(0, 7) }
function shiftMonthKey(mk: string, delta: number): string {
    const [y, m] = mk.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
/** İki tarih arası TAM ay farkı (b - a), gün dikkate alınarak. */
function monthsBetween(a: Date, b: Date): number {
    let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
    if (b.getDate() < a.getDate()) months -= 1
    return months
}

/** Ay sayısını Türkçe süreye çevirir. */
function durationTR(months: number): string {
    if (months <= 0) return 'bu ay'
    const y = Math.floor(months / 12), m = months % 12
    if (y === 0) return `${m} ay`
    if (m === 0) return `${y} yıl`
    return `${y} yıl ${m} ay`
}

export function computeGoalProgress(input: GoalProgressInput): GoalProgress {
    const unit = input.goal.unit ?? 'TRY'
    const isTRY = unit === 'TRY'
    const today = toDate(input.today)
    const target = toNumber(input.goal.targetAmount)
    const base = toNumber(input.goal.savedAmount ?? 0)

    // 1) Biriken — başlangıç + katkılar (TRY doğrudan; birim hedefte unitAmount).
    let contribSum = 0
    let unconvertedCount = 0
    for (const c of input.contributions) {
        if (isTRY) {
            contribSum += toNumber(c.amount)
        } else if (c.unitAmount == null) {
            unconvertedCount += 1                 // kur yok → ilerlemeye giremez
        } else {
            contribSum += toNumber(c.unitAmount)
        }
    }
    const saved = round2(base + contribSum)
    const remaining = round2(Math.max(0, target - saved))
    const progress = target > 0 ? saved / target : 0

    // 2) Son 12 ay tik şeridi (TL katkı toplamı, ay bazında).
    const byMonth = new Map<string, number>()
    for (const c of input.contributions) {
        const mk = monthKey(c.period)
        byMonth.set(mk, (byMonth.get(mk) ?? 0) + toNumber(c.amount))
    }
    const curMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const monthlyHistory: MonthlyHistoryPoint[] = Array.from({ length: 12 }, (_, i) => {
        const mk = shiftMonthKey(curMonth, -(11 - i))
        const amount = round2(byMonth.get(mk) ?? 0)
        return { period: `${mk}-01`, amount, done: amount > 0 }
    })

    // 3) ETA — monthly_alloc yoksa hesaplanamaz.
    const alloc = toNumber(input.goal.monthlyAlloc ?? 0)
    let eta: Date | null = null
    let etaText = ''
    if (alloc > 0) {
        if (remaining <= 0) {
            eta = today
            etaText = 'bu ay'
        } else {
            const months = Math.ceil(remaining / alloc)
            eta = new Date(today.getFullYear(), today.getMonth() + months, today.getDate())
            etaText = durationTR(months)
        }
    }

    // 4) target_date'e yetişme.
    let onTrack: boolean | null = null
    let requiredMonthly: number | null = null
    if (input.goal.targetDate) {
        const td = toDate(input.goal.targetDate)
        const monthsLeft = monthsBetween(today, td)
        if (remaining <= 0) {
            onTrack = true                        // zaten ulaşılmış
            requiredMonthly = 0
        } else if (monthsLeft <= 0) {
            onTrack = false                       // tarih geçti, hâlâ kalan var
            requiredMonthly = remaining           // "hemen gereken"
        } else {
            requiredMonthly = round2(remaining / monthsLeft)
            onTrack = alloc >= requiredMonthly
        }
    }

    return { saved, remaining, progress, monthlyHistory, eta, etaText, onTrack, requiredMonthly, unit, unconvertedCount }
}
