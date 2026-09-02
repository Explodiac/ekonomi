import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * SADECE LOKAL GELİŞTİRME İÇİN.
 *
 * Login formunu ortadan kaldırır: oturum yoksa middleware buraya yönlendirir,
 * burada seed'deki kullanıcıyla sessizce giriş yapılır ve session cookie'si set edilir.
 * Kimlik bilgileri sunucuda kalır, tarayıcıya hiç gitmez.
 *
 * Prod'a taşırken bu dosyayı silmek ve middleware'deki yönlendirmeyi /login'e
 * geri almak yeterli — RLS politikaları ve auth akışının geri kalanı olduğu gibi çalışır.
 */
export async function GET(request: NextRequest) {
    const email = process.env.SUPABASE_DEV_USER_EMAIL
    const password = process.env.SUPABASE_DEV_USER_PASSWORD

    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json(
            { error: 'Otomatik giriş sadece geliştirme ortamında kullanılabilir.' },
            { status: 404 }
        )
    }

    if (!email || !password) {
        return NextResponse.json(
            { error: 'SUPABASE_DEV_USER_EMAIL / SUPABASE_DEV_USER_PASSWORD tanımlı değil. .env.local dosyasını kontrol edin.' },
            { status: 500 }
        )
    }

    const redirectTo = request.nextUrl.searchParams.get('next') || '/dashboard'
    // Açık yönlendirmeyi engelle: sadece uygulama içi göreli yollara izin ver.
    const safeRedirect = redirectTo.startsWith('/') && !redirectTo.startsWith('//')
        ? redirectTo
        : '/dashboard'

    const response = NextResponse.redirect(new URL(safeRedirect, request.url))
    const cookieStore = await cookies()

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
        return NextResponse.json(
            {
                error: 'Otomatik giriş başarısız.',
                detail: error.message,
                ipucu: 'SUPABASE_DEV_USER_EMAIL/PASSWORD ile bir kullanıcı var mı? (db reset KULLANMA — gerçek veriyi siler.)',
            },
            { status: 500 }
        )
    }

    return response
}
