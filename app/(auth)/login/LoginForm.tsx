'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, Input } from '@/components/ui'

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(''); setBusy(true)
    const f = new FormData(e.currentTarget)
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: f.get('username'), password: f.get('password') }),
      })
      if (!r.ok) { setError((await r.json().catch(() => ({}))).error || 'Sign-in failed. Try again.'); setBusy(false); return }
      router.replace('/'); router.refresh()
    } catch {
      setError('Could not reach the server. Check the connection and try again.'); setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Username"><Input name="username" autoComplete="username" autoFocus required /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</Button>
      <p role="alert" className="min-h-[20px] text-[13px] text-absent">{error}</p>
    </form>
  )
}
