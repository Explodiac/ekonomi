/**
 * Net değer — varlıklar eksi borçlar.
 *
 * Saf fonksiyon. net değer = (hesaplar + yatırımlar) − (kart borçları + kalan krediler)
 *
 * Bakiyeler lib/balance.ts ile hareketlerden türetilir (asOf tarihine göre), böylece
 * geçmiş aylar için de tutarlı. Hedefler net değere GİRMEZ: hedef bir plandır, para
 * zaten hesapta sayılıyor — çift sayma olurdu.
 *
 * Yatırım değeri dışarıdan verilir (investmentValue). Kur/altın güncellenememişse
 * çağıran null geçer ve yatırım net değere hiç katılmaz — bayat kurla yanlış değer
 * göstermek yerine yatırım dışlanır (investmentIncluded=false).
 *
 * TREND (byMonth) parametreli aralık ve granülerlik ile hesaplanır. Hesap MANTIĞI
 * değişmez; yalnız pencere ve nokta sıklığı parametreleşir. Günlük granülerlikte
 * her nokta tüm hareketleri yeniden taramaz — hesap bakiyeleri kümülatif ilerletilir.
 */

import { derivedBalance, type BalanceTransaction } from './balance.ts'
import { transactionEffect } from './transaction-effect.ts'

export type NetWorthAccount = {
    id: string
    type?: string | null
    opening_balance?: number | string | null
}

export type NetWorthTransaction = BalanceTransaction & { account_id?: string | null }

export type NetWorthInstallment = {
    kind: string
    payments: { payment_date: string; amount: number | string }[]
}

/** Trend aralığı. 1H/1A günlük nokta; 3A/YBB/1Y/TÜMÜ aylık nokta. */
export type NetWorthRange = '1H' | '1A' | '3A' | 'YBB' | '1Y' | 'TÜMÜ'

export type NetWorthGranularity = 'day' | 'month'

/** Trend noktası. `month` alanı: aylık → 'YYYY-MM', günlük → 'YYYY-MM-DD' (geriye uyum).
 *  assets/debts: o noktadaki varlık ve borç (grafikte ayrı çizgiler için). */
export type NetWorthMonth = { month: string; netWorth: number; assets: number; debts: number }

export type NetWorthResult = {
    assets: number
    debts: number
    netWorth: number
    /** Yatırım değeri (kur) net değere dahil edilebildi mi. */
    investmentIncluded: boolean
    /** Seçili aralık ve granülerlikte net değer trendi, eskiden yeniye. */
    byMonth: NetWorthMonth[]
    /** byMonth'un granülerliği ('day' | 'month'). */
    granularity: NetWorthGranularity
}

const LIQUID_TYPES = ['bank', 'cash', 'investment']

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function todayISO(reference: Date = new Date()): string {
    const y = reference.getFullYear()
    const m = String(reference.getMonth() + 1).padStart(2, '0')
    const d = String(reference.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

/** monthKey'in (YYYY-MM) son gününü ISO tarih olarak verir. */
function endOfMonth(monthKey: string): string {
    const [y, m] = monthKey.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    return `${monthKey}-${String(last).padStart(2, '0')}`
}

function shiftMonthKey(monthKey: string, delta: number): string {
    const [y, m] = monthKey.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function addDays(iso: string, n: number): string {
    const [y, m, d] = iso.split('-').map(Number)
    const dt = new Date(y, m - 1, d + n)
    return todayISO(dt)
}

function subMonths(iso: string, n: number): string {
    const [y, m, d] = iso.split('-').map(Number)
    return todayISO(new Date(y, m - 1 - n, d))
}

/** start..end (dahil) her gün. */
function eachDay(start: string, end: string): string[] {
    const out: string[] = []
    let cur = start
    // Güvenlik sınırı: en fazla 400 gün.
    for (let i = 0; i < 400 && cur <= end; i++) {
        out.push(cur)
        cur = addDays(cur, 1)
    }
    return out
}

/** start..end (dahil) her ay anahtarı. */
function monthKeysBetween(startKey: string, endKey: string): string[] {
    const out: string[] = []
    let cur = startKey
    for (let i = 0; i < 240 && cur <= endKey; i++) {
        out.push(cur)
        cur = shiftMonthKey(cur, 1)
    }
    return out
}

/** Belirli bir tarihte kalan kredi taksitleri toplamı (payment_date > asOf). */
function remainingLoans(installments: NetWorthInstallment[], asOf: string): number {
    let total = 0
    for (const inst of installments) {
        if (inst.kind !== 'kredi') continue
        for (const p of inst.payments) {
            if (p.payment_date > asOf) total += Math.abs(toNumber(p.amount))
        }
    }
    return total
}

/** Belirli bir tarihte varlık/borç fotoğrafı (yatırım hariç). */
function snapshot(
    accounts: NetWorthAccount[],
    transactions: NetWorthTransaction[],
    installments: NetWorthInstallment[],
    asOf: string
): { liquid: number; cardDebt: number; loans: number } {
    let liquid = 0
    let cardDebt = 0

    for (const acc of accounts) {
        const accTx = transactions.filter(t => t.account_id === acc.id)
        const bal = derivedBalance(acc.opening_balance ?? 0, accTx, asOf)
        if (acc.type === 'credit_card') {
            cardDebt += Math.max(0, -bal) // borç: negatif bakiyenin mutlak değeri
        } else if (acc.type === 'esnek_hesap') {
            // KMH: negatif = kullanılan kredi (borç); pozitif = varlık (likit).
            if (bal < 0) cardDebt += -bal; else liquid += bal
        } else if (LIQUID_TYPES.includes(acc.type || '')) {
            liquid += Math.max(0, bal) // negatif likit bakiye borç sayılmaz, sıfırlanır
        }
    }

    return { liquid, cardDebt, loans: remainingLoans(installments, asOf) }
}

/** Aralık + granülerlikten trend noktalarının {etiket, snapshot tarihi} listesi (eskiden yeniye). */
function buildPoints(
    range: NetWorthRange | undefined,
    months: number,
    asOf: string,
    transactions: NetWorthTransaction[]
): { points: { key: string; at: string }[]; granularity: NetWorthGranularity } {
    const currentMonth = asOf.slice(0, 7)

    // Günlük granülerlik: 1 hafta / 1 ay
    if (range === '1H' || range === '1A') {
        const start = range === '1H' ? addDays(asOf, -6) : subMonths(asOf, 1)
        return { points: eachDay(start, asOf).map(d => ({ key: d, at: d })), granularity: 'day' }
    }

    // Aylık granülerlik: başlangıç ayını aralığa göre bul
    let startMonth: string
    if (range === '3A') startMonth = shiftMonthKey(currentMonth, -2)
    else if (range === '1Y') startMonth = shiftMonthKey(currentMonth, -11)
    else if (range === 'YBB') startMonth = `${currentMonth.slice(0, 4)}-01`
    else if (range === 'TÜMÜ') {
        let earliest: string | null = null
        for (const t of transactions) {
            const d = (t.transaction_date || t.cash_date || '').slice(0, 10)
            if (d && (!earliest || d < earliest)) earliest = d
        }
        if (!earliest) return { points: [], granularity: 'month' } // veri yok → boş, hata değil
        startMonth = earliest.slice(0, 7)
    } else {
        // range verilmedi: mevcut varsayılan (son `months` ay)
        startMonth = shiftMonthKey(currentMonth, -(months - 1))
    }

    const points = monthKeysBetween(startMonth, currentMonth).map(mk => ({
        key: mk,
        // İçinde bulunulan ay için bugüne kadar; geçmiş aylar için ay sonu.
        at: mk === currentMonth ? asOf : endOfMonth(mk),
    }))
    return { points, granularity: 'month' }
}

/**
 * Nokta listesi için net değer serisi — KÜMÜLATİF. Hareketler tarihe göre bir kez
 * sıralanır; noktalar ilerledikçe hesap bakiyeleri artımlı güncellenir (her nokta
 * için tam tarama yapılmaz). İşaret kuralı tek kaynaktan: transactionEffect.
 */
function seriesNetWorth(
    points: { key: string; at: string }[],
    accounts: NetWorthAccount[],
    transactions: NetWorthTransaction[],
    installments: NetWorthInstallment[],
    investment: number
): NetWorthMonth[] {
    // Bakiye/borç, hareketin YAPILDIĞI güne göre birikir (transaction_date), paranın
    // çıkacağı güne göre değil — balance.ts ile aynı kural (kart borcu yapıldığı an).
    const rd = (t: NetWorthTransaction) => (t.transaction_date || t.cash_date || '').slice(0, 10)
    const sorted = transactions
        .map(t => ({ t, d: rd(t) }))
        .filter(x => x.d)
        .sort((a, b) => a.d.localeCompare(b.d))

    const bal = new Map<string, number>()
    const typeOf = new Map<string, string>()
    for (const a of accounts) {
        bal.set(a.id, toNumber(a.opening_balance ?? 0))
        typeOf.set(a.id, a.type || '')
    }

    let idx = 0
    const out: NetWorthMonth[] = []
    for (const p of points) {
        while (idx < sorted.length && sorted[idx].d <= p.at) {
            const t = sorted[idx].t
            if (t.account_id && bal.has(t.account_id)) {
                bal.set(t.account_id, (bal.get(t.account_id) as number) + transactionEffect(t))
            }
            idx++
        }
        let liquid = 0, cardDebt = 0
        for (const [id, b] of bal) {
            const type = typeOf.get(id)
            if (type === 'credit_card') cardDebt += Math.max(0, -b)
            else if (type === 'esnek_hesap') { if (b < 0) cardDebt += -b; else liquid += b }
            else if (LIQUID_TYPES.includes(type || '')) liquid += Math.max(0, b)
        }
        const loans = remainingLoans(installments, p.at)
        const assets = round2(liquid + investment)
        const debts = round2(cardDebt + loans)
        out.push({ month: p.key, netWorth: round2(assets - debts), assets, debts })
    }
    return out
}

export function buildNetWorth(
    input: {
        accounts: NetWorthAccount[]
        transactions: NetWorthTransaction[]
        installments: NetWorthInstallment[]
        /** Güncel yatırım değeri; kur çekilemediyse null. */
        investmentValue: number | null
    },
    options: { asOf?: string; months?: number; range?: NetWorthRange } = {}
): NetWorthResult {
    const asOf = options.asOf ?? todayISO()
    const monthCount = options.months ?? 6
    const investment = input.investmentValue ?? 0

    // Güncel toplam (asOf) — tek fotoğraf.
    const now = snapshot(input.accounts, input.transactions, input.installments, asOf)
    const assets = round2(now.liquid + investment)
    const debts = round2(now.cardDebt + now.loans)

    // Trend serisi — aralık + granülerlik. Yatırım sabit (geçmiş piyasa değeri
    // bilinmiyor); trend likit birikimi ve borç azalışını yansıtır.
    const { points, granularity } = buildPoints(options.range, monthCount, asOf, input.transactions)
    const byMonth = seriesNetWorth(points, input.accounts, input.transactions, input.installments, investment)

    return {
        assets,
        debts,
        netWorth: round2(assets - debts),
        investmentIncluded: input.investmentValue !== null,
        byMonth,
        granularity,
    }
}
