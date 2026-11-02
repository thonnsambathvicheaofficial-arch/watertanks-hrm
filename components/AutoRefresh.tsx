'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

// Re-renders the server data on an interval while the tab is visible AND somebody is using it. Every refresh costs a server
// render, so a tab left open on an empty desk stops refreshing after `idleMinutes` without a mouse move, key press, scroll or
// touch, and refreshes straight away when activity returns.
export function AutoRefresh({ seconds = 60, idleMinutes = 10 }: { seconds?: number; idleMinutes?: number }) {
  const router = useRouter()
  const lastActive = useRef(Date.now())
  const paused = useRef(false)
  useEffect(() => {
    const touch = () => {
      lastActive.current = Date.now()
      if (paused.current) { paused.current = false; router.refresh() }
    }
    const events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const
    events.forEach(e => window.addEventListener(e, touch, { passive: true }))
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastActive.current > idleMinutes * 60000) { paused.current = true; return }
      router.refresh()
    }, seconds * 1000)
    return () => { clearInterval(id); events.forEach(e => window.removeEventListener(e, touch)) }
  }, [router, seconds, idleMinutes])
  return null
}
