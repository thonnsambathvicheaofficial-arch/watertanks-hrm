import { Select } from '@/components/ui'

// The two staff filters used on Live, Reports, Roster, Staff, Leave and Rotation, so every screen words them the
// same way and sends the same query names (`group`, `department`). Plain selects inside the page's GET form.
export type Dept = { id: string; name: string }

export function GroupSelect({ value, allLabel = 'All groups', className }: { value: string; allLabel?: string; className?: string }) {
  return (
    <Select name="group" defaultValue={value} aria-label="Group" className={className}>
      <option value="">{allLabel}</option>
      <option value="office">Office staff</option>
      <option value="worker">Workers</option>
    </Select>
  )
}

// "none" picks the staff who have no department yet, so nobody can fall out of every department filter unseen.
// (The matching rule itself lives in lib/staff-filter.js, shared with the report engine.)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NO_DEPARTMENT, matchesDepartment } = require('@/lib/staff-filter') as { NO_DEPARTMENT: string; matchesDepartment: (want: string, have: string | null | undefined) => boolean }

// Nothing to choose until departments exist, so it renders nothing then (the migration may not be run yet).
export function DepartmentSelect({ value, departments, className }: { value: string; departments: Dept[]; className?: string }) {
  if (!departments.length) return null
  return (
    <Select name="department" defaultValue={value} aria-label="Department" className={className}>
      <option value="">All departments</option>
      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      <option value={NO_DEPARTMENT}>No department</option>
    </Select>
  )
}

// Reads the query values safely: anything unknown means "no filter".
export const cleanGroup = (v?: string) => (v === 'office' || v === 'worker' ? v : '')
export const cleanDepartment = (v: string | undefined, departments: Dept[]) => (v === NO_DEPARTMENT || departments.some(d => d.id === v) ? v! : '')
// Does a person whose department is `have` pass the department filter `want`?
export const inDepartment = matchesDepartment

// "Office staff · Workshop" for headings and notes; empty when nothing is filtered.
export function filterNote(group: string, department: string, departments: Dept[]): string {
  const parts: string[] = []
  if (group === 'office') parts.push('Office staff')
  else if (group === 'worker') parts.push('Workers')
  if (department === NO_DEPARTMENT) parts.push('No department')
  else { const d = departments.find(x => x.id === department); if (d) parts.push(d.name) }
  return parts.join(' · ')
}
