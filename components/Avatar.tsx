import { cn } from '@/lib/utils'

// The first letter of up to two words of a name ("Sok Rumdoul" -> "SR"). Works for Khmer too: one character per word.
export function initials(name: string): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return words.map(w => Array.from(w)[0]?.toUpperCase() ?? '').join('') || '?'
}

// A staff member's photo, or their initials on a quiet tint when there is none (or the photo link has expired).
// Size is in pixels. The picture itself comes straight from Supabase Storage, never through this site's functions.
export function Avatar({ name, url, size = 36, className }: { name: string; url?: string; size?: number; className?: string }) {
  const box = { width: size, height: size }
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" style={box} className={cn('max-w-none shrink-0 rounded-full bg-paper object-cover', className)} />
    )
  }
  return (
    <span aria-hidden style={{ ...box, fontSize: Math.max(11, Math.round(size * 0.38)) }} className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full bg-brand-wash font-medium text-brand-deep', className)}>
      {initials(name)}
    </span>
  )
}
