import type { Metadata } from 'next'
import Link from 'next/link'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, MigrationNotice, PageHeader } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { guard } from '@/lib/guard'
import { createFromTemplate, createRole } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const P = require('@/lib/permissions')

export const metadata: Metadata = { title: 'Roles' }
export const dynamic = 'force-dynamic'

type Role = { id: string; name: string; description: string; perms: string[]; accounts: number }

export default async function RolesPage({ searchParams }: { searchParams: { error?: string; saved?: string; v?: string } }) {
  await guard()
  if (!(await users.rolesReady())) return <><PageHeader title="Roles" /><MigrationNotice file="004_roles_audit.sql" /></>
  const roles: Role[] = await users.roles.list()
  const have = new Set(roles.map(r => r.name.toLowerCase()))
  const templates: { name: string; description: string; perms: string[] }[] = P.ROLE_TEMPLATES.filter((t: { name: string }) => !have.has(t.name.toLowerCase()))
  const echo = decodeEcho(searchParams.v)

  return (
    <>
      <PageHeader title="Roles" note="A role is a set of things an account may do. Administrators do not need one. Give each other account a role on the Accounts page." />
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <TableWrap className="mb-8">
        <Table wide={false}>
          <thead><tr><Th>Role</Th><Th>What it is for</Th><Th align="right">Permissions</Th><Th align="right">Accounts</Th></tr></thead>
          <tbody>
            {roles.length === 0 && <tr><td colSpan={4}><EmptyState title="No roles yet">Start from a template below, or create an empty role and choose its permissions.</EmptyState></td></tr>}
            {roles.map(r => (
              <tr key={r.id}>
                <Td className="font-medium"><Link href={`/settings/roles/${r.id}`} className="text-brand-deep underline decoration-line-strong hover:decoration-brand">{r.name}</Link></Td>
                <Td className="max-w-[420px] text-ink-soft">{r.description}</Td>
                <Td align="right">{r.perms.length}</Td>
                <Td align="right">{r.accounts || ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {templates.length > 0 && (
        <section aria-labelledby="tpl-h" className="mb-8 max-w-[820px]">
          <h2 id="tpl-h" className="text-[15px] font-semibold">Start from a template</h2>
          <p className="mb-3 mt-1 max-w-[62ch] text-[14px] text-ink-soft">Each creates an ordinary role you can open and change. Nothing is applied to any account until you assign the role.</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {templates.map(t => (
              <li key={t.name} className="rounded-md border border-line bg-raised p-4">
                <p className="font-medium">{t.name}</p>
                <p className="mb-3 mt-1 text-[13px] text-ink-soft">{t.description}</p>
                <form action={createFromTemplate}><input type="hidden" name="template" value={t.name} /><Button type="submit">Create this role</Button></form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="new-h" className="max-w-[820px]">
        <h2 id="new-h" className="mb-3 text-[15px] font-semibold">Create an empty role</h2>
        <form action={createRole} className="grid items-end gap-3 sm:grid-cols-[1fr_1.6fr_auto]">
          <Field label="Name"><Input name="name" defaultValue={echoOne(echo, 'name')} required /></Field>
          <Field label="What it is for"><Input name="description" defaultValue={echoOne(echo, 'description')} placeholder="Optional" /></Field>
          <Button type="submit" variant="primary">Create role</Button>
        </form>
      </section>
    </>
  )
}
