// When a form is rejected, the values the person typed travel back in the URL so
// the form comes back filled in. Used only for plain form fields (never secrets).
export type Echo = Record<string, string | string[]>

export function encodeEcho(f: FormData): string {
  const o: Echo = {}
  for (const k of new Set(Array.from(f.keys()))) {
    if (k.startsWith('$ACTION')) continue
    const v = f.getAll(k).map(String)
    o[k] = v.length > 1 ? v : v[0]
  }
  return Buffer.from(JSON.stringify(o)).toString('base64url')
}

export function decodeEcho(v?: string): Echo | null {
  if (!v) return null
  try { return JSON.parse(Buffer.from(v, 'base64url').toString()) } catch { return null }
}

export const echoOne = (e: Echo | null, k: string): string | undefined => {
  const x = e?.[k]
  return Array.isArray(x) ? x[0] : x
}
export const echoAll = (e: Echo | null, k: string): string[] => {
  const x = e?.[k]
  return x == null ? [] : Array.isArray(x) ? x : [x]
}
