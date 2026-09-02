import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase env variables are MISSING! Check your .env.local file.')
} else {
    console.log('Supabase client initializing with URL:', supabaseUrl)
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

export async function ensureHouseholdExists(userId: string): Promise<string | null> {
    try {
        // Zaten bir aileye üye mi kontrol et
        const { data: memberships, error } = await supabase
            .from('household_members')
            .select('household_id')
            .eq('user_id', userId)
            .order('created_at', { ascending: true }) // İlk oluşturulan ana aileyi baz al
            .limit(1)

        if (memberships && memberships.length > 0 && memberships[0].household_id) {
            return memberships[0].household_id
        }

        // Eğer üye değilse, yepyeni bir "Benim Ailem" household'u oluştur.
        const { data: newHousehold, error: hError } = await supabase
            .from('households')
            .insert([{ name: 'Benim Ailem' }])
            .select('id')
            .single()

        if (hError || !newHousehold) throw hError

        // Kullanıcıyı o yeni aileye admin olarak ata
        const { error: mError } = await supabase
            .from('household_members')
            .insert([{ household_id: newHousehold.id, user_id: userId, role: 'admin' }])

        if (mError) throw mError

        return newHousehold.id

    } catch (e) {
        console.error("Household creation failed:", e)
        return null
    }
}
export async function createNotification(
    hhId: string,
    title: string,
    message: string,
    type: 'info' | 'warning' | 'success' | 'error' | 'transaction' = 'info',
    userId?: string
) {
    try {
        const { error } = await supabase.from('notifications').insert({
            household_id: hhId,
            title,
            message,
            type,
            user_id: userId || null
        })
        if (error) throw error
    } catch (e) {
        console.error("Notification trigger failed:", e)
    }
}
