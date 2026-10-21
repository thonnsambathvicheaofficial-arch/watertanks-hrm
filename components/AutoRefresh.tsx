'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Re-renders the server data on an interval while the tab is visible.
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') router.refresh() }, seconds * 1000)
    return () => clearInterval(id)
  }, [router, seconds])
  return null
}
