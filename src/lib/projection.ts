/**
 * Üç aylık nakit görünümü.
 *
 * UFUK BİLEREK KISA: bu ay + iki ay. Değişken harcama tahmini ancak bu aralıkta
 * anlamlı; daha ilerisi uydurma olur. 12 aylık bilinen yükler upcoming.ts'te
 * duruyor ve orada hiç tahmin yok.
 *
 * KESİN / TAHMİNİ ayrımı çıktıda taşınır (`isEstimated`), çünkü kullanıcının
 * hangi rakama ne kadar güveneceğini bilmesi gerekiyor.
 *
 * ÇİFT SAYIM: bilinen yükler upcoming.ts'ten gelir, onun kuralı burada da
 * geçerlidir — gerçek transactions satırı varsa üretilmez, okunur. Değişken
 * harcama tahmini yalnızca source_type'ı boş hareketlerden hesaplanır, yani
 * abonelik/sözleşme/taksit kaynaklı hiçbir hareket tahmine karışmaz.
 *
 * KREDİ KARTI BAKİYESİ projeksiyona asla "gelecek çıkış" olarak eklenmez.
 * Taksitler zaten kendi transactions satırlarıyla ay ay giriyor; kart borcunu
 * ayrıca eklemek aynı parayı iki kez saymak olurdu.
 *
 * Yalnızca cash_date okunur, transaction_date değil.
 */

// Açık .ts uzantısı: moduleResolution "bundler" bunu kabul ediyor ve lib/
// fonksiyonlarının düz Node ile (derleme adımı olmadan) test edilmesini sağlıyor.
import { derivedBalance, type BalanceTransaction } from './balance.ts'
import {
    buildUpcoming,
    monthKey,
    formatDate,
    type UpcomingSubscription,
    type UpcomingInstallment,
} from './upcoming.ts'
import { estimateAllCategories, type CategoryEstimate } from './estimate.ts'

/**
 * Sözleşme ödemesi. Bu uygulamada contracts bir GELİR kaynağıdır
 * ("Kontratlar ve Düzenli Gelirler"), o yüzden tipi yükümlülükleri işleyen
 * upcoming.ts'te değil burada duruyor.
 */
export type ContractPayment = {
    id: string
    amount: number | string
    expected_date: string
    status?: string | null
    contract_id?: string | null
    contractName?: string | null
}

export type ProjectionLine = {
    label: string
    /** İşaretli: giriş pozitif, çıkış negatif. */
    amount: number
    isEstimated: boolean
    /** Tahmini kalemlerde dayanak: "son 3 ay ortalaması". Kesin kalemlerde yok. */
    basis?: string
}

export type ProjectionMonth = {
    month: string
    openingBalance: number
    incomeKnown: number
    incomeEstimated: number
    outflowKnown: number
    outflowEstimated: number
    closingBalance: number
    isNegative: boolean
    lines: ProjectionLine[]
}

export type ProjectionAccount = {
    id: string
    type?: string | null
    opening_balance?: number | string | null
    balance?: number | string | null
}

export type ProjectionTransaction = BalanceTransaction & {
    account_id?: string | null
    category_id?: string | null
    categoryName?: string | null
    description?: string | null
    source_type?: string | null
    source_id?: string | null
    id?: string
}

export type GoalAllocation = {
    name: string
    /** goals.monthly_alloc — hedefe her ay ayrılan tutar. */
    monthlyAlloc: number | string
    /** goals.status. Yalnız 'aktif' hedefler projeksiyona pay olarak girer;
     *  'hazir' (hedef doldu) ve 'arsiv' pay ayırmayı bırakır. Verilmezse 'aktif' sayılır. */
    status?: 'aktif' | 'hazir' | 'arsiv'
}

export type ProjectionInput = {
    accounts: ProjectionAccount[]
    transactions: ProjectionTransaction[]
    subscriptions: UpcomingSubscription[]
    installments: UpcomingInstallment[]
    /** Sözleşme ödemeleri bu uygulamada GELİRDİR (bkz. contracts sayfası). */
    contractPayments: ContractPayment[]
    /** Hedeflere aylık ayrılan pay; her ay bilinen ÇIKIŞ satırı olarak düşülür. */
    goalAllocations?: GoalAllocation[]
}

export type ProjectionResult = {
    months: ProjectionMonth[]
    /** Değişken harcama tahmininin kaç tam aydan hesaplandığı. 0 ise tahmin yok. */
    estimateBasisMonths: number
}

const HORIZON = 3
/** Nakit görünümüne yalnızca likit hesaplar girer; kredi kartı borcu girmez. */
const LIQUID_TYPES = ['bank', 'cash']

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value) : value
    return Number.isFinite(n as number) ? (n as number) : 0
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function addMonthKey(month: string, count: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + count, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function buildProjection(
    input: ProjectionInput,
    // spendOverride: değişken harcama tahminini dışarıdan verir. Simülasyonlar
    // (ör. what-if "kategoriyi %X kıs") gerçek estimateAllCategories çıktısını
    // kopyalayıp ölçekleyip buradan besler; motor aynı kalır, veri değişmez.
    // conservative (Temkinli senaryo): değişken/beklenen gelir SIFIR sayılır —
    // yalnız tarihi belli gelir (maaş, sözleşme) girer. Değişken GİDER tahmini kalır.
    options: { from?: string; spendOverride?: CategoryEstimate[]; conservative?: boolean } = {}
): ProjectionResult {
    const from = options.from ?? formatDate(new Date())
    const currentMonth = monthKey(from)
    const horizonMonths = Array.from({ length: HORIZON }, (_, i) => addMonthKey(currentMonth, i))

    // --- Açılış bakiyesi: gerçekleşmiş, yalnızca likit hesaplar ---
    const liquidIds = new Set(
        input.accounts.filter(a => LIQUID_TYPES.includes(a.type || '')).map(a => a.id)
    )
    const liquidTx = input.transactions.filter(t => t.account_id && liquidIds.has(t.account_id))
    const liquidOpening = input.accounts
        .filter(a => liquidIds.has(a.id))
        .reduce((sum, a) => sum + toNumber(a.opening_balance), 0)

    let runningBalance = derivedBalance(liquidOpening, liquidTx, from)

    // --- Bilinen yükler: upcoming.ts'i çağır, yeniden yazma ---
    // upcoming.ts yalnızca yükümlülükleri bilir; sözleşme gelirleri aşağıda
    // incomeKnown olarak ayrıca işleniyor.
    const upcoming = buildUpcoming(
        {
            transactions: input.transactions,
            subscriptions: input.subscriptions,
            installments: input.installments,
        },
        { from, months: HORIZON }
    )

    // --- Bilinen gelir: gelecek tarihli gelir hareketleri + bekleyen sözleşme ödemeleri ---
    const realContractIds = new Set(
        input.transactions
            .filter(t => t.source_type === 'contract' && t.source_id)
            .map(t => t.source_id as string)
    )

    const knownIncomeByMonth = new Map<string, ProjectionLine[]>()
    const pushIncome = (month: string, line: ProjectionLine) => {
        const list = knownIncomeByMonth.get(month)
        if (list) list.push(line)
        else knownIncomeByMonth.set(month, [line])
    }

    for (const t of input.transactions) {
        if (t.type !== 'income' || !t.cash_date || t.cash_date < from) continue
        const month = monthKey(t.cash_date)
        if (!horizonMonths.includes(month)) continue
        pushIncome(month, {
            label: t.description || 'Gelir',
            amount: round2(toNumber(t.amount)),
            isEstimated: false,
        })
    }

    for (const p of input.contractPayments) {
        if (p.expected_date < from) continue
        // Gerçek satırı varsa üretme — upcoming.ts'teki kuralın aynısı.
        if (realContractIds.has(p.id)) continue
        const month = monthKey(p.expected_date)
        if (!horizonMonths.includes(month)) continue
        pushIncome(month, {
            label: p.contractName || 'Sözleşme geliri',
            amount: round2(toNumber(p.amount)),
            isEstimated: false,
        })
    }

    // --- Değişken harcama tahmini: kategori bazında, 3 ay kuralı estimate.ts'te.
    //     Sadece son 3 tam ayın hepsinde görünen kategoriler tahmin üretir.
    //     Simülasyon spendOverride verdiyse motor onu kullanır (veri değişmez). ---
    const spendByCategory = options.spendOverride ?? estimateAllCategories(input.transactions, currentMonth)

    // --- Gelir ortalaması: 3 ay kuralına tabi değil, mevcut mantık. ---
    //     Temkinli senaryoda değişken gelir hiç sayılmaz (0).
    const { monthlyIncomeAverage: rawIncomeAvg, basisMonths } =
        estimateIncomeAverage(input.transactions, currentMonth)
    const monthlyIncomeAverage = options.conservative ? 0 : rawIncomeAvg

    // --- Hedef payları: her ay bilinen ÇIKIŞ satırı. Aynı tutar tüm aylarda tekrar
    //     eder; "gerçek gider satırı gibi" nakit görünümüne düşer. ---
    const goalLines: ProjectionLine[] = (input.goalAllocations ?? [])
        // Yalnız 'aktif' hedefler pay ayırır; 'hazir'/'arsiv' projeksiyona girmez.
        .filter(g => (g.status ?? 'aktif') === 'aktif' && toNumber(g.monthlyAlloc) > 0)
        .map(g => ({ label: `${g.name} birikimi`, amount: -round2(toNumber(g.monthlyAlloc)), isEstimated: false }))
    const goalOutflow = round2(goalLines.reduce((s, l) => s + Math.abs(l.amount), 0))

    const months: ProjectionMonth[] = horizonMonths.map(month => {
        const openingBalance = round2(runningBalance)

        const knownIncomeLines = knownIncomeByMonth.get(month) ?? []
        const incomeKnown = round2(knownIncomeLines.reduce((s, l) => s + l.amount, 0))

        // Tahmini gelir, bilinen geliri KAPSAR: beklenen toplam gelir en az geçmiş
        // ortalaması kadardır. Böylece maaşını elle ileri tarihli girmiş bir kullanıcıda
        // aynı gelir iki kez sayılmaz.
        const incomeEstimated = round2(Math.max(0, monthlyIncomeAverage - incomeKnown))

        const knownLoad = upcoming.months.find(m => m.month === month)
        const outflowKnown = round2((knownLoad?.total ?? 0) + goalOutflow)

        const estimatedSpendLines: ProjectionLine[] = spendByCategory.map(c => ({
            label: c.label,
            amount: -c.amount,
            isEstimated: true,
            basis: c.basisLabel,
        }))
        const outflowEstimated = round2(spendByCategory.reduce((s, c) => s + c.amount, 0))

        const lines: ProjectionLine[] = [
            ...knownIncomeLines,
            ...(incomeEstimated > 0
                ? [{ label: 'Beklenen diğer gelir', amount: incomeEstimated, isEstimated: true }]
                : []),
            // Bunların hepsi outflowKnown'a giriyor, dolayısıyla satır düzeyinde de
            // kesin sayılırlar. Tarihi ve tutarı belli bir abonelik, henüz transactions
            // satırı olmasa da tahmin değildir. (Gerçek satırdan mı okundu bilgisi
            // gerekirse upcoming.ts'in isRealTransaction alanında duruyor.)
            ...(knownLoad?.items ?? []).map(item => ({
                label: item.label,
                amount: -item.amount,
                isEstimated: false,
            })),
            ...goalLines,
            ...estimatedSpendLines,
        ]

        const closingBalance = round2(
            openingBalance + incomeKnown + incomeEstimated - outflowKnown - outflowEstimated
        )
        runningBalance = closingBalance

        return {
            month,
            openingBalance,
            incomeKnown,
            incomeEstimated,
            outflowKnown,
            outflowEstimated,
            closingBalance,
            isNegative: closingBalance < 0,
            lines,
        }
    })

    return { months, estimateBasisMonths: basisMonths }
}

/**
 * Son 3 TAM ayın (içinde bulunulan ay hariç) gelir ortalaması.
 * Kategori harcama tahmininin aksine gelir 3-ay-kuralına tabi değildir: geçmiş
 * kaç ay varsa ona bölünür. Yalnızca source_type'ı boş hareketler sayılır.
 */
function estimateIncomeAverage(
    transactions: ProjectionTransaction[],
    currentMonth: string
): { monthlyIncomeAverage: number; basisMonths: number } {
    const basisSet = new Set([1, 2, 3].map(i => addMonthKey(currentMonth, -i)))

    const monthsSeen = new Set<string>()
    let incomeTotal = 0

    for (const t of transactions) {
        if (t.type !== 'income' || !t.cash_date) continue
        if (t.source_type) continue
        const month = monthKey(t.cash_date)
        if (!basisSet.has(month)) continue
        monthsSeen.add(month)
        incomeTotal += toNumber(t.amount)
    }

    const basisMonths = monthsSeen.size
    if (basisMonths === 0) return { monthlyIncomeAverage: 0, basisMonths: 0 }
    return { monthlyIncomeAverage: round2(incomeTotal / basisMonths), basisMonths }
}
