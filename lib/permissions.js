// The permissions an account can be given, and which permission each page and
// action needs. Plain CommonJS with no dependencies, so the server, the sidebar
// and the tests all read the same list.
//
// Administrators (accounts whose role is 'admin') have every permission and can
// manage accounts and roles. Every other account gets exactly the permissions of
// its role. Anything not listed in ROUTE_VIEW / ROUTE_EDIT below needs an
// administrator: a new page or action is private until someone grants access.

const PERMISSIONS = [
  { key: 'attendance.view', group: 'Attendance', label: 'See live scans, reports, the roster and devices' },
  { key: 'attendance.edit', group: 'Attendance', label: 'Correct days on the roster' },
  { key: 'staff.view', group: 'Staff', label: 'See staff records and rotation' },
  { key: 'staff.edit', group: 'Staff', label: 'Add and edit staff, and assign rotation' },
  { key: 'leave.view', group: 'Leave', label: 'See leave requests' },
  { key: 'leave.edit', group: 'Leave', label: 'Record leave' },
  { key: 'leave.approve', group: 'Leave', label: 'Approve, reject and cancel leave' },
  { key: 'setup.view', group: 'Setup', label: 'See shifts, departments, holidays, leave types and entitlements' },
  { key: 'setup.edit', group: 'Setup', label: 'Change shifts, departments, holidays, leave types and entitlements' },
  { key: 'payroll.view', group: 'Payroll', label: 'See payroll, payslips, pay setup and payroll settings' },
  { key: 'payroll.edit', group: 'Payroll', label: 'Edit pay setup, overtime, monthly items and settings, and generate payroll' },
  { key: 'payroll.finalize', group: 'Payroll', label: 'Finalize a payroll month (locks it)' },
  { key: 'audit.view', group: 'Administration', label: 'See the audit log' },
  { key: 'import.run', group: 'Administration', label: 'Import staff, pay and other data from spreadsheets' },
]
const KEYS = PERMISSIONS.map(p => p.key)
const ADMIN_ONLY = 'users.manage'          // accounts and roles: administrators only, never assignable

// Having the second means having the first, so a role can never be able to edit what it cannot see.
const IMPLIES = {
  'attendance.edit': ['attendance.view'],
  'staff.edit': ['staff.view'],
  'leave.edit': ['leave.view'],
  'leave.approve': ['leave.view'],
  'setup.edit': ['setup.view'],
  'payroll.edit': ['payroll.view'],
  'payroll.finalize': ['payroll.edit', 'payroll.view'],
}

function expand(perms) {
  const out = new Set(perms.filter(p => KEYS.includes(p)))
  for (const p of [...out]) for (const q of IMPLIES[p] || []) out.add(q)
  return out
}

// Before roles exist (migration 004 not run) a non-administrator keeps read-only access.
const LEGACY_FALLBACK = ['attendance.view', 'staff.view', 'leave.view', 'setup.view']

// Page -> permission needed to open it. Longest matching prefix wins.
const ROUTE_VIEW = [
  ['/', 'attendance.view'], ['/reports', 'attendance.view'], ['/roster', 'attendance.view'], ['/roster/day', 'attendance.edit'], ['/devices', 'attendance.view'],
  ['/staff', 'staff.view'], ['/staff/new', 'staff.edit'], ['/rotation', 'staff.view'],
  ['/leave', 'leave.view'], ['/leave/new', 'leave.edit'],
  ['/holidays', 'setup.view'], ['/settings/shifts', 'setup.view'], ['/settings/departments', 'setup.view'], ['/settings/leave-types', 'setup.view'], ['/settings/entitlements', 'setup.view'],
  ['/payroll', 'payroll.view'], ['/settings/payroll', 'payroll.view'],
  ['/settings/audit', 'audit.view'], ['/import', 'import.run'],
  ['/settings/users', ADMIN_ONLY], ['/settings/roles', ADMIN_ONLY],
]

// Where a form lives -> permission its actions need by default. An action can name its own.
const ROUTE_EDIT = [
  ['/roster', 'attendance.edit'],
  ['/staff', 'staff.edit'], ['/rotation', 'staff.edit'],
  ['/leave/new', 'leave.edit'], ['/leave', 'leave.approve'],
  ['/holidays', 'setup.edit'], ['/settings/shifts', 'setup.edit'], ['/settings/departments', 'setup.edit'], ['/settings/leave-types', 'setup.edit'], ['/settings/entitlements', 'setup.edit'],
  ['/payroll', 'payroll.edit'], ['/settings/payroll', 'payroll.edit'],
  ['/import', 'import.run'],
  ['/settings/users', ADMIN_ONLY], ['/settings/roles', ADMIN_ONLY],
]

const pathOnly = (p) => String(p || '/').split('?')[0].split('#')[0] || '/'
function match(table, path) {
  const p = pathOnly(path)
  let best = null
  for (const [prefix, perm] of table) {
    const hit = prefix === '/' ? p === '/' : (p === prefix || p.startsWith(prefix + '/'))
    if (hit && (!best || prefix.length > best[0].length)) best = [prefix, perm]
  }
  return best ? best[1] : ADMIN_ONLY      // unknown = administrators only
}
const viewPermFor = (path) => match(ROUTE_VIEW, path)
const editPermFor = (path) => match(ROUTE_EDIT, path)

// Starting points offered on the Roles page. Created only when someone clicks one, then editable.
const ROLE_TEMPLATES = [
  { name: 'Viewer', description: 'Can look at attendance, staff, leave and setup. Cannot change anything.', perms: ['attendance.view', 'staff.view', 'leave.view', 'setup.view'] },
  { name: 'HR clerk', description: 'Day-to-day HR work: corrections, staff, leave and imports. No payroll.', perms: ['attendance.edit', 'staff.edit', 'leave.edit', 'setup.view', 'import.run'] },
  { name: 'HR manager', description: 'Everything in HR, including approving leave, setup and the audit log. No payroll.', perms: ['attendance.edit', 'staff.edit', 'leave.edit', 'leave.approve', 'setup.edit', 'import.run', 'audit.view'] },
  { name: 'Payroll officer', description: 'Prepares payroll but cannot finalize it.', perms: ['attendance.view', 'staff.view', 'payroll.edit'] },
  { name: 'Payroll approver', description: 'Prepares and finalizes payroll.', perms: ['attendance.view', 'staff.view', 'payroll.finalize'] },
]

module.exports = { PERMISSIONS, KEYS, ADMIN_ONLY, IMPLIES, expand, LEGACY_FALLBACK, ROUTE_VIEW, ROUTE_EDIT, viewPermFor, editPermFor, ROLE_TEMPLATES }
