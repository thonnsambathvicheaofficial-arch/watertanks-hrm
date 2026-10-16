import { NextResponse } from 'next/server'
import { denyUnless } from '@/lib/api-access'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const audit = require('@/lib/audit')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toXlsx } = require('@/lib/excel')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

export async function GET(req: Request) {
  const denied = await denyUnless(req, 'audit.view')
  if (denied) return denied
  const q = Object.fromEntries(new URL(req.url).searchParams)
  if (!(await audit.ready())) return NextResponse.json({ error: 'The audit log is not set up yet. Run migration 004_roles_audit.sql.' }, { status: 409 })
  try {
    const rows: { at: string; actor: string | null; action: string; summary: string; details: unknown }[] = await audit.listAll(q)
    const buffer = toXlsx([{
      name: 'Audit log',
      header: ['When (Phnom Penh)', 'Who', 'Action', 'What happened', 'Details'],
      rows: rows.map(r => [when.format(new Date(r.at)).replace(',', ''), r.actor || 'System', r.action, r.summary, r.details ? JSON.stringify(r.details) : '']),
      cols: [20, 16, 18, 70, 60],
    }])
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Audit_log_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
