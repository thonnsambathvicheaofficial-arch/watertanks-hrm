import { Button, Field, Input, Select, WeekdayChecks } from '@/components/ui'
import { to12h } from '@/lib/utils'

export type Profile = {
  pin: string; name: string; group: string; timeIn: string; timeOut: string; offDays: number[]; aliases: string[]
  departmentId: string; shiftId: string; position: string; phone: string; joiningDate: string; resignedDate: string
  // Fuller profile (migration 005). Empty strings when not recorded.
  staffCode: string; nameKh: string; gender: string; dateOfBirth: string; maritalStatus: string; idCardNo: string; nssfNo: string; address: string
  personalEmail: string; emergencyContact: string; emergencyPhone: string; employmentType: string; probationEnd: string; lineManager: string; resignReason: string
}
type Opt = { id: string; name: string }
type ShiftOpt = Opt & { start: string; end: string }
type Manager = { pin: string; name: string }

export const blankProfile = (over: Partial<Profile> = {}): Profile => ({
  pin: '', name: '', group: '', timeIn: '', timeOut: '', offDays: [], aliases: [], departmentId: '', shiftId: '', position: '', phone: '', joiningDate: '', resignedDate: '',
  staffCode: '', nameKh: '', gender: '', dateOfBirth: '', maritalStatus: '', idCardNo: '', nssfNo: '', address: '', personalEmail: '', emergencyContact: '', emergencyPhone: '',
  employmentType: '', probationEnd: '', lineManager: '', resignReason: '', ...over,
})

const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed']

// Shared by "add staff" and "edit staff". The department, shift and employment fields appear once
// migration 001 has been run (`ready`), and the fuller profile once migration 005 has (`ext`).
// Before that it edits what the legacy staff page did.
export function StaffForm({ profile, fallback, shifts, departments, managers = [], ready, ext = false, action }: {
  profile: Profile | null; fallback?: Profile | null; shifts: ShiftOpt[]; departments: Opt[]; managers?: Manager[]; ready: boolean; ext?: boolean; action: (f: FormData) => Promise<void>
}) {
  const isNew = !profile
  // Values to show in the fields: the saved record, or what was typed before a rejected save.
  const f = fallback ?? profile
  return (
    <form action={action} className="max-w-[760px] space-y-10">
      <section className="space-y-5" aria-labelledby="id-h">
        <h2 id="id-h" className="text-[15px] font-semibold">Identity</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="PIN" hint={isNew ? 'The ID the fingerprint reader uses. It cannot be changed here later.' : 'The fingerprint ID. Use Change PIN below to correct it.'}>
            {isNew
              ? <Input name="pin" required inputMode="numeric" autoFocus defaultValue={fallback?.pin} />
              : <><Input value={profile!.pin} readOnly aria-readonly className="bg-paper text-ink-soft" /><input type="hidden" name="pin" value={profile!.pin} /></>}
          </Field>
          <Field label="Name"><Input name="name" defaultValue={f?.name} required /></Field>
          {ext && <Field label="Name in Khmer"><Input name="nameKh" defaultValue={f?.nameKh} lang="km" /></Field>}
          {ext && <Field label="Staff ID" hint="The company's own ID, for example SF0006."><Input name="staffCode" defaultValue={f?.staffCode} autoComplete="off" /></Field>}
          {ext && (
            <Field label="Gender">
              <Select name="gender" defaultValue={f?.gender || ''}><option value="">Not set</option><option value="M">Male</option><option value="F">Female</option></Select>
            </Field>
          )}
          {ext && <Field label="Date of birth"><Input type="date" name="dateOfBirth" defaultValue={f?.dateOfBirth} /></Field>}
          {ext && (
            <Field label="Marital status">
              <Select name="maritalStatus" defaultValue={f?.maritalStatus || ''}>
                <option value="">Not set</option>
                {MARITAL.map(m => <option key={m} value={m}>{m}</option>)}
                {f?.maritalStatus && !MARITAL.includes(f.maritalStatus) && <option value={f.maritalStatus}>{f.maritalStatus}</option>}
              </Select>
            </Field>
          )}
          {ext && <Field label="ID card number"><Input name="idCardNo" defaultValue={f?.idCardNo} autoComplete="off" /></Field>}
          {ext && <Field label="NSSF number"><Input name="nssfNo" defaultValue={f?.nssfNo} autoComplete="off" /></Field>}
        </div>
        {ext && <Field label="Current address"><Input name="address" defaultValue={f?.address} lang="km" /></Field>}
      </section>

      <section className="space-y-5 border-t border-line pt-6" aria-labelledby="emp-h">
        <h2 id="emp-h" className="text-[15px] font-semibold">Employment</h2>
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
          {ready && <Field label="Position"><Input name="position" defaultValue={f?.position} lang="km" /></Field>}
          {ext && <Field label="Contract type" hint="Written the way HR uses it, for example Permanent or Fixed term."><Input name="employmentType" defaultValue={f?.employmentType} /></Field>}
          {ready && <Field label="Joining date"><Input type="date" name="joiningDate" defaultValue={f?.joiningDate} /></Field>}
          {ext && <Field label="Probation ends"><Input type="date" name="probationEnd" defaultValue={f?.probationEnd} /></Field>}
          {ext && (
            <Field label="Line manager">
              <Select name="lineManager" defaultValue={f?.lineManager || ''}>
                <option value="">None</option>
                {managers.filter(m => m.pin !== profile?.pin).map(m => <option key={m.pin} value={m.pin}>{m.name || 'Unnamed'} · {m.pin}</option>)}
              </Select>
            </Field>
          )}
          {ready && <Field label="Resigned date" hint="Leave empty while they still work here."><Input type="date" name="resignedDate" defaultValue={f?.resignedDate} /></Field>}
          {ext && <Field label="Reason for leaving"><Input name="resignReason" defaultValue={f?.resignReason} lang="km" /></Field>}
        </div>
      </section>

      {(ready || ext) && (
        <section className="space-y-5 border-t border-line pt-6" aria-labelledby="contact-h">
          <h2 id="contact-h" className="text-[15px] font-semibold">Contact</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {ready && <Field label="Phone"><Input name="phone" defaultValue={f?.phone} inputMode="tel" /></Field>}
            {ext && <Field label="Personal email"><Input type="email" name="personalEmail" defaultValue={f?.personalEmail} autoComplete="off" /></Field>}
            {ext && <Field label="Emergency contact"><Input name="emergencyContact" defaultValue={f?.emergencyContact} lang="km" /></Field>}
            {ext && <Field label="Emergency phone"><Input name="emergencyPhone" defaultValue={f?.emergencyPhone} inputMode="tel" /></Field>}
          </div>
        </section>
      )}

      <section className="space-y-5 border-t border-line pt-6" aria-labelledby="pattern-h">
        <h2 id="pattern-h" className="text-[15px] font-semibold">Working pattern</h2>
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
