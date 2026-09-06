/**
 * Household tercihleri (settings tablosu) okuma.
 *
 * Eşikleri okuyan ekranlar bunu çağırır. Satır YOKSA ya da okunamazsa `null`
 * döner — çağıran taraf o zaman ilgili lib'in KENDİ varsayılan sabitine düşer
 * (budget %80, kart %40 gibi), settings tablosunun DB varsayılanına değil.
 * Böylece tercih hiç dokunulmamışsa mevcut davranış birebir korunur.
 */
export type AppSettings = {
    /** Rezerv ay sayısı (dokunulmaz acil tampon). */
    reserveMonths: number
    /** Bütçe kullanım uyarı eşiği, yüzde (0-100). */
    budgetAlertPct: number
    /** Kart limit kullanım uyarı eşiği, yüzde (0-100). */
    cardAlertPct: number
    /** Borç servis oranı uyarı eşiği, yüzde (0-100). */
    debtServicePct: number
    /** Gider eklerken varsayılan gelecek hesap (son kullanılan). Yoksa null. */
    lastAccountId: string | null
}

export async function fetchSettings(
    supabase: { from: (t: string) => any },
    householdId: string
): Promise<AppSettings | null> {
    try {
        const { data } = await supabase
            .from('settings')
            .select('reserve_months, alert_budget_pct, alert_card_pct, alert_debt_service_pct, last_account_id')
            .eq('household_id', householdId)
            .maybeSingle()
        if (!data) return null
        return {
            reserveMonths: Number(data.reserve_months),
            budgetAlertPct: Number(data.alert_budget_pct),
            cardAlertPct: Number(data.alert_card_pct),
            debtServicePct: Number(data.alert_debt_service_pct),
            lastAccountId: data.last_account_id ?? null,
        }
    } catch {
        return null
    }
}

/**
 * Son kullanılan hesabı kaydeder (gider eklendiğinde çağrılır). settings satırı
 * yoksa oluşturur; varsa yalnız last_account_id'yi günceller (diğer eşikler
 * korunur — upsert sadece verilen kolonları yazar). Hata sessizce yutulur:
 * hatırlama başarısız olsa da gider kaydı akışı bozulmamalı.
 */
export async function updateLastAccount(
    supabase: { from: (t: string) => any },
    householdId: string,
    accountId: string
): Promise<void> {
    try {
        await supabase.from('settings').upsert(
            { household_id: householdId, last_account_id: accountId, updated_at: new Date().toISOString() },
            { onConflict: 'household_id' },
        )
    } catch (e) {
        console.error('Son hesap kaydedilemedi:', e)
    }
}
