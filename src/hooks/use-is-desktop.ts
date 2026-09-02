'use client'

import { useState, useEffect } from 'react'

/**
 * Masaüstü genişliğinde miyiz (varsayılan lg = 1024px). matchMedia'yı dinler,
 * viewport bilindiğinde/değiştiğinde günceller — böylece "açılışta ilk kaydı
 * seç" gibi efektler, pencere layout'u geç oturduğunda da doğru tetiklenir.
 * Mobilde false döner → iki-panel ekranlarda bottom sheet açılışta açılmaz.
 */
export function useIsDesktop(minWidth = 1024): boolean {
    const [isDesktop, setIsDesktop] = useState(false)
    useEffect(() => {
        const mq = window.matchMedia(`(min-width:${minWidth}px)`)
        const update = () => setIsDesktop(mq.matches)
        update()
        mq.addEventListener('change', update)
        return () => mq.removeEventListener('change', update)
    }, [minWidth])
    return isDesktop
}
