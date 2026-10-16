import { NextResponse } from 'next/server'
import { denyUnless } from '@/lib/api-access'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const imp = require('@/lib/import')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toXlsx } = require('@/lib/excel')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { kind: string } }) {
  const def = imp.KINDS[params.kind]
  if (!def) return NextResponse.json({ error: 'Unknown import.' }, { status: 404 })
  // The template carries saved data (salaries included), so it needs the same permissions as importing it.
  const denied = (await denyUnless(req, 'import.run')) || (await denyUnless(req, def.perm))
  if (denied) return denied
  try {
    const { filename, sheets } = await imp.template(params.kind, { blank: new URL(req.url).searchParams.get('blank') === '1' })
    return new NextResponse(toXlsx(sheets), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
