// A list page's own address, filters included, carried to the page opened from it so that "Back" and a save land on
// the same filtered list instead of the unfiltered one. Only an address on this site is ever accepted.

// The address if it is a safe same-site path ("/roster?month=2026-10&group=…"), otherwise ''.
export function safeReturn(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\') || /[\r\n]/.test(s) || s.length > 600) return ''
  return s
}

// href with the list it came from attached.
export function withReturn(href: string, ret: string): string {
  const r = safeReturn(ret)
  return r ? `${href}${href.includes('?') ? '&' : '?'}return=${encodeURIComponent(r)}` : href
}

// A save that lands back on the page the form was on keeps that page's filters (group, department, dates, search...),
// read from the address the form was sent from. A target that already has its own query is left exactly as given, and so is
// a target the form was not sent from. `referer` is the full address; `host` is this site's own host.
const FLASH = ['saved', 'error', 'v']
export function keepFilters(target: string, referer: string | null | undefined, host: string | null | undefined): string {
  if (target.includes('?') || !referer) return target
  try {
    const u = new URL(referer)
    if (host && u.host !== host) return target
    if (decodeURIComponent(u.pathname) !== decodeURIComponent(target)) return target
    const p = new URLSearchParams(u.search)
    FLASH.forEach(k => p.delete(k))
    const q = p.toString()
    return q ? `${target}?${q}` : target
  } catch { return target }
}
