import type { Metadata } from 'next'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Button, Field, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import { guard } from '@/lib/guard'
import { createAccount, deleteAccount, saveAccount, setAccountEnabled } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')

export const metadata: Metadata = { title: 'Accounts' }
export const dynamic = 'force-dynamic'

type Acc = { username: string; isAdmin: boolean; roleId: string; roleName: string; disabled: boolean }
type Role = { id: string; name: string; perms: string[] }

export default async function AccountsPage({ searchParams }: { searchParams: { error?: string; saved?: string } }) {
  const me = await guard()
  if (!(await users.rolesReady())) return <><PageHeader title="Accounts" /><MigrationNotice file="004_roles_audit.sql" /></>
  const [accounts, roles]: [Acc[], Role[]] = await Promise.all([users.accounts.list(), users.roles.list()])
  const admins = accounts.filter(a => a.isAdmin && !a.disabled).length
  const options = (
    <>
      <option value="admin">Administrator (full access)</option>
      {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      {roles.length === 0 && <option value="" disabled>No roles yet (create them on the Roles page)</option>}
    </>
  )

  return (
    <>
      <PageHeader title="Accounts" note={`${accounts.length} login account${accounts.length === 1 ? '' : 's'}. Administrators can do everything and manage accounts and roles. Every other account can do what its role allows.`} />
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <div className="mb-8 overflow-x-auto rounded-md border border-line bg-raised">
        <div className="lg:min-w-[860px]">
          <div className="hidden lg:grid-cols-[minmax(160px,1.1fr)_minmax(200px,1.2fr)_minmax(160px,1fr)_92px_88px_88px] items-center gap-3 border-b border-line bg-paper lg:grid px-3 py-2.5 text-[12px] font-medium text-ink-soft">
            <span>Username</span><span>Access</span><span>New password</span><span>Status</span><span /><span />
          </div>
          {accounts.map(a => {
            const self = a.username === me.username
            const formId = `acc-${a.username}`
            return (
              <div key={a.username} className={cn('grid gap-3 border-b border-line px-3 py-3 last:border-b-0 lg:grid-cols-[minmax(160px,1.1fr)_minmax(200px,1.2fr)_minmax(160px,1fr)_92px_88px_88px] lg:items-center lg:py-2.5', a.disabled && 'bg-paper')}>
                <form id={formId} action={saveAccount} className="hidden"><input type="hidden" name="username" value={a.username} /></form>
                <div className="min-w-0">
                  <span className="block truncate font-medium" title={a.username}>{a.username}</span>
                  {self && <span className="text-[12px] text-ink-soft">You</span>}
                </div>
                <div><span className="mb-1 block text-[12px] text-ink-soft lg:hidden">Access</span><Select form={formId} name="access" defaultValue={a.isAdmin ? 'admin' : a.roleId || 'none'} aria-label={`Access for ${a.username}`} disabled={self && a.isAdmin}>
                  {!a.isAdmin && !a.roleId && <option value="none">No role (no access)</option>}
                  {options}
                </Select></div>
                <div><span className="mb-1 block text-[12px] text-ink-soft lg:hidden">New password</span><Input form={formId} name="password" type="password" autoComplete="new-password" placeholder="Leave empty to keep" aria-label={`New password for ${a.username}`} /></div>
                <div className="flex flex-wrap items-center gap-2 lg:contents">
                <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium', a.disabled ? 'text-absent' : 'text-present')}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{a.disabled ? 'Off' : 'Active'}</span>
                <Button form={formId} type="submit">Save</Button>
                <div className="flex gap-1.5">
                  {!self && (
                    <>
                      <form action={setAccountEnabled}><input type="hidden" name="username" value={a.username} /><input type="hidden" name="disabled" value={a.disabled ? '0' : '1'} /><Button type="submit" aria-label={a.disabled ? `Switch on ${a.username}` : `Switch off ${a.username}`}>{a.disabled ? 'On' : 'Off'}</Button></form>
                      <form action={deleteAccount}><input type="hidden" name="username" value={a.username} /><ConfirmButton variant="danger" message={`Delete the account "${a.username}"? They will not be able to sign in. This cannot be undone.`} aria-label={`Delete ${a.username}`}>Delete</ConfirmButton></form>
                    </>
                  )}
                </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {admins <= 1 && <p className="-mt-4 mb-6 text-[13px] text-ink-soft">There is only one active administrator. The system will not let that account be removed, switched off or demoted.</p>}

      <section aria-labelledby="add-h" className="max-w-[820px]">
        <h2 id="add-h" className="mb-3 text-[15px] font-semibold">Add an account</h2>
        <form action={createAccount} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto]">
          <Field label="Username"><Input name="username" autoComplete="off" required /></Field>
          <Field label="Password (8 or more characters)"><Input name="password" type="password" autoComplete="new-password" required /></Field>
          <Field label="Access"><Select name="access" defaultValue={roles[0]?.id || 'admin'}>{options}</Select></Field>
          <Button type="submit" variant="primary">Add account</Button>
        </form>
      </section>
    </>
  )
}
