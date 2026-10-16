import type { Metadata } from 'next'
import { AutoRefresh } from '@/components/AutoRefresh'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { EmptyState, PageHeader } from '@/components/ui'
import { dayName, to12h } from '@/lib/utils'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { reportData, todayStr } = require('@/lib/report-data')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { glabel } = require('@/lib/exports')

export const metadata: Metadata = { title: 'Live' }
export const dynamic = 'force-dynamic'

type Daily = { pin: string; name: string; group: string | null; status: string; in: string | null }
type Punch = { id: string; pin: string; time: string; deviceId: string }

export default async function LivePage() {
  const today = todayStr()
  const [{ daily, punches, employees }, devices] = await Promise.all([reportData({ from: today, to: today }), store.devices.list()])
  const deviceName: Record<string, string> = Object.fromEntries(devices.map((d: { id: string; name: string }) => [d.id, d.name]))

  const rows = daily as Daily[]
  const expected = rows.filter(r => ['present', 'late', 'absent'].includes(r.status))
  const scanned = expected.filter(r => r.status !== 'absent')
  const late = rows.filter(r => r.status === 'late').length
  const notIn = expected.filter(r => r.status === 'absent')
  const recent = [...(punches as Punch[])].sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, 40)

  const note = `${dayName(today)}, ${today}. ${scanned.length} of ${expected.length} expected staff have scanned in${late ? `, ${late} late` : ''}.`

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader title="Live" note={note} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="scans-h">
          <h2 id="scans-h" className="mb-2 text-[15px] font-semibold">Latest scans</h2>
          <TableWrap>
            <Table wide={false}>
              <thead><tr><Th>Time</Th><Th>Name</Th><Th className="hidden sm:table-cell">PIN</Th><Th className="hidden md:table-cell">Group</Th><Th>Device</Th></tr></thead>
              <tbody>
                {recent.length === 0 && <tr><td colSpan={5}><EmptyState title="No scans yet today">Scans appear here within five minutes of a staff member using a reader.</EmptyState></td></tr>}
                {recent.map(p => (
                  <tr key={p.id}>
                    <Td className="num whitespace-nowrap font-medium">{to12h(p.time.slice(11, 16))}</Td>
                    <Td>{employees[p.pin]?.name || <span className="text-ink-faint">Not in staff list</span>}</Td>
                    <Td className="num hidden text-ink-soft sm:table-cell">{p.pin}</Td>
                    <Td className="hidden text-ink-soft md:table-cell">{glabel(employees[p.pin]?.group) || ''}</Td>
                    <Td className="text-ink-soft">{deviceName[p.deviceId] || ''}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </section>

        <section aria-labelledby="notin-h">
          <h2 id="notin-h" className="mb-2 text-[15px] font-semibold">Not scanned yet <span className="num font-normal text-ink-soft">({notIn.length})</span></h2>
          <TableWrap>
            <table className="w-full border-collapse">
              <tbody>
                {notIn.length === 0 && <tr><td><EmptyState title="Everyone expected has scanned" /></td></tr>}
                {notIn.map(r => (
                  <tr key={r.pin} className="[&:last-child_td]:border-b-0">
                    <Td>{r.name || r.pin}</Td>
                    <Td align="right" className="text-ink-soft">{r.pin}</Td>
                    <Td className="num whitespace-nowrap text-ink-soft">from {to12h(employees[r.pin]?.timeIn)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
      </div>
    </>
  )
}
