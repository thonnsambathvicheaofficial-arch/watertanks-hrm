import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// Previous / next month with the month name between. Links are supplied by the page.
export function MonthNav({ label, prev, next }: { label: string; prev: string; next: string }) {
  const btn = 'touch-target inline-flex h-9 w-9 items-center justify-center rounded border border-line-strong bg-raised text-ink-soft transition-colors hover:bg-brand-wash'
  return (
    <div className="flex items-center gap-1">
      <Link href={prev} aria-label="Previous month" className={btn}><ChevronLeft size={18} /></Link>
      <span className="num min-w-[150px] px-2 text-center text-[15px] font-semibold">{label}</span>
      <Link href={next} aria-label="Next month" className={btn}><ChevronRight size={18} /></Link>
    </div>
  )
}
