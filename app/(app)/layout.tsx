import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { SESSION_COOKIE, verifySession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value)
  if (!session) redirect('/login')
  return (
    <div className="min-h-screen">
      <Sidebar username={session.username} />
      <main className="lg:pl-[232px]">
        <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  )
}
