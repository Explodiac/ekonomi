/**
 * Bakiye türetme.
 *
 * accounts.balance saklanan ve 20 ayrı yerden artımlı yazılan bir alan; hiçbir zaman
 * yeniden hesaplanmadığı için doğrulanamaz. Buradaki fonksiyonlar bakiyeyi
 * hareketlerden türetir:
 *
 *     gerçekleşen bakiye = opening_balance + Σ(transaction_date <= bugün olan hareketler)
 *
 * TARİH: Bakiye, paranın çıkacağı gün (cash_date) değil, hareketin YAPILDIĞI gün
 * (transaction_date) esas alınarak türetilir. Kart harcaması borcu yapıldığı an
 * artırır; cash_date (son ödeme günü) gelecekte olsa bile borç bugün vardır.
 * cash_date'le süzülünce kart harcamaları bakiyeye hiç girmiyordu (banka
 * hesaplarında ikisi aynı olduğu için sorun yalnızca kartlarda görünüyordu).
 * cash_date yalnız nakit-akışı ekranlarında kullanılır (Yaklaşan/Nakit/runway).
 * transaction_date yoksa cash_date'e düşülür (eski davranışla geriye uyum).
 *
 * Gelecek tarihli hareketler doğal olarak dışarıda kalır — ileri tarihli bir taksit
 * ya da gider bugünün bakiyesini etkilemez, ayrıca bir düzeltme gerekmez.
 */

// İşaret kuralının tek kaynağı; balance.ts yalnız türetme yapar.
export { transactionEffect } from './transaction-effect.ts'
import { transactionEffect } from './transaction-effect.ts'

export type BalanceTransactionType = 'income' | 'expense' | 'transfer'

export type BalanceTransaction = {
    amount: number | string
    type: BalanceTransactionType | string
    /** Hareketin yapıldığı gün — bakiye türetmede esas tarih. */
    transaction_date?: string | null
    /** Paranın çıkacağı gün — yalnız nakit-akışı ekranlarında; bakiyede kullanılmaz. */
    cash_date: string
    /** Transferlerde yön: 'out' kaynak hesap, 'in' hedef hesap. Diğer tiplerde boş. */
    transfer_direction?: 'out' | 'in' | string | null
}

/** Bakiye türetmede esas alınan gün: transaction_date, yoksa cash_date. 'YYYY-MM-DD'. */
function realizedDate(tx: BalanceTransaction): string {
    const d = tx.transaction_date || tx.cash_date || ''
    return d.slice(0, 10)
}

/** Kuruş hassasiyetinde yuvarlar; kayan nokta birikimini engeller. */
function roundToCents(value: number): number {
    return Math.round(value * 100) / 100
}

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

/** 'YYYY-MM-DD' — yerel saat diliminde bugünün tarihi. */
export function today(reference: Date = new Date()): string {
    const y = reference.getFullYear()
    const m = String(reference.getMonth() + 1).padStart(2, '0')
    const d = String(reference.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

/**
 * Verilen tarihe kadar (dahil) gerçekleşmiş bakiye.
 * `asOf` verilmezse bugün kullanılır.
 */
export function derivedBalance(
    openingBalance: number | string,
    transactions: BalanceTransaction[],
    asOf: string = today()
): number {
    const total = transactions.reduce((sum, tx) => {
        const d = realizedDate(tx)
        if (!d || d > asOf) return sum
        return sum + transactionEffect(tx)
    }, toNumber(openingBalance))

    return roundToCents(total)
}

export type ReconcileResult = {
    stored: number
    /** Ekranda gösterilen değer: yalnızca gerçekleşmiş hareketler. */
    derived: number
    /** Saklanan balance ile aynı tabanda hesaplanmış değer: tüm hareketler. */
    comparable: number
    difference: number
    matches: boolean
}

/** Tüm hareketleri kapsayacak kadar ileri bir tarih. */
const ALL_DATES = '9999-12-31'

/**
 * Saklanan balance ile türetilmiş değeri karşılaştırır.
 *
 * Karşılaştırma TÜM hareketler üzerinden yapılır, sadece geçmiş olanlar üzerinden
 * değil: saklanan balance ileri tarihli hareketler de dahil her insert'te anında
 * güncellendiği için o mantıkla birikti. Geçmişle karşılaştırsaydık her kredi ve
 * her ileri tarihli taksit sahte uyarı üretir, gerçek sapma gürültüde kaybolurdu.
 *
 * Ekranda gösterilen değer (`derived`) yine sadece gerçekleşmiş hareketlerdir.
 */
export function reconcileBalance(
    storedBalance: number | string,
    openingBalance: number | string,
    transactions: BalanceTransaction[],
    options: { asOf?: string; threshold?: number } = {}
): ReconcileResult {
    const { asOf = today(), threshold = 0.01 } = options

    const stored = roundToCents(toNumber(storedBalance))
    const derived = derivedBalance(openingBalance, transactions, asOf)
    const comparable = derivedBalance(openingBalance, transactions, ALL_DATES)
    const difference = roundToCents(comparable - stored)

    return {
        stored,
        derived,
        comparable,
        difference,
        matches: Math.abs(difference) <= threshold,
    }
}

/**
 * Uyum kontrolü: sapma varsa konsola uyarı basar, türetilmiş değeri döndürür.
 * Okuma yapan ekranlar bunu çağırır; yazma noktaları şimdilik olduğu gibi kalıyor.
 */
export function checkBalance(
    accountLabel: string,
    storedBalance: number | string,
    openingBalance: number | string,
    transactions: BalanceTransaction[],
    options: { asOf?: string; threshold?: number } = {}
): number {
    const result = reconcileBalance(storedBalance, openingBalance, transactions, options)

    if (!result.matches) {
        console.warn(
            `[bakiye uyumsuz] ${accountLabel}: saklanan ${result.stored}, ` +
            `tüm hareketlerden ${result.comparable}, fark ${result.difference} ` +
            `(ekranda gösterilen, gerçekleşmiş: ${result.derived})`
        )
    }

    return result.derived
}

/**
 * Tek hesabın bakiyesini zaman içinde nokta nokta türetir.
 *
 * `points` artan sıralı 'YYYY-MM-DD' tarih listesidir; her nokta için o tarihe
 * kadar (dahil) gerçekleşmiş hareketlerin kümülatif etkisini opening_balance'a
 * ekler. derivedBalance ile aynı işaret kuralını kullanır (kredi kartında borç
 * negatif). Kümülatif tarama sayesinde nokta başına yeniden toplamaz.
 */
export function accountBalanceSeries(
    openingBalance: number | string,
    transactions: BalanceTransaction[],
    points: string[]
): number[] {
    const sorted = transactions
        .map(tx => ({ tx, d: realizedDate(tx) }))
        .filter(x => x.d)
        .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))

    let running = toNumber(openingBalance)
    let ti = 0
    const out: number[] = []
    for (const point of points) {
        while (ti < sorted.length && sorted[ti].d <= point) {
            running += transactionEffect(sorted[ti].tx)
            ti++
        }
        out.push(roundToCents(running))
    }
    return out
}

export type AccountForBalance = {
    id: string
    name?: string
    balance?: number | string
    opening_balance?: number | string
}

export type TransactionWithAccount = BalanceTransaction & { account_id: string | null }

/**
 * Birden çok hesabın gerçekleşen bakiyesini tek seferde türetir.
 * Ekranlar bunu çağırıp saklanan balance yerine dönen değerleri gösterir.
 *
 * `warn` açıkken saklanan balance ile türetilen arasındaki sapmalar konsola yazılır;
 * ikisi bir süre yan yana çalışacağı için hangisinin doğru olduğunu böyle göreceğiz.
 */
export function deriveAccountBalances(
    accounts: AccountForBalance[],
    transactions: TransactionWithAccount[],
    options: { asOf?: string; threshold?: number; warn?: boolean } = {}
): Map<string, number> {
    const { asOf = today(), threshold = 0.01, warn = true } = options

    const byAccount = new Map<string, TransactionWithAccount[]>()
    for (const tx of transactions) {
        if (!tx.account_id) continue
        const list = byAccount.get(tx.account_id)
        if (list) list.push(tx)
        else byAccount.set(tx.account_id, [tx])
    }

    const result = new Map<string, number>()
    for (const account of accounts) {
        const accountTx = byAccount.get(account.id) ?? []

        if (warn && account.balance !== undefined && account.balance !== null) {
            result.set(
                account.id,
                checkBalance(
                    account.name || account.id,
                    account.balance,
                    account.opening_balance ?? 0,
                    accountTx,
                    { asOf, threshold }
                )
            )
        } else {
            result.set(account.id, derivedBalance(account.opening_balance ?? 0, accountTx, asOf))
        }
    }

    return result
}
