/**
 * Yaklaşan yükler.
 *
 * BU BİR TAHMİN MOTORU DEĞİLDİR. Zaten bilinen, tarihi ve tutarı belli
 * yükümlülükleri 12 ay boyunca takvime dizer. Market, yemek gibi değişken
 * harcamalar buraya girmez; bakiye tahmini üretmez.
 *
 * ÇİFT SAYIM KURALI (tek kural): bir yükümlülüğün transactions'ta karşılığı
 * varsa üretilen kalem atlanır, gerçek satır kullanılır. Eşleşme yalnızca
 * source_type + source_id üzerinden yapılır; next_payment_date'in ileri atılmış
 * olmasına veya status alanına güvenilmez, ikisi de kırılgandır.
 *
 * Aboneliklerde geçmişe dönük geri-referans yok. Bu yüzden yalnızca bugünden
 * ileriye bakılır; geçmiş kayıtlar hiç üretilmez ki tarih+tutar eşleştirmesi
 * gibi yanlış eşleşme üreten yöntemlere düşülmesin.
 *
 * SÖZLEŞMELER BURAYA GİRMEZ. Bu uygulamada contracts bir gelir kaynağıdır
 * (bkz. "Kontratlar ve Düzenli Gelirler" sayfası; ödeme onayı type='income'
 * yazar). Yükümlülük listesine gelir karıştırmak toplamları ve "en ağır ay"
 * hesabını bozar. Sözleşme gelirleri projection.ts'te işlenir.
 */

export type UpcomingKind = 'abonelik' | 'kart_taksidi' | 'kredi' | 'elden'

export type UpcomingItem = {
    date: string
    label: string
    amount: number
    kind: UpcomingKind
    sourceId: string
    /** transactions'tan mı okundu, yoksa kuraldan mı üretildi */
    isRealTransaction: boolean
}

export type UpcomingMonth = {
    month: string // '2026-11'
    total: number
    items: UpcomingItem[]
    /** 12 ay ortalamasının %30 üstünde mi */
    isHeavy: boolean
    /** o ayı ağırlaştıran en büyük 1-2 kalem */
    heavyReason?: string
}

export type RelievingMonth = {
    /** yükün kalktığı ilk ay: son taksitten SONRAKİ ay */
    month: string
    label: string
    kind: UpcomingKind
    /** aylık yük ne kadar hafifliyor */
    monthlyRelief: number
}

export type UpcomingResult = {
    months: UpcomingMonth[]
    heaviestMonth?: { month: string; total: number; reason: string }
    relievingMonths: RelievingMonth[]
    /** 12 ayın ötesine taşan kalemler kesildi mi */
    truncated: boolean
}

// --- Girdi tipleri (DB satırlarının ihtiyaç duyulan alanları) ---

export type UpcomingTransaction = {
    /** Eşleştirme source_type/source_id üzerinden yapılır; id burada kullanılmaz. */
    id?: string
    amount: number | string
    type: string
    cash_date: string
    description?: string | null
    source_type?: string | null
    source_id?: string | null
    account_id?: string | null
}

export type UpcomingSubscription = {
    id: string
    name: string
    amount: number | string
    frequency: string // 'monthly' | 'yearly' | 'weekly'
    next_payment_date: string
    status?: string | null
    /** Süreli abonelik bitiş tarihi ('YYYY-MM-DD'). Boşsa süresiz. */
    end_date?: string | null
}

export type UpcomingInstallment = {
    id: string
    description?: string | null
    kind: string // 'kart_taksidi' | 'kredi'
    payments: { id: string; payment_date: string; amount: number | string }[]
}

export type UpcomingInput = {
    transactions: UpcomingTransaction[]
    subscriptions: UpcomingSubscription[]
    installments: UpcomingInstallment[]
}

// --- Tarih yardımcıları ---

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function pad(n: number): string {
    return String(n).padStart(2, '0')
}

export function formatDate(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function monthKey(isoDate: string): string {
    return isoDate.slice(0, 7)
}

/** Ay sonu taşmasını emer: 31 Ocak + 1 ay -> 28/29 Şubat. */
function addMonths(isoDate: string, count: number): string {
    const [y, m, d] = isoDate.split('-').map(Number)
    const targetMonthIndex = m - 1 + count
    const lastDay = new Date(y, targetMonthIndex + 1, 0).getDate()
    return formatDate(new Date(y, targetMonthIndex, Math.min(d, lastDay)))
}

function addDays(isoDate: string, count: number): string {
    const [y, m, d] = isoDate.split('-').map(Number)
    return formatDate(new Date(y, m - 1, d + count))
}

const TURKISH_MONTHS = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

export function monthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number)
    return `${TURKISH_MONTHS[m - 1]} ${y}`
}

/** Ay adının bulunma hâli: "Kasımda", "Eylülde", "Ağustosta". Ünsüz benzeşmesi
 *  ve ünlü uyumu düzensiz olduğu için tabloyla veriliyor. */
const TURKISH_MONTHS_LOCATIVE = [
    'Ocakta', 'Şubatta', 'Martta', 'Nisanda', 'Mayısta', 'Haziranda',
    'Temmuzda', 'Ağustosta', 'Eylülde', 'Ekimde', 'Kasımda', 'Aralıkta',
]

export function monthLocative(month: string): string {
    const m = Number(month.split('-')[1])
    return TURKISH_MONTHS_LOCATIVE[m - 1]
}

/** Sadece ay adı, yıl olmadan: "Kasım". */
export function monthName(month: string): string {
    return TURKISH_MONTHS[Number(month.split('-')[1]) - 1]
}

// --- Ana fonksiyon ---

export function buildUpcoming(
    input: UpcomingInput,
    options: { from?: string; months?: number } = {}
): UpcomingResult {
    const from = options.from ?? formatDate(new Date())
    const horizon = options.months ?? 12
    // Ufkun son günü: from'un ayından itibaren `horizon` ay.
    const lastMonth = monthKey(addMonths(from, horizon - 1))

    const inWindow = (date: string) => date >= from && monthKey(date) <= lastMonth
    const beyondWindow = (date: string) => date >= from && monthKey(date) > lastMonth

    let truncated = false
    const items: UpcomingItem[] = []

    // Taksit ödemesi id'sinden hangi taksit planına ait olduğunu bulmak için.
    const paymentToInstallment = new Map<string, UpcomingInstallment>()
    for (const inst of input.installments) {
        for (const p of inst.payments) paymentToInstallment.set(p.id, inst)
    }

    // Bir yükümlülüğün gerçek transaction karşılığı var mı? Tek kaynak: source_type+source_id.
    const realSourceIds = new Set<string>()
    for (const tx of input.transactions) {
        if (tx.source_type && tx.source_id) {
            realSourceIds.add(`${tx.source_type}:${tx.source_id}`)
        }
    }

    // 1) Kart taksitleri ve krediler: transactions'tan OKU, üretme.
    for (const tx of input.transactions) {
        if (tx.source_type !== 'installment' || !tx.source_id) continue

        const inst = paymentToInstallment.get(tx.source_id)
        const kind: UpcomingKind = inst?.kind === 'kredi' ? 'kredi' : inst?.kind === 'elden' ? 'elden' : 'kart_taksidi'

        if (beyondWindow(tx.cash_date)) {
            truncated = true
            continue
        }
        if (!inWindow(tx.cash_date)) continue

        items.push({
            date: tx.cash_date,
            label: inst?.description || tx.description || 'Taksit',
            amount: round2(Math.abs(toNumber(tx.amount))),
            kind,
            sourceId: tx.source_id,
            isRealTransaction: true,
        })
    }

    // 2) Abonelikler: next_payment_date'ten frequency'ye göre ileri yuvarla.
    //    Sadece bugünden ileriye; geçmiş kayıt üretilmez.
    for (const sub of input.subscriptions) {
        if (sub.status && sub.status !== 'active') continue
        if (realSourceIds.has(`subscription:${sub.id}`)) continue

        const amount = round2(toNumber(sub.amount))
        const anchor = sub.next_payment_date

        // Her tekrar, çapadan (ilk ödeme tarihi) sayılarak hesaplanıyor; adım adım
        // ilerletilmiyor. Aksi halde 31'inde ödenen bir kalem Şubat'a takıldığında
        // 28'e düşüp sonraki aylarda da orada kalır, tarih kalıcı olarak kayardı.
        for (let n = 0, emitted = 0; n < 400 && emitted < 60; n++) {
            const date = occurrence(anchor, sub.frequency, n)
            if (date < from) continue
            // Süreli abonelik: bitiş tarihinden sonra kalem üretilmez.
            if (sub.end_date && date > sub.end_date) break
            if (beyondWindow(date)) { truncated = true; break }
            if (!inWindow(date)) break

            items.push({
                date,
                label: sub.name,
                amount,
                kind: 'abonelik',
                sourceId: sub.id,
                isRealTransaction: false,
            })
            emitted++
        }
    }

    // --- Ay kovalarına dağıt ---
    const buckets = new Map<string, UpcomingItem[]>()
    for (let i = 0; i < horizon; i++) {
        buckets.set(monthKey(addMonths(from, i)), [])
    }
    for (const item of items) {
        const bucket = buckets.get(monthKey(item.date))
        if (bucket) bucket.push(item)
    }

    const months: UpcomingMonth[] = [...buckets.entries()].map(([month, monthItems]) => {
        monthItems.sort((a, b) => a.date.localeCompare(b.date))
        return {
            month,
            total: round2(monthItems.reduce((s, it) => s + it.amount, 0)),
            items: monthItems,
            isHeavy: false,
        }
    })

    // --- Ağır ay tespiti ---
    // Medyan kullanılıyor, ortalama değil: tek bir aykırı ay ortalamayı yukarı
    // çekince sıradan aylar da eşiği aşıyordu.
    //
    // En fazla 2 ay ("slot") işaretlenir. Adaylar tutara göre azalan sıralanır ve
    // aynı tutarı paylaşan aylar bir "eşitlik grubu" oluşturur. Gruplar en yüksekten
    // işlenir; TEK KURAL: grup kalan slot sayısına sığıyorsa (1 ay → 1 slot, 2 ay →
    // 2 slot) hepsi işaretlenir, sığmıyorsa (tek slota 2 ay, ya da 3+ ay) o grup
    // beraberliktir ve atlanır. Her slot bağımsızdır: bir grubun atlanması daha
    // yüksek gruplarda verilmiş işaretleri ETKİLEMEZ.
    //   [42.600, 8.600, 8.600] -> sadece 42.600 (ikinci slot beraberliği atlanır)
    //   [20.000, 20.000]       -> ikisi de (iki ay iki slotu doldurur)
    //   [20.000, 20.000, 20.000] -> hiçbiri (üç ay iki slota sığmaz)
    const heavyThreshold = median(months.map(m => m.total)) * 1.5

    const candidates = months
        .filter(m => m.total > heavyThreshold && m.total > 0)
        .sort((a, b) => b.total - a.total)

    const heavyMonths: UpcomingMonth[] = []
    let slotsLeft = 2
    let i = 0
    while (i < candidates.length && slotsLeft > 0) {
        let j = i
        while (j < candidates.length && candidates[j].total === candidates[i].total) j++
        const group = candidates.slice(i, j)
        if (group.length <= slotsLeft) {
            heavyMonths.push(...group)
            slotsLeft -= group.length
            i = j
        } else {
            break // grup sığmıyor: beraberlik, dur (daha yüksek işaretler korunur)
        }
    }

    for (const m of heavyMonths) {
        m.isHeavy = true
        m.heavyReason = describeHeavy(m)
    }

    const heaviest = months.reduce<UpcomingMonth | undefined>(
        (best, m) => (m.total > 0 && (!best || m.total > best.total) ? m : best),
        undefined
    )

    return {
        months,
        heaviestMonth: heaviest
            ? { month: heaviest.month, total: heaviest.total, reason: describeHeavy(heaviest) }
            : undefined,
        relievingMonths: findRelievingMonths(input, from, lastMonth, paymentToInstallment),
        truncated,
    }
}

export type InstallmentPlan = {
    monthlyAmount: number
    count: number
    /** İlk taksidin nakit çıkış tarihi (banka kredisinde = ödeme günü). */
    startCashDate: string
    kind: UpcomingKind
    label?: string
}

export type InstallmentPreview = {
    monthlyLoad: number
    /** Bu taksit bittikten sonra yükün hafifleyeceği ilk ay (12 ay içindeyse). */
    reliefMonth: string | null
    /** Taksit eklenmeden önceki en ağır ay. */
    heaviestBefore?: { month: string; total: number }
    /** Taksit eklendikten sonraki en ağır ay. */
    heaviestAfter?: { month: string; total: number }
}

/**
 * Taksitli alım girilirken ön uyarı: yeni taksidi geçici olarak ekleyip mevcut
 * yükümlülük tablosuna etkisini gösterir. buildUpcoming'i öncesi/sonrası çağırır,
 * böylece kural tek yerde kalır (üretilenler yeniden hesaplanmaz).
 */
export function previewInstallment(
    baseInput: UpcomingInput,
    plan: InstallmentPlan,
    options: { from?: string; months?: number } = {}
): InstallmentPreview {
    const from = options.from ?? formatDate(new Date())

    // Yeni taksidin geçici satırları: kart taksitleriyle aynı desen —
    // her ödeme gelecek tarihli bir transaction + installment_payment.
    const payments = Array.from({ length: plan.count }, (_, i) => ({
        id: `preview-${i}`,
        payment_date: addMonths(plan.startCashDate, i),
        amount: plan.monthlyAmount,
    }))
    const previewInstallmentRow: UpcomingInstallment = {
        id: 'preview',
        description: plan.label || 'Yeni taksit',
        kind: plan.kind,
        payments,
    }
    const previewTransactions: UpcomingTransaction[] = payments.map(p => ({
        amount: plan.monthlyAmount,
        type: 'expense',
        cash_date: p.payment_date,
        source_type: 'installment',
        source_id: p.id,
    }))

    const before = buildUpcoming(baseInput, { from, months: options.months })
    const after = buildUpcoming(
        {
            ...baseInput,
            transactions: [...baseInput.transactions, ...previewTransactions],
            installments: [...baseInput.installments, previewInstallmentRow],
        },
        { from, months: options.months }
    )

    const newRelief = after.relievingMonths.find(
        r => !before.relievingMonths.some(b => b.month === r.month && b.label === r.label)
    )

    return {
        monthlyLoad: plan.monthlyAmount,
        reliefMonth: newRelief?.month ?? null,
        heaviestBefore: before.heaviestMonth
            ? { month: before.heaviestMonth.month, total: before.heaviestMonth.total }
            : undefined,
        heaviestAfter: after.heaviestMonth
            ? { month: after.heaviestMonth.month, total: after.heaviestMonth.total }
            : undefined,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tek kalem detayı — Copilot Recurring detay paneli (ödeme geçmişi + tahmin).
// ─────────────────────────────────────────────────────────────────────────────

export type RecurringDetail = {
    /** Son 12 ay ödeme şeridi (eskiden yeniye). paid: o ay ödeme gerçekleşti mi. */
    paymentHistory: { period: string; amount: number; paid: boolean }[]
    /** Bir sonraki ödeme; abonelikte tarih tahminî (approximate). Yoksa null (bitti). */
    nextPayment: { date: string; amount: number; approximate: boolean } | null
    /** Yıl bazında toplam ve ödeme başına ortalama (gerçekleşen ödemelerden). */
    yearly: { year: number; total: number; avg: number }[]
    /** En son ödemenin hesabı ve tutarı. */
    lastAccount: string | null
    lastAmount: number | null
}

function normalizeLabel(s: string | null | undefined): string {
    return (s ?? '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim()
}

/**
 * Bir aboneliğin ya da taksit planının geçmişi + sonraki ödemesi.
 * Eşleşme: taksitte source_type='installment' + payment id'leri; abonelikte
 * source_type='subscription' + source_id, source_id boşsa ad (label) ile.
 */
export function getRecurringDetail(input: {
    sourceId: string
    kind: UpcomingKind
    label: string
    transactions: UpcomingTransaction[]
    subscriptions: UpcomingSubscription[]
    installments: UpcomingInstallment[]
    asOf?: string
}): RecurringDetail {
    const asOf = input.asOf ?? formatDate(new Date())
    const isInstallment = input.kind !== 'abonelik'
    const wantLabel = normalizeLabel(input.label)

    // Eşleşen hareketleri topla.
    let paymentIds: Set<string> | null = null
    if (isInstallment) {
        const inst = input.installments.find(i => i.id === input.sourceId)
        paymentIds = new Set((inst?.payments ?? []).map(p => p.id))
    }
    const matched = input.transactions.filter(t => {
        if (isInstallment) {
            return t.source_type === 'installment' && t.source_id != null && paymentIds!.has(t.source_id)
        }
        if (t.source_type !== 'subscription') return false
        if (t.source_id) return t.source_id === input.sourceId
        return normalizeLabel(t.description) === wantLabel // source_id yoksa ad eşleşmesi
    })

    // Ay bazında gerçekleşen ödeme.
    const byMonth = new Map<string, { amount: number; date: string }>()
    for (const t of matched) {
        if (!t.cash_date) continue
        const mk = monthKey(t.cash_date)
        const cur = byMonth.get(mk)
        const amt = Math.abs(toNumber(t.amount))
        if (!cur) byMonth.set(mk, { amount: amt, date: t.cash_date })
        else { cur.amount += amt; if (t.cash_date > cur.date) cur.date = t.cash_date }
    }

    // Son 12 ay şeridi (asOf ayından 11 geri).
    const curMonth = monthKey(asOf)
    const paymentHistory = Array.from({ length: 12 }, (_, i) => {
        const mk = monthKey(addMonths(`${curMonth}-01`, -(11 - i)))
        const m = byMonth.get(mk)
        return { period: `${mk}-01`, amount: m ? round2(m.amount) : 0, paid: !!m && m.date <= asOf }
    })

    // Sonraki ödeme.
    let nextPayment: RecurringDetail['nextPayment'] = null
    if (isInstallment) {
        const inst = input.installments.find(i => i.id === input.sourceId)
        const future = (inst?.payments ?? []).filter(p => p.payment_date > asOf).sort((a, b) => a.payment_date.localeCompare(b.payment_date))
        if (future[0]) nextPayment = { date: future[0].payment_date, amount: round2(toNumber(future[0].amount)), approximate: false }
    } else {
        const sub = input.subscriptions.find(s => s.id === input.sourceId)
        if (sub && (!sub.status || sub.status === 'active')) {
            for (let n = 0; n < 400; n++) {
                const date = occurrence(sub.next_payment_date, sub.frequency, n)
                if (date > asOf) { nextPayment = { date, amount: round2(toNumber(sub.amount)), approximate: true }; break }
            }
        }
    }

    // Yıllık toplam + ödeme başına ortalama (gerçekleşenler).
    const yearAgg = new Map<number, { total: number; count: number }>()
    for (const [mk, m] of byMonth) {
        if (m.date > asOf) continue
        const y = Number(mk.slice(0, 4))
        const a = yearAgg.get(y) ?? { total: 0, count: 0 }
        a.total += m.amount; a.count += 1
        yearAgg.set(y, a)
    }
    const yearly = [...yearAgg.entries()]
        .map(([year, a]) => ({ year, total: round2(a.total), avg: round2(a.total / Math.max(1, a.count)) }))
        .sort((a, b) => b.year - a.year)

    // Son ödeme hesabı + tutarı.
    const paidMatched = matched.filter(t => t.cash_date && t.cash_date <= asOf).sort((a, b) => (b.cash_date).localeCompare(a.cash_date))
    const last = paidMatched[0]

    return {
        paymentHistory,
        nextPayment,
        yearly,
        lastAccount: last?.account_id ?? null,
        lastAmount: last ? round2(Math.abs(toNumber(last.amount))) : null,
    }
}

function median(values: number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid]
}

/** Çapa tarihten sayılan n'inci tekrar. Ay sonu taşması kalıcı kayma yapmaz. */
function occurrence(anchor: string, frequency: string, n: number): string {
    if (frequency === 'yearly') return addMonths(anchor, 12 * n)
    if (frequency === 'weekly') return addDays(anchor, 7 * n)
    return addMonths(anchor, n)
}

/** O ayı ağırlaştıran en büyük 1-2 kalemi anlatır. */
function describeHeavy(month: UpcomingMonth): string {
    const byLabel = new Map<string, number>()
    for (const it of month.items) {
        byLabel.set(it.label, (byLabel.get(it.label) ?? 0) + it.amount)
    }
    const top = [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    return top.map(([label]) => label).join(' ve ')
}

/**
 * Hangi ayda hangi yükümlülük bitiyor ve aylık yük ne kadar hafifliyor.
 * Rahatlama, son ödemeden SONRAKİ aydan itibaren hissedilir.
 */
function findRelievingMonths(
    input: UpcomingInput,
    from: string,
    lastMonth: string,
    paymentToInstallment: Map<string, UpcomingInstallment>
): RelievingMonth[] {
    const result: RelievingMonth[] = []

    for (const inst of input.installments) {
        const future = inst.payments.filter(p => p.payment_date >= from)
        if (future.length === 0) continue

        const lastPayment = future.reduce((a, b) => (a.payment_date > b.payment_date ? a : b))
        const reliefMonth = monthKey(addMonths(lastPayment.payment_date, 1))
        if (reliefMonth > lastMonth) continue

        result.push({
            month: reliefMonth,
            label: inst.description || 'Taksit',
            kind: inst.kind === 'kredi' ? 'kredi' : inst.kind === 'elden' ? 'elden' : 'kart_taksidi',
            monthlyRelief: round2(toNumber(lastPayment.amount)),
        })
    }

    return result.sort((a, b) => a.month.localeCompare(b.month))
}
