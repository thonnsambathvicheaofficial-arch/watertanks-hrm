import { NextResponse } from 'next/server'
import { denyUnless } from '@/lib/api-access'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildExport } = require('@/lib/exports')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { kind: string } }) {
  const denied = await denyUnless(req, 'attendance.view')
  if (denied) return denied
  if (!['daily', 'summary', 'punches'].includes(params.kind)) return NextResponse.json({ error: 'Unknown export.' }, { status: 404 })
  const query = Object.fromEntries(new URL(req.url).searchParams)
  try {
    const { filename, buffer } = await buildExport(params.kind, query)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    console.error('[export]', params.kind, (e as Error).message)
    return NextResponse.json({ error: 'The export could not be built. Try a shorter date range.' }, { status: 500 })
  }
}
