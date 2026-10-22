import { cn } from '@/lib/utils'

// Small shared pieces of the discipline screens, so the register, the record and the staff page word things the same way.

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-late-wash text-late' },
  confirmed: { label: 'Confirmed', cls: 'bg-present-wash text-present' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-dayoff-wash text-dayoff' },
}

// Status is a word plus a dot, never colour alone.
export function DisciplineStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: 'bg-dayoff-wash text-dayoff' }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[12px] font-medium', s.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {s.label}
    </span>
  )
}

// A multi-line text box that looks like the app's other fields.
export function TextArea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...p}
      className={cn('min-h-[96px] w-full rounded border border-line-strong bg-raised px-3 py-2 text-[14px] text-ink transition-colors hover:border-ink-faint focus-visible:border-brand', className)}
    />
  )
}
