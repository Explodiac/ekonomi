/**
 * İki bacaklı transfer düzenlemesi — tutar/tarih değişince her bacağın yeni
 * cash_date'i (kendi hesabından) ve her hesabın yeni bakiyesi hesaplanır.
 *
 * YENİ HESAP MANTIĞI YOK: işaret kuralı transactionEffect'ten, cash_date kuralı
 * resolveCashDate'ten gelir. Burada yalnız o ikisini İKİ BACAĞA uygularız.
 * Yön ve hesaplar değişmez (ayrı akış); sadece tutar/tarih güncellenir.
 */

import { resolveCashDate, type CashDateAccount } from './cash-date.ts'
import { transactionEffect } from './transaction-effect.ts'

export type TransferLeg = {
    id: string
    account_id: string | null
    transfer_direction: 'in' | 'out' | string | null
    /** Bacağın mevcut cash_date'i (rule 3 — gerçekleşmiş hareket ileri atılmaz). */
    cash_date: string
}
export type LegAccount = CashDateAccount & { id: string; balance: number | string }

export type TransferEditPlan = {
    /** Her bacak için yeni cash_date + tutar. */
    legUpdates: { id: string; cash_date: string; amount: number }[]
    /** Her hesap için yeni bakiye (eski etkiyi geri al, yeni etkiyi uygula). */
    balanceUpdates: { accountId: string; balance: number }[]
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

export function planTransferEdit(input: {
    legs: TransferLeg[]
    accounts: LegAccount[]
    oldAmount: number
    newAmount: number
    /** Yeni transaction_date ('YYYY-MM-DD' ya da Date). */
    newDate: string | Date
    /** Bugün — test için verilebilir. */
    today?: string
}): TransferEditPlan {
    const accById = new Map(input.accounts.map(a => [a.id, a]))

    const legUpdates = input.legs.map(leg => {
        const acc = leg.account_id ? accById.get(leg.account_id) : undefined
        // Transfer bacağı: kart mantığı uygulanmaz — para hareket günü taşınır
        // (kaynak/hedef kart olsa bile cash_date = transaction_date).
        const cash_date = resolveCashDate({
            transactionDate: input.newDate,
            currentCashDate: leg.cash_date,
            targetAccount: acc,
            today: input.today,
            isTransfer: true,
        })
        return { id: leg.id, cash_date, amount: input.newAmount }
    })

    const balanceUpdates = input.legs
        .filter(leg => leg.account_id)
        .map(leg => {
            const acc = accById.get(leg.account_id!)
            const base = acc ? Number(acc.balance) : 0
            // Eski etkiyi geri al, yeni etkiyi uygula — işaret transactionEffect'ten.
            const oldEffect = transactionEffect({ amount: input.oldAmount, type: 'transfer', transfer_direction: leg.transfer_direction })
            const newEffect = transactionEffect({ amount: input.newAmount, type: 'transfer', transfer_direction: leg.transfer_direction })
            return { accountId: leg.account_id!, balance: round2(base - oldEffect + newEffect) }
        })

    return { legUpdates, balanceUpdates }
}
