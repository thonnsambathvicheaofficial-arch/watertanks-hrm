import { Button, Field, Input, Select, WeekdayChecks } from '@/components/ui'
import { to12h } from '@/lib/utils'

export type Profile = {
  pin: string; name: string; group: string; timeIn: string; timeOut: string; offDays: number[]; aliases: string[]
  departmentId: string; shiftId: string; position: string; phone: string; joiningDate: string; resignedDate: string
}
type Opt = { id: string; name: string }
type ShiftOpt = Opt & { start: string; end: string }

// Shared by "add staff" and "edit staff". The profile fields and shift picker only
// appear once the migration has been run (`ready`); before that it edits what the
// legacy staff page did.
export function StaffForm({ profile, fallback, shifts, departments, ready, action }: {
  profile: Profile | null; fallback?: Profile | null; shifts: ShiftOpt[]; departments: Opt[]; ready: boolean; action: (f: FormData) => Promise<void>
}) {
  const isNew = !profile
  // Values to show in the fields: the saved record, or what was typed before a rejected save.
  const f = fallback ?? profile
  return (
    <form action={action} className="max-w-[720px] space-y-8">
      <section className="space-y-5" aria-label="Identity">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="PIN" hint={isNew ? 'The ID the fingerprint reader uses. It cannot be changed later.' : undefined}>
            {isNew
              ? <Input name="pin" required inputMode="numeric" autoFocus defaultValue={fallback?.pin} />
              : <><Input value={profile!.pin} readOnly aria-readonly className="bg-paper text-ink-soft" /><input type="hidden" name="pin" value={profile!.pin} /></>}
          </Field>
          <Field label="Name"><Input name="name" defaultValue={f?.name} required /></Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Group">
            <Select name="group" defaultValue={f?.group || ''}>
              <option value="">Not set</option><option value="office">Office staff</option><option value="worker">Worker</option>
            </Select>
          </Field>
          {ready && (
            <Field label="Department">
              <Select name="departmentId" defaultValue={f?.departmentId || ''}>
                <option value="">None</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        {ready && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Position"><Input name="position" defaultValue={f?.position} /></Field>
            <Field label="Phone"><Input name="phone" defaultValue={f?.phone} inputMode="tel" /></Field>
            <Field label="Joining date"><Input type="date" name="joiningDate" defaultValue={f?.joiningDate} /></Field>
            <Field label="Resigned date" hint="Leave empty while they still work here."><Input type="date" name="resignedDate" defaultValue={f?.resignedDate} /></Field>
          </div>
        )}
      </section>

      <section className="space-y-5 border-t border-line pt-6" aria-label="Working pattern">
        <h2 className="text-[15px] font-semibold">Working pattern</h2>
        {ready && (
          <Field label="Shift" hint="The shift sets the hours. Choose none to enter this person's own hours below.">
            <Select name="shiftId" defaultValue={f?.shiftId || ''}>
              <option value="">Own hours (no shift)</option>
              {shifts.map(s => <option key={s.id} value={s.id}>{s.name} · {to12h(s.start)} to {to12h(s.end)}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Own start time" hint={ready ? 'Used only when no shift is chosen.' : 'Leave empty for the company default.'}><Input type="time" name="timeIn" defaultValue={f?.timeIn} /></Field>
          <Field label="Own end time"><Input type="time" name="timeOut" defaultValue={f?.timeOut} /></Field>
        </div>
        <div>
          <span id="off-days" className="mb-1.5 block text-[13px] font-medium">Weekly days off</span>
          <WeekdayChecks selected={f?.offDays ?? [0]} labelledBy="off-days" />
          <p className="mt-1 text-[12px] text-ink-soft">This person&apos;s own days off. A shift never changes them.</p>
        </div>
        <Field label="Also scans as" hint="Other fingerprint IDs that are the same person, separated by commas. Their scans count here.">
          <Input name="aliases" defaultValue={f?.aliases.join(', ')} inputMode="numeric" />
        </Field>
      </section>

      <div><Button type="submit" variant="primary">{isNew ? 'Add staff member' : 'Save changes'}</Button></div>
    </form>
  )
}
