'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PrimaryButton } from '@/components/ui/primary-button'
import { Wallet, Mail, Lock, Loader2 } from 'lucide-react'

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginInner />
        </Suspense>
    )
}

function LoginInner() {
    const params = useSearchParams()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [remember, setRemember] = useState(true)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const nextPath = (() => {
        const n = params.get('next') || '/dashboard'
        return n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard'
    })()

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setError(null)
        try {
            const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
            if (error) throw error
            // Tam sayfa yönlendirme: yeni oturum cookie'sini middleware'in görmesini garanti eder.
            window.location.href = nextPath
        } catch (err: any) {
            setError(err?.message === 'Invalid login credentials'
                ? 'E-posta veya şifre hatalı.'
                : (err?.message || 'Giriş yapılamadı. Bilgileri kontrol edin.'))
            setIsLoading(false)
        }
    }

    const inputBase = 'w-full py-[var(--s3)] pl-10 pr-[var(--s3)] outline-none'
    const inputStyle = { background: 'var(--bg)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 14.5, border: '1px solid var(--border)' } as const

    return (
        <div className="flex min-h-screen items-center justify-center p-[var(--s4)]" style={{ background: 'var(--bg)' }}>
            <div className="w-full max-w-[380px]">
                {/* Marka */}
                <div className="mb-[var(--s5)] flex flex-col items-center gap-[var(--s2)]">
                    <span className="inline-flex h-12 w-12 items-center justify-center" style={{ background: 'var(--accent-bg)', borderRadius: 'var(--r-card)' }}>
                        <Wallet className="h-6 w-6" style={{ color: 'var(--accent)' }} />
                    </span>
                    <div className="text-center">
                        <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Aile Bütçesi</div>
                        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Devam etmek için giriş yap</div>
                    </div>
                </div>

                {/* Form */}
                <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="p-[22px]">
                    <form onSubmit={handleLogin} className="space-y-[var(--s3)]">
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
                            <input
                                type="email" autoComplete="email" required placeholder="E-posta"
                                value={email} onChange={e => setEmail(e.target.value)}
                                className={inputBase} style={inputStyle}
                            />
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
                            <input
                                type="password" autoComplete="current-password" required minLength={6} placeholder="Şifre"
                                value={password} onChange={e => setPassword(e.target.value)}
                                className={inputBase} style={inputStyle}
                            />
                        </div>

                        <label className="flex cursor-pointer items-center gap-[var(--s2)] pt-[2px]">
                            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
                                className="h-[15px] w-[15px]" style={{ accentColor: 'var(--accent)' }} />
                            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Beni hatırla — bir daha sorma</span>
                        </label>

                        {error && (
                            <div className="px-[var(--s3)] py-[var(--s2)]" style={{ background: 'color-mix(in srgb, var(--flow-out) 12%, transparent)', color: 'var(--flow-out)', borderRadius: 'var(--r-button)', fontSize: 13 }}>
                                {error}
                            </div>
                        )}

                        <PrimaryButton type="submit" disabled={isLoading || !email || !password} className="w-full">
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Giriş yap'}
                        </PrimaryButton>
                    </form>
                </section>

                <p className="mt-[var(--s4)] text-center" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                    Hesabın ailenle ortak. Yeni hesap yönetici tarafından eklenir.
                </p>
            </div>
        </div>
    )
}
