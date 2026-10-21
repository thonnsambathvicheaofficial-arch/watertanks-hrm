'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const imp = require('@/lib/import')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const audit = require('@/lib/audit')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UserError } = require('@/lib/hr-store')
// Installs the audit-log entries on every store function the import writes through.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('@/lib/audit-hooks')

export interface PlanRow { line: number; label: string; status: 'new' | 'changed' | 'same' | 'error'; message?: string; changes?: { field: string; from: unknown; to: unknown }[] }
export interface Preview { kind: string; filename: string; ignored: string[]; notices: string[]; rows: Record<string, string | number>[]; plan: PlanRow[]; counts: { new: number; changed: number; same: number; error: number } }
export interface ChunkResult { added: number; changed: number; same: number; skipped: number; failed: { line: number; label: string; message: string }[] }

// Importing needs the general import permission AND the permission to change that kind of data.
async function authorize(kind: string): Promise<string> {
  const s = await verifySession(cookies().get(SESSION_COOKIE)?.value)
  const a = s && (await users.access(s.username))
  if (!a) throw new UserError('Your session has ended. Sign in again.')
  const def = imp.KINDS[kind]
  if (!def) throw new UserError('Choose what you are importing.')
  if (!a.perms.includes('import.run') || !a.perms.includes(def.perm)) {
    await audit.record({ actor: s!.username, action: 'permission.denied', entity: 'import', summary: `Tried to import ${def.label.toLowerCase()} without permission` })
    throw new UserError('You do not have permission to import this.')
  }
  return s!.username
}

const message = (e: unknown) => {
  if (e instanceof UserError) return (e as Error).message
  console.error('[import]', (e as Error).message)
  return 'Something went wrong reading that file. Nothing was changed.'
}

export async function previewImport(f: FormData): Promise<Preview | { error: string }> {
  try {
    const kind = String(f.get('kind') || '')
    await authorize(kind)
    const file = f.get('file')
    if (!(file instanceof File) || file.size === 0) throw new UserError('Choose an Excel file to import.')
    const { rows, ignored } = await imp.parse(kind, Buffer.from(await file.arrayBuffer()))
    const raw = await imp.plan(kind, rows)
    const plan = raw.map(({ data: _d, ...p }: { data?: unknown }) => p)
    return { kind, filename: file.name, ignored, notices: raw.notices || [], rows, plan, counts: imp.count(plan) }
  } catch (e) { return { error: message(e) } }
}

// One batch. The browser sends a file's rows in small batches so no single request runs long.
export async function applyChunk(kind: string, rows: Record<string, string | number>[]): Promise<ChunkResult | { error: string }> {
  try {
    const actor = await authorize(kind)
    const r: ChunkResult = await audit.runWith({ actor, recorded: false }, () => imp.apply(kind, rows, actor))
    revalidatePath('/', 'layout')
    return r
  } catch (e) { return { error: message(e) } }
}

export async function finishImport(kind: string, filename: string, t: { added: number; changed: number; same: number; skipped: number; failed: { line: number; label: string; message: string }[] }): Promise<void> {
  const actor = await authorize(kind)
  const label = imp.KINDS[kind].label.toLowerCase()
  const parts = [t.added && `${t.added} added`, t.changed && `${t.changed} changed`, t.same && `${t.same} unchanged`, t.skipped && `${t.skipped} skipped for errors`, t.failed.length && `${t.failed.length} failed`].filter(Boolean)
  await audit.record({ actor, action: 'import.run', entity: 'import', key: kind, summary: `Imported ${label} from ${String(filename).slice(0, 120)}: ${parts.join(', ') || 'nothing to change'}`, details: { added: t.added, changed: t.changed, unchanged: t.same, skipped: t.skipped, failed: t.failed.slice(0, 50) } })
}
