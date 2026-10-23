import { NextResponse } from 'next/server'
import { denyUnless } from '@/lib/api-access'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { records } = require('@/lib/discipline-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const D = require('@/lib/discipline')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toXlsx } = require('@/lib/excel')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { todayStr } = require('@/lib/report-data')

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { realDate } = require('@/lib/validate')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The register as an Excel file in the factory's own layout (see lib/discipline.js REGISTER_HEADER), honouring the same
// filters as the page. Withdrawn records are included and marked, so the file matches what the page shows.
export async function GET(req: Request) {
  const denied = await denyUnless(req, 'discipline.view')
  if (denied) return denied
  const sp = new URL(req.url).searchParams
  const ymd = (k: string) => (realDate(sp.get(k)) ? sp.get(k)! : '')
  const kind = D.KINDS[sp.get('kind') || ''] ? sp.get('kind')! : ''
  const status = D.STATUSES[sp.get('status') || ''] ? sp.get('status')! : ''
  const rows = await records.list({ from: ymd('from'), to: ymd('to'), kind, status, departmentId: sp.get('department') || '', q: sp.get('q') || '' })
  const people = await records.people()
  const buffer = toXlsx([{ name: 'Discipline', header: D.REGISTER_HEADER, rows: D.registerRows(rows, people), cols: [5, 12, 24, 18, 16, 16, 14, 40, 50, 12] }])
  const filename = `Discipline_${ymd('from') || 'all'}_to_${ymd('to') || todayStr()}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
