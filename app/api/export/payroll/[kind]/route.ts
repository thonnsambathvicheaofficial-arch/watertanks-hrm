import { NextResponse } from 'next/server'
import { denyUnless } from '@/lib/api-access'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildPayrollExport } = require('@/lib/payroll-exports')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { kind: string } }) {
  const denied = await denyUnless(req, 'payroll.view')
  if (denied) return denied
  const q = new URL(req.url).searchParams
  const year = Number(q.get('year')), month = Number(q.get('month'))
  if (!(year >= 2000 && year <= 2100) || !(month >= 1 && month <= 12)) return NextResponse.json({ error: 'Choose a month.' }, { status: 400 })
  try {
    const { filename, buffer } = await buildPayrollExport(params.kind, year, month)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 })
  }
}
