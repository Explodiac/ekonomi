/**
 * Faiz takibi — SAF fonksiyon, tek hesap yeri. Kart/KMH faizi ne kadar ödendi,
 * asgari ödemeyle borç kaç ayda kapanır ve ne kadar faiz ödenir, borç şimdi
 * kapatılırsa aylık/toplam ne kurtulur.
 *
 * "ifPaidOff.savedPerMonth" en değerlisi: bu borcu kapatınca aydan aya kurtulan
 * faiz — doğrudan nefes payına eklenir.
 *
 * BORÇ yalnız 'credit_card' ve 'esnek_hesap' (KMH) hesaplarında sayılır; negatif
 * bakiye = kullanılan kredi → debt = max(0, −bakiye). Diğer hesaplarda negatif
 * bakiye anomalidir, borç sayılmaz.
 *
 * Asgari ödeme modeli (azalan bakiye): her ay faiz işler, sonra bakiyenin
 * minPaymentPct%'si ödenir. Asgari oran aylık faiz oranını geçmiyorsa borç
 * kapanmaz → months null ("asgari ödemeyle kapanmıyor").
 */

export type InterestAccount = {
    id: string
    name?: string | null
    type?: string | null
    balance: number | string
    /** Yıllık faiz oranı (%). Girilmemişse asgari ödeme senaryosu hesaplanmaz. */
    interest_rate?: number | string | null
}

export type InterestTransaction = {
    /** "Faiz & ücretler" kategorisindeki hareket. */
    amount: number | string
    type?: string | null
    cash_date: string
    account_id?: string | null
}

export type InterestInput = {
    accounts: InterestAccount[]
    transactions: InterestTransaction[]
    /** Bugün — 'YYYY-MM-DD' ya da Date. */
    today: string | Date
    /** Asgari ödeme oranı (%). Varsayılan 20. */
    minPaymentPct?: number
}

/** Asgari ödemeyle borcun kapanış senaryosu. months null → kapanmıyor. */
export type PayoffScenario = {
    months: number | null
    /** Kapanana kadar ödenecek toplam faiz (kapanmıyorsa null). */
    totalInterest: number | null
}

export type PaidOffSaving = {
    /** Borç şimdi kapatılırsa aydan aya kurtulan faiz (nefes payına eklenir). */
    savedPerMonth: number
    /** Kapatılırsa toplam kurtulan faiz (senaryo kapanmıyorsa null). */
    savedTotal: number | null
}

export type AccountInterest = {
    accountId: string
    name: string | null
    type: string | null
    /** Kalan borç (max(0, −bakiye); yalnız kart/KMH). */
    debt: number
    /** Yıllık % (yoksa null). */
    interestRate: number | null
    paidThisMonth: number
    paidThisYear: number
    /** Borç + oran varsa; yoksa null. */
    minimumPaymentScenario: PayoffScenario | null
    ifPaidOff: PaidOffSaving | null
}

export type InterestSummary = {
    paidThisMonth: number
    paidThisYear: number
    paidByAccount: AccountInterest[]
    /** Tüm borçların birleşik senaryosu. */
    minimumPaymentScenario: PayoffScenario
    ifPaidOff: PaidOffSaving
}

const DEBT_TYPES = new Set(['credit_card', 'esnek_hesap'])
const CAP_MONTHS = 1200 // 100 yıl güvenlik sınırı

function toNumber(v: number | string | null | undefined): number {
    const n = typeof v === 'string' ? parseFloat(v) : v
    return Number.isFinite(n as number) ? (n as number) : 0
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
function toISO(v: string | Date): string {
    if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    }
    return v.slice(0, 10)
}

/** Azalan bakiye asgari ödeme simülasyonu. */
function simulatePayoff(debt: number, annualRatePct: number, minPaymentPct: number): PayoffScenario {
    if (debt <= 0 || annualRatePct <= 0) return { months: 0, totalInterest: 0 }
    const monthlyRate = annualRatePct / 100 / 12
    const minRate = minPaymentPct / 100
    let bal = debt
    let months = 0
    let totalInterest = 0
    while (bal > 0.5 && months < CAP_MONTHS) {
        const interest = bal * monthlyRate
        bal += interest
        totalInterest += interest
        let pay = bal * minRate
        if (pay <= interest + 1e-9) return { months: null, totalInterest: null } // asgari, faizi karşılamıyor
        if (pay > bal) pay = bal
        bal -= pay
        months++
    }
    if (bal > 0.5) return { months: null, totalInterest: null }
    return { months, totalInterest: round2(totalInterest) }
}

// ─── Dönem sonu faiz onayı (kesim günü / ay sonu) ───────────────────────────

export type PendingInterestAccount = {
    id: string
    name?: string | null
    type?: string | null
    /** Türetilmiş güncel bakiye (negatif = borç). */
    balance: number | string
    /** Yıllık faiz oranı (%). Boşsa faiz sorulmaz. */
    interest_rate?: number | string | null
    /** Kart kesim (statement) günü 1-31. Esnek hesapta kullanılmaz (ay sonu). */
    cut_date?: number | null
}

export type PendingInterest = {
    accountId: string
    name: string
    type: string
    /** Faiz hareketinin cash_date'i = dönem sonu ('YYYY-MM-DD'). */
    periodEnd: string
    debt: number
    /** Aylık faiz oranı (%) = yıllık / 12 (BASİT bölme). */
    monthlyRatePct: number
    /** Hesaplanan faiz = borç × aylık oran. */
    amount: number
    /** "Bir kez sor" kalıcı kaydı için kararlı kimlik (dismissed_recurring). */
    fingerprint: string
}

function pad2(n: number): string { return String(n).padStart(2, '0') }
function daysInMonth(y: number, m1to12: number): number { return new Date(y, m1to12, 0).getDate() }

/** Kartın today'e kadarki EN SON kesim tarihi (kesim günü ay uzunluğuna kırpılır). */
function lastCutDate(cutDay: number, today: string): string {
    const [y, m] = today.split('-').map(Number)
    const dThis = Math.min(cutDay, daysInMonth(y, m))
    const cutThis = `${y}-${pad2(m)}-${pad2(dThis)}`
    if (cutThis <= today) return cutThis
    // Bu ayın kesimi henüz gelmedi → geçen ayın kesimi.
    const pm = m === 1 ? 12 : m - 1
    const py = m === 1 ? y - 1 : y
    const dPrev = Math.min(cutDay, daysInMonth(py, pm))
    return `${py}-${pad2(pm)}-${pad2(dPrev)}`
}

/** today'e kadarki EN SON tamamlanmış ay sonu. */
function lastMonthEnd(today: string): string {
    const [y, m, d] = today.split('-').map(Number)
    const lastThis = daysInMonth(y, m)
    if (d === lastThis) return today // bugün ay sonu
    const pm = m === 1 ? 12 : m - 1
    const py = m === 1 ? y - 1 : y
    return `${py}-${pad2(pm)}-${pad2(daysInMonth(py, pm))}`
}

/**
 * Dönem sonu (kart kesim günü / esnek ay sonu) gelmiş, faiz oranı girilmiş ve
 * borcu olan hesaplar için HESAPLANAN faiz — onay bekleyenler. Cevaplanmış/atlanmış
 * dönemler (answeredFingerprints) hariç. Hesap başına en son kapanan dönem.
 *
 * Aylık oran = yıllık / 12 (basit bölme; bileşik DEĞİL). Türkiye'de kart faizi
 * aylık ilan edilir; kullanıcı formda aylık girip ×12 ile yıllığa çevrildiği için
 * bölme geri-dönüşü tam tutar — girdiği aylık oran birebir uygulanır.
 */
export function computePendingInterest(input: {
    accounts: PendingInterestAccount[]
    answeredFingerprints: string[]
    today: string | Date
}): PendingInterest[] {
    const today = toISO(input.today)
    const answered = new Set(input.answeredFingerprints)
    const out: PendingInterest[] = []

    for (const a of input.accounts) {
        if (!DEBT_TYPES.has(a.type ?? '')) continue
        const rate = a.interest_rate != null ? toNumber(a.interest_rate) : 0
        if (rate <= 0) continue
        const debt = Math.max(0, -toNumber(a.balance))
        if (debt <= 0) continue

        let periodEnd: string | null = null
        if (a.type === 'credit_card') {
            if (!a.cut_date) continue // kesim günü yoksa dönem belirsiz
            periodEnd = lastCutDate(a.cut_date, today)
        } else {
            periodEnd = lastMonthEnd(today)
        }
        if (!periodEnd || periodEnd > today) continue

        const fingerprint = `faiz:${a.id}:${periodEnd}`
        if (answered.has(fingerprint)) continue

        out.push({
            accountId: a.id,
            name: a.name ?? 'Hesap',
            type: a.type ?? '',
            periodEnd,
            debt: round2(debt),
            monthlyRatePct: round2(rate / 12),
            amount: round2(debt * (rate / 100 / 12)),
            fingerprint,
        })
    }
    return out
}

function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Aylık ortalama faiz — breathing-room'un zorunlu çıkışına eklenir. Son `months`
 * TAM ayın (bu ay hariç) ortalaması; alışkanlık tahminiyle aynı pencere mantığı.
 * Girdi: "Faiz & ücretler" kategorisindeki hareketler.
 */
export function avgMonthlyInterest(transactions: InterestTransaction[], today: string | Date, months = 3): number {
    const cur = toISO(today).slice(0, 7)
    const window = new Set(Array.from({ length: months }, (_, i) => shiftMonth(cur, -(i + 1))))
    let sum = 0
    for (const t of transactions) {
        if (!t.cash_date) continue
        if (window.has(t.cash_date.slice(0, 7))) sum += Math.abs(toNumber(t.amount))
    }
    return round2(sum / months)
}

export function computeInterest(input: InterestInput): InterestSummary {
    const today = toISO(input.today)
    const curMonth = today.slice(0, 7)
    const curYear = today.slice(0, 4)
    const minPaymentPct = input.minPaymentPct ?? 20

    // Faiz ödemeleri hesap bazında (gerçekleşen = cash_date <= bugün).
    const paidMonthByAcc = new Map<string, number>()
    const paidYearByAcc = new Map<string, number>()
    let paidThisMonth = 0
    let paidThisYear = 0
    for (const t of input.transactions) {
        if (!t.cash_date || t.cash_date > today) continue
        const amt = Math.abs(toNumber(t.amount))
        const acc = t.account_id ?? '∅'
        if (t.cash_date.slice(0, 7) === curMonth) {
            paidThisMonth += amt
            paidMonthByAcc.set(acc, (paidMonthByAcc.get(acc) ?? 0) + amt)
        }
        if (t.cash_date.slice(0, 4) === curYear) {
            paidThisYear += amt
            paidYearByAcc.set(acc, (paidYearByAcc.get(acc) ?? 0) + amt)
        }
    }

    // Faiz ödemesi olan ya da borcu olan her hesap için satır.
    const relevant = new Set<string>([...paidYearByAcc.keys(), ...paidMonthByAcc.keys()])
    for (const a of input.accounts) {
        if (DEBT_TYPES.has(a.type ?? '') && toNumber(a.balance) < 0) relevant.add(a.id)
    }

    const accById = new Map(input.accounts.map(a => [a.id, a]))
    const paidByAccount: AccountInterest[] = []
    for (const accId of relevant) {
        const a = accById.get(accId)
        const isDebtAcc = a ? DEBT_TYPES.has(a.type ?? '') : false
        const debt = a && isDebtAcc ? Math.max(0, -toNumber(a.balance)) : 0
        const rate = a && a.interest_rate != null ? toNumber(a.interest_rate) : null

        let scenario: PayoffScenario | null = null
        let ifPaidOff: PaidOffSaving | null = null
        if (debt > 0 && rate != null && rate > 0) {
            scenario = simulatePayoff(debt, rate, minPaymentPct)
            const savedPerMonth = round2(debt * (rate / 100 / 12))
            ifPaidOff = { savedPerMonth, savedTotal: scenario.totalInterest }
        }

        paidByAccount.push({
            accountId: accId,
            name: a?.name ?? null,
            type: a?.type ?? null,
            debt: round2(debt),
            interestRate: rate,
            paidThisMonth: round2(paidMonthByAcc.get(accId) ?? 0),
            paidThisYear: round2(paidYearByAcc.get(accId) ?? 0),
            minimumPaymentScenario: scenario,
            ifPaidOff,
        })
    }
    // En çok faiz ödenen/borçlu üste.
    paidByAccount.sort((x, y) => (y.debt - x.debt) || (y.paidThisYear - x.paidThisYear))

    // Birleşik senaryo.
    const scenarios = paidByAccount.map(p => p.minimumPaymentScenario).filter((s): s is PayoffScenario => s != null)
    const finiteMonths = scenarios.map(s => s.months).filter((m): m is number => m != null)
    const anyDiverges = scenarios.some(s => s.months == null)
    const aggMonths = finiteMonths.length ? Math.max(...finiteMonths) : (anyDiverges ? null : 0)
    const aggTotalInterest = scenarios.reduce((s, sc) => s + (sc.totalInterest ?? 0), 0)
    const savings = paidByAccount.map(p => p.ifPaidOff).filter((s): s is PaidOffSaving => s != null)
    const aggSavedPerMonth = round2(savings.reduce((s, v) => s + v.savedPerMonth, 0))
    const aggSavedTotal = savings.some(v => v.savedTotal == null)
        ? null
        : round2(savings.reduce((s, v) => s + (v.savedTotal ?? 0), 0))

    return {
        paidThisMonth: round2(paidThisMonth),
        paidThisYear: round2(paidThisYear),
        paidByAccount,
        minimumPaymentScenario: { months: aggMonths, totalInterest: round2(aggTotalInterest) },
        ifPaidOff: { savedPerMonth: aggSavedPerMonth, savedTotal: aggSavedTotal },
    }
}
