// Excel export builders. Column layouts and labels are copied unchanged from the
// legacy server so a report exported from the revamp is identical to today's.
const store = require('./store')
const { reportData } = require('./report-data')
const { toXlsx } = require('./excel')
const { to12h, dayName } = require('./time')

const GROUP_LABEL = { office: 'Office Staff', worker: 'Worker' }
const glabel = g => GROUP_LABEL[g] || ''
const STATUS_LABEL = { present: 'Present', late: 'Late', absent: 'Absent', day_off: 'Day Off', leave: 'Leave', excused: 'Excused', holiday: 'Holiday' }
const slabel = s => STATUS_LABEL[s] || s || ''
const isLate = r => (r.status === 'late' || r.minutesLate > 0) ? 'LATE' : ''

// File-name tail naming what the export was narrowed to (_worker, _Delivery, _no-department), so a filtered file never
// overwrites or gets mistaken for the full one in the Downloads folder.
async function scopeSuffix(query) {
  let out = query.group ? '_' + query.group : ''
  const d = query.department || query.departmentId
  if (d === 'none') out += '_no-department'
  else if (d) {
    try { const hit = (await require('./hr-store').departments.list()).find(x => x.id === d); if (hit) out += '_' + hit.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') } catch { /* name is only decoration */ }
  }
  return out
}

async function buildExport(kind, query = {}) {
  const { daily, summary, punches } = await reportData(query)
  const emps = await store.employees.get()
  const stamp = new Date().toISOString().slice(0, 10)
  const suffix = await scopeSuffix(query)
  let sheet
  if (kind === 'summary') {
    const tl = require('./timesheet-leave')
    const leaveByPin = tl.leaveLines(daily)    // the leave dates and reasons behind the Leave count
    const rosterByPin = tl.rosterLines(daily)  // HR's day notes (corrections) behind the totals
    sheet = { name: 'Summary', header: ['PIN', 'Name', 'Group', 'Days', 'Total Hours', 'Late Days', 'Total Min Late', 'Early Leave Days', 'Absent', 'Day Off', 'Leave', 'Excused', 'Leave details', 'Roster notes'],
      rows: summary.map(r => [r.pin, r.name, glabel(r.group), r.days, r.hours, r.late, r.minLate || 0, r.early, r.absent, r.dayOff, r.leave, r.excused, leaveByPin.get(r.pin) || '', rosterByPin.get(r.pin) || '']),
      cols: [12, 24, 12, 8, 12, 10, 14, 14, 9, 10, 8, 10, 60, 60] }
  } else if (kind === 'punches') {
    sheet = { name: 'Punches', header: ['Date', 'Time', 'PIN', 'Name', 'Group', 'Source', 'Verify'],
      rows: [...punches].sort((a, b) => a.time < b.time ? -1 : 1).map(p => [p.time.slice(0, 10), to12h(p.time.slice(11, 19)), p.pin, (emps[p.pin] && emps[p.pin].name) || '', glabel(emps[p.pin] && emps[p.pin].group), p.source, p.verify]),
      cols: [12, 10, 12, 24, 12, 8, 8] }
  } else if (query.allPunches === '1') {
    const maxP = daily.reduce((m, r) => Math.max(m, (r.allPunches || []).length), 0)
    const punchHeaders = Array.from({ length: maxP }, (_, i) => `Punch ${i + 1}`)
    sheet = { name: 'Daily',
      header: ['Day', 'Date', 'PIN', 'Name', 'Group', 'Status', 'In', 'Out', ...punchHeaders, 'Hours', 'Punches', 'Late', 'Min Late', 'Early Leave', 'Roster note', 'Leave reason'],
      rows: daily.map(r => {
        const punchCells = Array.from({ length: maxP }, (_, i) => to12h((r.allPunches || [])[i] || ''))
        return [dayName(r.date), r.date, r.pin, r.name, glabel(r.group), slabel(r.status), to12h(r.in), to12h(r.out), ...punchCells, r.hours, r.punches, isLate(r), r.minutesLate ? r.minutesLate : '', r.earlyLeave ? 'EARLY' : '', r.rosterNote || '', r.leaveReason || '']
      }),
      cols: [11, 12, 12, 24, 12, 10, 8, 8, ...Array(maxP).fill(9), 8, 9, 7, 8, 11, 30, 40] }
  } else {
    sheet = { name: 'Daily', header: ['Day', 'Date', 'PIN', 'Name', 'Group', 'Status', 'In', 'Out', 'Hours', 'Punches', 'Late', 'Min Late', 'Early Leave', 'Roster note', 'Leave reason'],
      rows: daily.map(r => [dayName(r.date), r.date, r.pin, r.name, glabel(r.group), slabel(r.status), to12h(r.in), to12h(r.out), r.hours, r.punches, isLate(r), r.minutesLate ? r.minutesLate : '', r.earlyLeave ? 'EARLY' : '', r.rosterNote || '', r.leaveReason || '']),
      cols: [11, 12, 12, 24, 12, 10, 8, 8, 8, 9, 7, 8, 11, 30, 40] }
  }
  return { filename: `Attendance_${kind}${suffix}_${stamp}.xlsx`, buffer: toXlsx([sheet]) }
}

// Monthly timesheet: one row per staff, one column per day (hours), same layout as
// the legacy export, with Leave and Absent appended.
async function buildTimesheetExport(query = {}) {
  const { buildRoster } = require('./roster')
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : new Date().toISOString().slice(0, 7)
  const ts = await buildRoster({ month, group: query.group, departmentId: query.department })
  const { leaveDetails, rosterDetails, LEAVE_HEADER, ROSTER_HEADER } = require('./timesheet-leave')
  const leave = leaveDetails(ts, glabel)
  const notes = rosterDetails(ts, glabel, slabel)
  const header = ['No', 'PIN', 'Name', 'Group', ...ts.days.map(d => String(d.d)), 'Total Hours', 'Days', 'Late', 'Early Leave', 'Leave', 'Absent', 'Leave details', 'Roster notes']
  const rows = ts.rows.map((r, i) => [i + 1, r.pin, r.name, glabel(r.group), ...ts.days.map(d => (r.cells[d.d] && r.cells[d.d].hours ? r.cells[d.d].hours : '')), r.t.hours, r.t.days, r.t.late, r.t.early, r.t.leave || '', r.t.absent, leave.byPin.get(r.pin) || '', notes.byPin.get(r.pin) || ''])
  const cols = [5, 10, 22, 12, ...ts.days.map(() => 5), 11, 6, 6, 11, 7, 8, 60, 60]
  const suffix = await scopeSuffix(query)
  return { filename: 'Timesheet_' + month + suffix + '.xlsx', buffer: toXlsx([{ name: 'Timesheet', header, rows, cols }, { name: 'Leave days', header: LEAVE_HEADER, rows: leave.list, cols: [12, 11, 8, 22, 12, 7, 6, 70] }, { name: 'Roster notes', header: ROSTER_HEADER, rows: notes.list, cols: [12, 11, 8, 22, 12, 10, 70] }]) }
}

module.exports = { buildExport, buildTimesheetExport, glabel, slabel }
