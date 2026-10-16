'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Activity, Building2, CalendarDays, CalendarOff, ClipboardList, Clock, FileClock, Fingerprint, KeyRound, Landmark, LogOut, Menu, PartyPopper, Repeat, Scale, Settings2, ShieldCheck, Table2, Timer, Upload, Users, Wallet, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'

type Item = { href: string; label: string; icon: React.ElementType; perm: string }

// Each link shows only if the signed-in account has the permission its page needs
// (the same table the pages themselves enforce, lib/permissions.js).
const NAV: Item[] = [
  { href: '/', label: 'Live', icon: Activity, perm: 'attendance.view' },
  { href: '/reports', label: 'Reports', icon: Table2, perm: 'attendance.view' },
  { href: '/roster', label: 'Roster', icon: CalendarDays, perm: 'attendance.view' },
  { href: '/leave', label: 'Leave', icon: CalendarOff, perm: 'leave.view' },
  { href: '/staff', label: 'Staff', icon: Users, perm: 'staff.view' },
  { href: '/rotation', label: 'Rotation', icon: Repeat, perm: 'staff.view' },
]
const PAY: Item[] = [
  { href: '/payroll', label: 'Payroll', icon: Wallet, perm: 'payroll.view' },
  { href: '/payroll/overtime', label: 'Overtime', icon: Timer, perm: 'payroll.view' },
  { href: '/payroll/items', label: 'Monthly items', icon: ClipboardList, perm: 'payroll.view' },
  { href: '/payroll/setup', label: 'Pay setup', icon: Landmark, perm: 'payroll.view' },
]
const SETUP: Item[] = [
  { href: '/settings/shifts', label: 'Shifts', icon: Clock, perm: 'setup.view' },
  { href: '/settings/departments', label: 'Departments', icon: Building2, perm: 'setup.view' },
  { href: '/settings/work-hours', label: 'Default hours', icon: Clock, perm: 'setup.view' },
  { href: '/holidays', label: 'Holidays', icon: PartyPopper, perm: 'setup.view' },
  { href: '/settings/leave-types', label: 'Leave types', icon: CalendarOff, perm: 'setup.view' },
  { href: '/settings/entitlements', label: 'Entitlements', icon: Scale, perm: 'setup.view' },
  { href: '/settings/payroll', label: 'Payroll settings', icon: Settings2, perm: 'payroll.view' },
  { href: '/devices', label: 'Devices', icon: Fingerprint, perm: 'attendance.view' },
]
const ADMIN: Item[] = [
  { href: '/import', label: 'Import', icon: Upload, perm: 'import.run' },
  { href: '/settings/audit', label: 'Audit log', icon: FileClock, perm: 'audit.view' },
  { href: '/settings/users', label: 'Accounts', icon: KeyRound, perm: 'users.manage' },
  { href: '/settings/roles', label: 'Roles', icon: ShieldCheck, perm: 'users.manage' },
]
const SECTIONS: [string, Item[]][] = [['', NAV], ['Payroll', PAY], ['Setup', SETUP], ['Administration', ADMIN]]

export function Sidebar({ username, perms, roleLabel }: { username: string; perms: string[]; roleLabel: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'))

  async function signOut() {
    await fetch('/api/logout', { method: 'POST' })
    router.replace('/login'); router.refresh()
  }

  const link = ({ href, label, icon: Icon }: Item) => (
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
      {SECTIONS.map(([title, items], i) => {
        const shown = items.filter(it => perms.includes(it.perm))
        if (!shown.length) return null
        return (
          <div key={title || 'main'}>
            {title && <p className={cn('mb-1 px-3 text-[12px] text-steel-soft', i > 0 && 'mt-6')}>{title}</p>}
            <ul className="space-y-0.5">{shown.map(link)}</ul>
          </div>
        )
      })}
    </nav>
  )

  const footer = (
    <div className="border-t border-steel-line p-3">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-steel-text" title={username}>{username}</span>
          <span className="block truncate text-[12px] text-steel-soft">{roleLabel}</span>
        </span>
        <button onClick={signOut} className="rounded p-1.5 text-steel-soft transition-colors hover:bg-steel-raised hover:text-white" aria-label="Sign out">
          <LogOut size={17} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col bg-steel lg:flex print:hidden">
        <div className="flex h-16 items-center gap-3 px-5">
          <Logo size={34} />
          <span className="text-[14px] font-semibold leading-tight text-white">Song Fa<br /><span className="font-normal text-steel-soft">HR</span></span>
        </div>
        {nav}
        {footer}
      </aside>

      {/* Mobile bar + drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-steel px-4 lg:hidden print:hidden">
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
