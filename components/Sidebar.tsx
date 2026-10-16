'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Activity, Building2, CalendarDays, CalendarOff, Clock, Fingerprint, LogOut, Menu, Repeat, Scale, Table2, Users, X, PartyPopper } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'

const NAV = [
  { href: '/', label: 'Live', icon: Activity },
  { href: '/reports', label: 'Reports', icon: Table2 },
  { href: '/roster', label: 'Roster', icon: CalendarDays },
  { href: '/leave', label: 'Leave', icon: CalendarOff },
  { href: '/staff', label: 'Staff', icon: Users },
  { href: '/rotation', label: 'Rotation', icon: Repeat },
]
const SETUP = [
  { href: '/settings/shifts', label: 'Shifts', icon: Clock },
  { href: '/settings/departments', label: 'Departments', icon: Building2 },
  { href: '/holidays', label: 'Holidays', icon: PartyPopper },
  { href: '/settings/leave-types', label: 'Leave types', icon: CalendarOff },
  { href: '/settings/entitlements', label: 'Entitlements', icon: Scale },
  { href: '/devices', label: 'Devices', icon: Fingerprint },
]

export function Sidebar({ username }: { username: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'))

  async function signOut() {
    await fetch('/api/logout', { method: 'POST' })
    router.replace('/login'); router.refresh()
  }

  const link = ({ href, label, icon: Icon }: (typeof NAV)[number]) => (
    <li key={href}>
      <Link
        href={href}
        onClick={() => setOpen(false)}
        aria-current={active(href) ? 'page' : undefined}
        className={cn(
          'flex h-10 items-center gap-3 rounded px-3 text-[14px] transition-colors',
          active(href) ? 'bg-steel-raised font-medium text-white' : 'text-steel-soft hover:bg-steel-raised/60 hover:text-steel-text',
        )}
      >
        <Icon size={18} strokeWidth={1.75} aria-hidden />
        {label}
      </Link>
    </li>
  )

  const nav = (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
      <ul className="space-y-0.5">{NAV.map(link)}</ul>
      <p className="mb-1 mt-6 px-3 text-[12px] text-steel-soft">Setup</p>
      <ul className="space-y-0.5">{SETUP.map(link)}</ul>
    </nav>
  )

  const footer = (
    <div className="border-t border-steel-line p-3">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="truncate text-[13px] text-steel-text" title={username}>{username}</span>
        <button onClick={signOut} className="rounded p-1.5 text-steel-soft transition-colors hover:bg-steel-raised hover:text-white" aria-label="Sign out">
          <LogOut size={17} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col bg-steel lg:flex">
        <div className="flex h-16 items-center gap-3 px-5">
          <Logo size={34} />
          <span className="text-[14px] font-semibold leading-tight text-white">Song Fa<br /><span className="font-normal text-steel-soft">HR</span></span>
        </div>
        {nav}
        {footer}
      </aside>

      {/* Mobile bar + drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-steel px-4 lg:hidden">
        <div className="flex items-center gap-3"><Logo size={28} /><span className="text-[14px] font-semibold text-white">Song Fa HR</span></div>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded p-2 text-steel-text hover:bg-steel-raised"><Menu size={20} /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-ink/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[260px] flex-col bg-steel shadow-float">
            <div className="flex h-14 items-center justify-between px-4">
              <span className="text-[14px] font-semibold text-white">Menu</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded p-2 text-steel-text hover:bg-steel-raised"><X size={20} /></button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}
    </>
  )
}
