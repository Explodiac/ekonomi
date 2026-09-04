/**
 * Dayanma süresi (runway) — gelir kesilse likit varlıkla kaç ay dayanılır.
 *
 * Saf fonksiyon, salt okuma. runway = likit varlık / aylık gider ortalaması.
 *   - likit varlık: vadesiz (bank) + nakit (cash) hesap bakiyeleri. Yatırım/kredi
 *     kartı dahil değildir.
 *   - aylık gider ortalaması: son `months` TAM ayın (içinde bulunulan ay hariç)
 *     ortalama gider çıkışı (transfer hariç). "Gelir kesilse" senaryosunda yakma hızı.
 *
 * İKİ RAKAMIN ANLAMI (çift sayma önlenir):
 *   serbest        = acil durumda gerçekten dokunabileceğin para.
 *                    Likit bir hesapta duran hedef birikimi bu paradan DÜŞÜLÜR
 *                    (o para zaten liquidFree'de ama hedefe ayrılmış).
 *   hedefler dahil = hedefleri feda edersen toplam. Likit hesaptaki hedef parası
 *                    zaten liquidFree'de olduğundan tekrar eklenmez; yalnız likit
 *                    OLMAYAN (yatırım) ya da hesapsız hedef birikimi ayrıca eklenir.
 *
 * Gider yoksa (yakma hızı 0) süre sonsuzdur → runwayMonths null döner.
 */

export type RunwayAccount = {
    id: string
    type?: string | null
}

export type RunwayTransaction = {
    amount: number | string
    type: string
    cash_date: string
    transfer_direction?: string | null
}

export type RunwayGoal = {
    /** Hedefe ayrılmış birikim (TL). */
    saved: number | string
    /** Paranın durduğu hesap; likitse liquidFree'de sayılır (çift sayma kaynağı). */
    sourceAccountId?: string | null
}

export type RunwayInput = {
    accounts: RunwayAccount[]
    /** Hesaplanmış bakiyeler (lib/balance.ts). */
    balances: Map<string, number>
    transactions: RunwayTransaction[]
    /** Hedefler: birikim + kaynak hesap. Likit hesaptaki hedef parası serbest süreden
     *  düşülür; likit olmayan/hesapsız hedef "hedefler dahil"e ayrıca eklenir. */
    goals?: RunwayGoal[]
    /** Geriye uyum: tek toplam verilirse hepsi HESAPSIZ (external) sayılır. */
    goalReserved?: number
    /** 'YYYY-MM-DD' — bugün. */
    asOf?: string
    /** Ortalama kaç tam aydan alınsın (varsayılan 3). */
    months?: number
}

export type RunwayResult = {
    /** Likit hesaplar (vadesiz + nakit) toplam bakiyesi. */
    liquidFree: number
    /** Likit hesapta duran hedef birikimi (serbest süreden düşülen). */
    reservedInLiquid: number
    /** Likit olmayan / hesapsız hedef birikimi ("hedefler dahil"e eklenen). */
    reservedExternal: number
    /** Toplam hedef birikimi (reservedInLiquid + reservedExternal). */
    goalReserved: number
    /** Hedefler dahil toplam para = liquidFree + reservedExternal. */
    liquidTotal: number
    /** Aylık ortalama gider (yakma hızı). */
    monthlyBurn: number
    /** Serbest: (liquidFree − reservedInLiquid) / yakma hızı; gider yoksa null. */
    runwayFree: number | null
    /** Hedefler dahil: liquidTotal / yakma hızı; gider yoksa null. */
    runwayWithGoals: number | null
}

const LIQUID_TYPES = new Set(['bank', 'cash'])

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function todayISO(): string {
    return new Date().toISOString().slice(0, 10)
}

function monthKeyOf(iso: string): string {
    return iso.slice(0, 7)
}

function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function computeRunway(input: RunwayInput): RunwayResult {
    const asOf = input.asOf ?? todayISO()
    const months = input.months ?? 3
    const currentMonth = monthKeyOf(asOf)

    // 1) Likit hesaplar: bank + cash. Bakiyeler ve id seti.
    const liquidIds = new Set<string>()
    let liquidFree = 0
    for (const a of input.accounts) {
        if (a.type && LIQUID_TYPES.has(a.type)) {
            liquidIds.add(a.id)
            liquidFree += input.balances.get(a.id) ?? 0
        } else if (a.type === 'esnek_hesap') {
            // KMH: pozitif bakiye likit; negatif (kullanılan kredi) likide sayılmaz.
            const b = input.balances.get(a.id) ?? 0
            if (b > 0) { liquidIds.add(a.id); liquidFree += b }
        }
    }
    liquidFree = round2(liquidFree)

    // 2) Hedef birikimini likit-hesap / dış olarak ayır (çift sayma önlemi).
    //    Likit hesaptaki hedef parası zaten liquidFree'de → serbest süreden düşülür.
    //    Dış (yatırım/hesapsız) hedef → "hedefler dahil"e ayrıca eklenir.
    const goalList: RunwayGoal[] = input.goals
        ?? (input.goalReserved ? [{ saved: input.goalReserved, sourceAccountId: null }] : [])
    const reservedByLiquidAcc = new Map<string, number>()
    let reservedExternal = 0
    for (const g of goalList) {
        const saved = Math.max(0, toNumber(g.saved))
        if (g.sourceAccountId && liquidIds.has(g.sourceAccountId)) {
            reservedByLiquidAcc.set(g.sourceAccountId, (reservedByLiquidAcc.get(g.sourceAccountId) ?? 0) + saved)
        } else {
            reservedExternal += saved
        }
    }
    // Bir likit hesaptaki hedef birikimi o hesabın bakiyesini AŞAMAZ (veri tutarsızlığı → kırp).
    let reservedInLiquid = 0
    for (const [accId, sum] of reservedByLiquidAcc) {
        const bal = Math.max(0, input.balances.get(accId) ?? 0)
        reservedInLiquid += Math.min(sum, bal)
    }
    reservedInLiquid = round2(reservedInLiquid)
    reservedExternal = round2(reservedExternal)

    const freeLiquid = round2(Math.max(0, liquidFree - reservedInLiquid))
    const liquidTotal = round2(liquidFree + reservedExternal)
    const goalReserved = round2(reservedInLiquid + reservedExternal)

    // 3) Aylık yakma hızı: son `months` tam ayın ortalama gider çıkışı (transfer hariç).
    const window = Array.from({ length: months }, (_, i) => shiftMonth(currentMonth, -(i + 1)))
    const inWindow = new Set(window)
    const totals = new Map<string, number>()
    for (const t of input.transactions) {
        if (t.type !== 'expense' || !t.cash_date) continue
        if (t.transfer_direction) continue
        const key = monthKeyOf(t.cash_date)
        if (!inWindow.has(key)) continue
        totals.set(key, (totals.get(key) ?? 0) + Math.abs(toNumber(t.amount)))
    }

    const sum = [...totals.values()].reduce((s, v) => s + v, 0)
    const monthlyBurn = round2(sum / months)

    return {
        liquidFree,
        reservedInLiquid,
        reservedExternal,
        goalReserved,
        liquidTotal,
        monthlyBurn,
        runwayFree: monthlyBurn > 0 ? round2(freeLiquid / monthlyBurn) : null,
        runwayWithGoals: monthlyBurn > 0 ? round2(liquidTotal / monthlyBurn) : null,
    }
}
