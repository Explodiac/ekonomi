/**
 * Harcama temposu — "ayın bu gününde olmam gereken yerde miyim?"
 *
 * Saf fonksiyon. "Ne kadar harcadım"dan FARKLI bir soru: ayın 14'ünde bütçenin
 * doğrusal beklenenden (gün/gün sayısı × available) ne kadar sapıldığına bakar.
 *
 * expected = (dayOfMonth / daysInMonth) × available
 * actual   = spent
 * diff     = actual − expected            (pozitif = fazla harcanmış)
 * ratio    = actual / expected            (expected 0/negatif ise null)
 *
 * status (|diff| beklenenin %10 bandına göre):
 *   'hizinda' → |diff| ≤ %10 (yolunda)
 *   'onde'    → actual, expected'ı %10'dan fazla AŞMIŞ (fazla harcanmış — KÖTÜ)
 *   'geride'  → actual, expected'ın %10'dan fazla ALTINDA
 *
 * 'onde' harcamada öndesin (kötü) demek; isim karışıklığı olmasın diye ayrıca
 * isOverPace döner — UI onu kullanır (true = fazla harcama temposu).
 *
 * Erken günler (dayOfMonth ≤ 3): expected çok küçük, ratio aşırı oynak olur;
 * status 'hizinda' zorlanır (tempo yorumu yapma), diff yine hesaplanır.
 */

export type PaceInput = {
    available: number
    spent: number
    dayOfMonth: number
    daysInMonth: number
}

export type PaceStatus = 'onde' | 'hizinda' | 'geride'

export type PaceResult = {
    /** (gün / gün sayısı) × available — bugün için doğrusal beklenen harcama. */
    expected: number
    /** = spent. */
    actual: number
    /** actual − expected. Pozitif = fazla harcanmış. */
    diff: number
    /** actual / expected; expected ≤ 0 ise null. */
    ratio: number | null
    status: PaceStatus
    /** true = fazla harcama temposu ('onde'). UI bunu kullanır (isim karışmasın). */
    isOverPace: boolean
}

/** İlk N gün tempo yorumu yapılmaz (ratio oynak). */
const EARLY_DAYS = 3
/** Tempo bandı: beklenenin ±%10'u "yolunda". */
const THRESHOLD = 0.10

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

export function computePace(input: PaceInput): PaceResult {
    const available = toNumber(input.available)
    const actual = round2(toNumber(input.spent))
    const days = Math.max(1, Math.trunc(toNumber(input.daysInMonth)) || 1)
    // Günü [1, days] aralığına sıkıştır (geçersiz girdi güvenliği).
    const day = Math.min(Math.max(1, Math.trunc(toNumber(input.dayOfMonth)) || 1), days)

    const expected = round2((day / days) * available)

    // available yok/negatif: tempo anlamsız.
    if (available <= 0) {
        return { expected, actual, diff: 0, ratio: null, status: 'hizinda', isOverPace: false }
    }

    const diff = round2(actual - expected)
    const ratio = expected > 0 ? round2(actual / expected) : null

    // Erken günler: yorum yapma; diff yine döner.
    if (input.dayOfMonth <= EARLY_DAYS) {
        return { expected, actual, diff, ratio, status: 'hizinda', isOverPace: false }
    }

    const band = THRESHOLD * expected
    let status: PaceStatus
    if (diff > band) status = 'onde'
    else if (diff < -band) status = 'geride'
    else status = 'hizinda'

    return { expected, actual, diff, ratio, status, isOverPace: status === 'onde' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Günlük seri — zaman eksenli tempo grafiği için (Copilot "Monthly spending").
// computePace tek nokta (bugün) hesaplar; paceSeries ayın HER günü için birikmiş
// harcama ile doğrusal beklenen değeri üretir. Gerçek çizgi bugünde biter
// (gelecek günlerin cumulative'i null → tahmin çizilmez), beklenen çizgi ayı kapsar.
// ─────────────────────────────────────────────────────────────────────────────

export type PaceSeriesInput = {
    available: number
    daysInMonth: number
    /** Ayın kaçıncı günündeyiz (birikmiş çizgi buraya kadar dolu). */
    dayOfMonth: number
    /** Günlük harcama; index 0 = ayın 1'i. Eksik/kısa günler 0 sayılır. */
    dailySpent: number[]
}

export type PacePoint = {
    /** Ayın günü (1..daysInMonth). */
    day: number
    /** Gün sonu birikmiş harcama; day > dayOfMonth ise null (gelecek — çizme). */
    cumulative: number | null
    /** Doğrusal beklenen birikim: (day / daysInMonth) × available. */
    expected: number
}

/** Ayın her günü için {day, cumulative, expected}. */
export function paceSeries(input: PaceSeriesInput): PacePoint[] {
    const available = toNumber(input.available)
    const days = Math.max(1, Math.trunc(toNumber(input.daysInMonth)) || 1)
    // Bugünü [0, days] aralığına sıkıştır (0 = henüz gün yok).
    const today = Math.min(Math.max(0, Math.trunc(toNumber(input.dayOfMonth)) || 0), days)
    const daily = input.dailySpent ?? []

    const out: PacePoint[] = []
    let running = 0
    for (let d = 1; d <= days; d++) {
        if (d <= today) running = round2(running + toNumber(daily[d - 1]))
        const expected = round2((d / days) * available)
        out.push({ day: d, cumulative: d <= today ? running : null, expected })
    }
    return out
}
