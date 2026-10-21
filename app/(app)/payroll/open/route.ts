import { NextResponse } from 'next/server'

// "Open a month" form: /payroll/open?period=2026-10 -> /payroll/2026-10
export async function GET(req: Request) {
  const url = new URL(req.url)
  const period = url.searchParams.get('period') || ''
  const target = /^\d{4}-\d{2}$/.test(period) ? `/payroll/${period}` : '/payroll'
  return NextResponse.redirect(new URL(target, url))
}
