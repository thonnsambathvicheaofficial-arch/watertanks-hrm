import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'

// The layout signs people in and builds the menu from their permissions. It is NOT where a
// page is protected: Next.js does not re-run a layout on client-side navigation, so every
// page calls guard() itself (lib/guard.ts).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess()
  if (!access) redirect('/login')
  return (
    <div className="min-h-screen">
      <Sidebar username={access.username} perms={access.perms} roleLabel={access.isAdmin ? 'Administrator' : access.roleName || 'No role'} />
      <main className="lg:pl-[232px] print:pl-0">
        <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  )
}
