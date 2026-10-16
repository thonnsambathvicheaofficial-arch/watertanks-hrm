import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { SignOutButton } from '@/components/SignOutButton'
import { getAccess } from '@/lib/access'

export const metadata: Metadata = { title: 'No access' }
export const dynamic = 'force-dynamic'

export default async function NoAccessPage() {
  const access = await getAccess()
  return (
    <main className="mx-auto flex min-h-screen max-w-[520px] flex-col justify-center px-6 py-12">
      <div className="mb-6"><Logo size={44} /></div>
      <h1 className="text-[22px] font-semibold tracking-[-0.01em]">You do not have access to that page</h1>
      <p className="mt-2 text-[14px] text-ink-soft">
        {!access ? 'You are not signed in.'
          : access.isAdmin ? 'This page is not available.'
          : access.perms.length === 0 ? 'Your account has no role yet, so it cannot open anything. Ask an administrator to give it one.'
          : `Your account${access.roleName ? ` (${access.roleName})` : ''} is not allowed to open it. Ask an administrator if you need it.`}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        {access && access.perms.length > 0 && <Link href="/" className="inline-flex h-9 items-center rounded bg-brand px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep">Back to the start</Link>}
        <SignOutButton />
      </div>
    </main>
  )
}
