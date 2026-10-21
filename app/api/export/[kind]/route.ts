import { NextResponse } from 'next/server'
import { denyUnless } from '@/lib/api-access'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildExport } = require('@/lib/exports')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { kind: string } }) {
  const denied = await denyUnless(req, 'attendance.view')
  if (denied) return denied
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { filename, buffer } = await buildExport(params.kind, query)
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
