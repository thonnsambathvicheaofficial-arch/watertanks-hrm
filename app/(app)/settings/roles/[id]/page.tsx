import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Button, Field, Flash, Input, MigrationNotice, PageHeader } from '@/components/ui'
import { decodeEcho, echoAll, echoOne } from '@/lib/echo'
import { guard } from '@/lib/guard'
import { deleteRole, saveRole } from '../actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const P = require('@/lib/permissions')

export const metadata: Metadata = { title: 'Role' }
export const dynamic = 'force-dynamic'

type Perm = { key: string; group: string; label: string }

export default async function RolePage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; saved?: string; v?: string } }) {
  await guard()
  if (!(await users.rolesReady())) return <><PageHeader title="Role" /><MigrationNotice file="004_roles_audit.sql" /></>
  const role = await users.roles.get(params.id)
  if (!role) notFound()
  const echo = decodeEcho(searchParams.v)
  const ticked = new Set<string>(echo ? echoAll(echo, 'perm') : role.perms)
  const groups: Record<string, Perm[]> = {}
  for (const p of P.PERMISSIONS as Perm[]) (groups[p.group] ||= []).push(p)

  return (
    <>
      <PageHeader title={role.name} note={`${role.accounts} account${role.accounts === 1 ? '' : 's'} use${role.accounts === 1 ? 's' : ''} this role.`}>
        <Link href="/settings/roles" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All roles</Link>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <form action={saveRole} className="max-w-[720px] space-y-8">
        <input type="hidden" name="id" value={role.id} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name"><Input name="name" defaultValue={echoOne(echo, 'name') ?? role.name} required /></Field>
          <Field label="What it is for"><Input name="description" defaultValue={echoOne(echo, 'description') ?? role.description} /></Field>
        </div>

        {Object.entries(groups).map(([group, perms]) => (
          <fieldset key={group}>
            <legend className="mb-2 text-[15px] font-semibold">{group}</legend>
            <ul className="space-y-1">
              {perms.map(p => (
                <li key={p.key}>
                  <label className="flex cursor-pointer items-start gap-3 rounded px-2 py-1.5 text-[14px] hover:bg-brand-wash">
                    <input type="checkbox" name="perm" value={p.key} defaultChecked={ticked.has(p.key)} className="mt-1 h-4 w-4 accent-[oklch(0.46_0.15_258)]" />
                    <span>{p.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
        <p className="max-w-[60ch] text-[13px] text-ink-soft">Permissions that change things include the matching ability to see them: allowing edits to staff also allows seeing staff, and finalizing payroll also allows editing and seeing it. Managing accounts and roles is for administrators only and cannot be given to a role.</p>
        <Button type="submit" variant="primary">Save role</Button>
      </form>

      <form action={deleteRole} className="mt-10 max-w-[720px] border-t border-line pt-5">
        <input type="hidden" name="id" value={role.id} />
        <p className="mb-3 text-[14px] text-ink-soft">{role.accounts === 0 ? 'No account uses this role, so deleting it changes nothing else.' : `Deleting a role leaves its ${role.accounts} account${role.accounts === 1 ? '' : 's'} with no role, so ${role.accounts === 1 ? 'it' : 'they'} will not be able to open anything until given another.`}</p>
        <ConfirmButton variant="danger" message={`Delete the role "${role.name}"? ${role.accounts} account${role.accounts === 1 ? '' : 's'} will lose access until given another role.`}>Delete role</ConfirmButton>
      </form>
    </>
  )
}
