import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger' }

export function Button({ variant = 'quiet', className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand text-white hover:bg-brand-deep',
        variant === 'quiet' && 'border border-line-strong bg-raised text-ink hover:bg-brand-wash',
        variant === 'danger' && 'border border-absent/40 bg-raised text-absent hover:bg-absent-wash',
        className,
      )}
    />
  )
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={cn(
        'h-9 w-full rounded border border-line-strong bg-raised px-3 text-[14px] text-ink transition-colors hover:border-ink-faint focus-visible:border-brand',
        className,
      )}
    />
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-soft">{hint}</span>}
    </label>
  )
}

export type StatusKey = 'present' | 'late' | 'absent' | 'leave' | 'excused' | 'dayoff' | 'holiday'

const STATUS: Record<StatusKey, { label: string; cls: string }> = {
  present: { label: 'Present', cls: 'bg-present-wash text-present' },
  late: { label: 'Late', cls: 'bg-late-wash text-late' },
  absent: { label: 'Absent', cls: 'bg-absent-wash text-absent' },
  leave: { label: 'Leave', cls: 'bg-leave-wash text-leave' },
  excused: { label: 'Excused', cls: 'bg-excused-wash text-excused' },
  dayoff: { label: 'Day off', cls: 'bg-dayoff-wash text-dayoff' },
  holiday: { label: 'Holiday', cls: 'bg-holiday-wash text-holiday' },
}

// Status is always a word plus a dot, never colour alone.
export function StatusBadge({ status }: { status: string }) {
  const key = (status === 'day_off' ? 'dayoff' : status) as StatusKey
  const s = STATUS[key] ?? { label: status, cls: 'bg-dayoff-wash text-dayoff' }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[12px] font-medium', s.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {s.label}
    </span>
  )
}

export function PageHeader({ title, children, note }: { title: string; children?: ReactNode; note?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {note && <p className="mt-1 text-[14px] text-ink-soft">{note}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}

const LEAVE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-late-wash text-late' },
  approved: { label: 'Approved', cls: 'bg-present-wash text-present' },
  rejected: { label: 'Rejected', cls: 'bg-absent-wash text-absent' },
  cancelled: { label: 'Cancelled', cls: 'bg-dayoff-wash text-dayoff' },
}

export function LeaveStatusBadge({ status }: { status: string }) {
  const s = LEAVE_STATUS[status] ?? { label: status, cls: 'bg-dayoff-wash text-dayoff' }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[12px] font-medium', s.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{s.label}
    </span>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-soft">{children}</p>}
    </div>
  )
}

export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={cn('h-9 w-full rounded border border-line-strong bg-raised px-3 text-[14px] text-ink transition-colors hover:border-ink-faint focus-visible:border-brand', className)}
    >
      {children}
    </select>
  )
}

// A flash message from the last action. Errors name the problem; saved confirms the change.
export function Flash({ error, saved }: { error?: string; saved?: string }) {
  if (!error && !saved) return null
  return (
    <div role={error ? 'alert' : 'status'} className={cn('mb-5 rounded border px-3.5 py-2.5 text-[14px]', error ? 'border-absent/35 bg-absent-wash text-absent' : 'border-present/35 bg-present-wash text-present')}>
      {error || (saved === '1' ? 'Saved.' : saved)}
    </div>
  )
}

// Shown on pages that need the migration before they can work.
export function MigrationNotice({ file = '001_shifts_departments_staff_profile.sql' }: { file?: string }) {
  return (
    <div className="rounded-md border border-line bg-raised p-5">
      <h2 className="text-[15px] font-semibold">One setup step is needed first</h2>
      <p className="mt-1.5 max-w-[60ch] text-[14px] text-ink-soft">
        This page stores its data in new tables that do not exist yet. Run the file <code className="break-all rounded-sm bg-paper px-1.5 py-0.5 font-mono text-[13px] text-ink">migrations/{file}</code> once
        in the Supabase SQL editor. It only adds tables and columns; nothing existing changes. Reload this page afterwards.
      </p>
    </div>
  )
}

export function WeekdayChecks({ name = 'offDays', selected = [] as number[], labelledBy }: { name?: string; selected?: number[]; labelledBy?: string }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={labelledBy}>
      {days.map((d, i) => (
        <label key={d} className="cursor-pointer">
          <input type="checkbox" name={name} value={i} aria-label={['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]} defaultChecked={selected.includes(i)} className="peer sr-only" />
          <span className="inline-flex h-9 min-w-[44px] items-center justify-center rounded border border-line-strong bg-raised px-2 text-[13px] text-ink-soft transition-colors hover:border-ink-faint peer-checked:border-brand peer-checked:bg-brand-wash peer-checked:font-medium peer-checked:text-brand-deep peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">{d}</span>
        </label>
      ))}
    </div>
  )
}
