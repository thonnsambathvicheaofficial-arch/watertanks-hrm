import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

// One table treatment for the whole app: hairline rules, quiet header, numerals aligned.
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('tw relative overflow-x-auto rounded-md border border-line bg-raised', className)}>{children}</div>
}

export function Th({ children, align = 'left', className }: { children?: ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    <th scope="col" className={cn('whitespace-nowrap border-b border-line bg-paper px-3 py-2.5 text-[12px] font-medium text-ink-soft', align === 'right' ? 'text-right' : 'text-left', className)}>
      {children}
    </th>
  )
}

export function Td({ children, align = 'left', className, colSpan }: { children?: ReactNode; align?: 'left' | 'right'; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn('border-b border-line px-3 py-2.5 align-top text-[14px] last-of-type:border-b-0', align === 'right' && 'num text-right', className)}>{children}</td>
}

export function Table({ children, wide = true }: { children: ReactNode; wide?: boolean }) {
  return (
    <table className={cn('w-full border-collapse [&_tbody_tr:hover]:bg-brand-wash/40', wide && 'min-w-[880px]')}>
      {children}
    </table>
  )
}
