'use client'

import { useRouter } from 'next/navigation'
import { Button } from './ui'

export function SignOutButton() {
  const router = useRouter()
  return <Button onClick={async () => { await fetch('/api/logout', { method: 'POST' }); router.replace('/login'); router.refresh() }}>Sign out</Button>
}
