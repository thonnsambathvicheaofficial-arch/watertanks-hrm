import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

// "07:49" -> "7:49 AM". Takes HH:MM only; never a full datetime.
export function to12h(hhmm: string | null | undefined): string {
  if (!hhmm) return ''
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${ap}`
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const dayName = (ymd: string) => DAY_NAMES[new Date(ymd + 'T00:00:00').getDay()]

// 1234.5 -> "$1,234.50". Negative amounts keep the minus sign in front of the dollar sign.
export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return ''
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? '-' : ''}$${s}`
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
