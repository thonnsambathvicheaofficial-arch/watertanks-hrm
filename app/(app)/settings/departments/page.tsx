import type { Metadata } from 'next'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Button, EmptyState, Flash, Input, MigrationNotice, PageHeader } from '@/components/ui'
import { createDepartment, deleteDepartment, renameDepartment } from './actions'
import { guard } from '@/lib/guard'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Departments' }
export const dynamic = 'force-dynamic'

type Dept = { id: string; name: string; staff: number }

export default async function DepartmentsPage({ searchParams }: { searchParams: { error?: string; saved?: string } }) {
  const me = await guard()
  const ready = await hr.available()
  const depts: Dept[] = ready ? await hr.departments.list() : []
  return (
    <>
      <PageHeader title="Departments" note="Group staff by where they work, for example Assembly, Welding, Packing or Office." />
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!me.perms.includes('setup.edit') && <ReadOnlyNotice />}
      {!ready ? <MigrationNotice /> : (
        <>
          <form key={`add-${depts.length}-${searchParams.saved ?? ''}`} action={createDepartment} className="mb-5 flex max-w-[460px] items-end gap-3">
            <label className="block flex-1">
              <span className="mb-1.5 block text-[13px] font-medium">New department</span>
              <Input name="name" placeholder="Department name" required />
            </label>
            <Button type="submit" variant="primary">Add</Button>
          </form>
          <TableWrap>
            <Table wide={false}>
              <thead><tr><Th>Name</Th><Th align="right">Staff</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {depts.length === 0 && <tr><td colSpan={3}><EmptyState title="No departments yet" /></td></tr>}
                {depts.map(d => (
                  <tr key={d.id}>
                    <Td>
                      <form action={renameDepartment} className="flex max-w-[360px] items-center gap-2">
                        <input type="hidden" name="id" value={d.id} />
                        <Input name="name" defaultValue={d.name} aria-label={`Rename ${d.name}`} required />
                        <Button type="submit">Rename</Button>
                      </form>
                    </Td>
                    <Td align="right">{d.staff || ''}</Td>
                    <Td className="text-right">
                      <form action={deleteDepartment}>
                        <input type="hidden" name="id" value={d.id} />
                        <ConfirmButton variant="danger" message={d.staff ? `Delete "${d.name}"? Its ${d.staff} staff will be left without a department.` : `Delete "${d.name}"?`}>Delete</ConfirmButton>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </>
      )}
    </>
  )
}
