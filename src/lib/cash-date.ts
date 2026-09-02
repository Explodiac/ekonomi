export type CashDateAccount = {
    type?: string | null
    cut_date?: number | null
    due_date?: number | null
}

function toDateOnly(value: string | Date): Date {
    const d = value instanceof Date ? new Date(value) : new Date(value)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function format(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

// Ayın gün sayısını aşan gün numaraları (31 -> Şubat) o ayın son gününe çekilir.
function atDayOfMonth(year: number, month: number, day: number): Date {
    const lastDay = new Date(year, month + 1, 0).getDate()
    return new Date(year, month, Math.min(day, lastDay))
}

/**
 * Bir harcamanın hesaptan fiilen çıkacağı günü verir.
 * Kredi kartında: kesim gününden sonra yapılan harcama bir sonraki ekstreye
 * kalır, ödeme günü kesimden önceyse bir ay sonraya sarkar.
 * Diğer hesap tiplerinde harcama günü ile aynıdır.
 */
export function calculateCashDate(
    transactionDate: string | Date,
    account: CashDateAccount | null | undefined
): string {
    const txDate = toDateOnly(transactionDate)

    if (!account || account.type !== 'credit_card' || !account.cut_date || !account.due_date) {
        return format(txDate)
    }

    const cutDay = account.cut_date
    const dueDay = account.due_date

    const cutThisMonth = atDayOfMonth(txDate.getFullYear(), txDate.getMonth(), cutDay)

    // Kesim gününde veya sonrasında yapılan harcama bir sonraki ekstreye düşer.
    const statementMonthOffset = txDate >= cutThisMonth ? 1 : 0

    // Son ödeme günü kesim gününden önceyse, ödeme kesimden sonraki aya sarkar.
    const dueMonthOffset = statementMonthOffset + (dueDay < cutDay ? 1 : 0)

    return format(atDayOfMonth(txDate.getFullYear(), txDate.getMonth() + dueMonthOffset, dueDay))
}

function todayStr(): string {
    return format(new Date())
}

/**
 * cash_date'i TEK kaynaktan çözer — hem yeni kayıt hem hesap düzeltmesi için.
 * Panel ve modal bunu kullanır; iki ayrı yerde iki farklı mantık olmaz.
 *
 * Üç kural (hepsi):
 *  1. Hedef kredi kartı DEĞİLSE (banka/nakit/…): cash_date = transaction_date.
 *     Kart kesim/ödeme mantığı hiç çalıştırılmaz.
 *  2. Hedef kredi kartıysa: kesim/ödeme mantığı HAREKETİN transaction_date'inden
 *     hesaplanır (bugünden değil).
 *  3. Gerçekleşmiş hareket ileriye atılamaz: eski cash_date bugün ya da geçmişteyse
 *     (ödeme olmuş) ve yeni hesap tarihi bugünden SONRAYA düşerse, transaction_date'e
 *     sabitlenir. Böylece geçmiş kayıt düzeltmeleri bakiyeyi/projeksiyonu bozmaz.
 *     Gelecek planlı satırlar (ör. pending taksit) currentCashDate > today olduğu
 *     için bu kuraldan doğal olarak muaftır ve ileri tarihte kalabilir.
 */
export function resolveCashDate(input: {
    transactionDate: string | Date
    /** Hareketin mevcut cash_date'i (varsa). Yeni kayıtta boş. */
    currentCashDate?: string | null
    targetAccount: CashDateAccount | null | undefined
    /** Bugün (YYYY-MM-DD). Test için verilebilir; verilmezse sistem bugünü. */
    today?: string
}): string {
    const txStr = format(toDateOnly(input.transactionDate))
    const acc = input.targetAccount

    // Kural 1: kart değil → transaction_date (calculateCashDate hiç çağrılmaz).
    if (!acc || acc.type !== 'credit_card' || !acc.cut_date || !acc.due_date) {
        return txStr
    }

    // Kural 2: kart → transaction_date'ten kesim/ödeme.
    const computed = calculateCashDate(input.transactionDate, acc)

    // Kural 3: gerçekleşmiş hareket ileriye atılamaz.
    const today = input.today ?? todayStr()
    const wasRealized = input.currentCashDate != null && input.currentCashDate <= today
    if (wasRealized && computed > today) {
        return txStr
    }
    return computed
}
