"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function DebugPage() {
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
    const [details, setDetails] = useState<any>(null)
    const [errorMsg, setErrorMsg] = useState<string>('')

    useEffect(() => {
        async function checkConnection() {
            try {
                console.log('Checking connection...')
                const { data, error } = await supabase.from('households').select('*').limit(1)

                if (error) {
                    console.error('Connection error:', error)
                    setStatus('error')
                    setErrorMsg(error.message)
                    setDetails(error)
                } else {
                    console.log('Connection success:', data)
                    setStatus('success')
                    setDetails(data)
                }
            } catch (err: any) {
                console.error('Catch error:', err)
                setStatus('error')
                setErrorMsg(err.message)
            }
        }
        checkConnection()
    }, [])

    return (
        <div className="p-10 font-sans bg-slate-900 min-h-screen text-white">
            <h1 className="text-3xl font-bold mb-6">Supabase Bağlantı Testi</h1>

            <div className={`p-6 rounded-lg mb-6 ${status === 'loading' ? 'bg-blue-500/20 text-blue-400' :
                    status === 'success' ? 'bg-green-500/20 text-green-400' :
                        'bg-red-500/20 text-red-400'
                }`}>
                <p className="text-xl font-semibold">
                    Durum: {status === 'loading' ? 'Kontrol ediliyor...' : status === 'success' ? 'BAĞLANTI BAŞARILI ✅' : 'HATA VAR ❌'}
                </p>
                {errorMsg && (
                    <div className="mt-4 p-4 bg-black/40 rounded border border-red-500/50">
                        <p className="font-mono text-red-400">{errorMsg}</p>
                        <p className="text-sm mt-2 opacity-70">Hata Kodu: {details?.code}</p>
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <h2 className="text-xl font-semibold">Teşhis ve Çözüm Adımları:</h2>
                <ul className="list-disc ml-6 space-y-2 text-slate-300">
                    <li>Hata <strong>"infinite recursion"</strong> ise: Supabase SQL Editor'de RLS kurallarını kapatan komutu (DISABLE RLS) çalıştırmanız gerekir.</li>
                    <li>Hata <strong>"Project not found"</strong> ise: .env.local dosyasındaki URL veya Key hatalıdır.</li>
                    <li>Durum <strong>"Kontrol ediliyor..."</strong> olarak takılı kalıyorsa: İnternet bağlantınızı veya Supabase projenizin aktifliğini kontrol edin.</li>
                </ul>
            </div>

            <div className="mt-10 p-6 bg-white/5 rounded-lg border border-white/10">
                <p className="font-semibold mb-2">Supabase Bilgileriniz (Client Tarafı):</p>
                <code className="block bg-black/40 p-4 rounded text-sm overflow-x-auto">
                    URL: {process.env.NEXT_PUBLIC_SUPABASE_URL || 'YOK'}<br />
                    Key: {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '****** (Gizli)' : 'YOK'}
                </code>
            </div>

            <button
                onClick={() => window.location.reload()}
                className="mt-6 px-6 py-3 bg-primary text-white rounded-lg font-bold hover:opacity-90 transition-opacity"
            >
                Yeniden Test Et
            </button>
        </div>
    )
}
