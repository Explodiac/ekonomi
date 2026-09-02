/**
 * Bir hareketin bakiyeye net etkisi — İŞARET MANTIĞININ TEK KAYNAĞI.
 *
 * transfer_direction dahil tüm işaret kuralı burada. Bakiye/projeksiyon/net değer
 * hesaplayan HER yer bunu çağırır, kendi `type==='income' ? +amount : -amount`
 * kopyasını yazmaz. Kural her yerde ayrı yazıldığında transfer'in bir bacağını
 * yanlış işaretle sayan sessiz bug (nakit/what-if/asset-purchase'te üç kez çıktı)
 * tekrarlanır.
 *
 * Kural:
 *   gelir            → +amount
 *   transfer 'in'    → +amount   (hedef hesap artar)
 *   transfer 'out'   → −amount   (kaynak hesap azalır)
 *   gider            → −amount
 *
 * BOZUK SATIR: type='transfer' ama transfer_direction boş/tanınmayan gelirse
 * çıkış (−amount) sayılır — muhafazakâr varsayılan; bir hesabı sessizce
 * ŞİŞİRMEK, sessizce eksiltmekten daha tehlikelidir. (Legacy davranışla aynı.)
 */

export type EffectTransaction = {
    amount: number | string
    type: string
    /** Transferde yön: 'out' kaynak (−), 'in' hedef (+). Diğer tiplerde boş. */
    transfer_direction?: 'in' | 'out' | string | null
}

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

export function transactionEffect(tx: EffectTransaction): number {
    const amount = toNumber(tx.amount)
    if (tx.type === 'income') return amount
    if (tx.type === 'transfer') return tx.transfer_direction === 'in' ? amount : -amount
    return -amount // gider ve tanınmayan tip: çıkış
}
