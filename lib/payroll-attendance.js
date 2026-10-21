// Turns a month of attendance rows (from the engine) into the figures payroll needs.
// Pure: no database and no clock, so it can be tested with synthetic data.
const { ruleFor, planAt } = require('./attendance')

const r2 = n => Math.round(n * 100) / 100

// Counts for one person's rows. Days after `today` have not happened, so they are never absences.
function attendanceFigures(rows, today) {
  const f = { present: 0, absent: 0, unpaidLeave: 0, paidLeave: 0, lateDays: 0, lateMinutes: 0, manualLeave: 0 }
  for (const r of rows) {
    if (r.date > today) continue
    if (['present', 'late', 'excused'].includes(r.status)) f.present++
    if (r.status === 'absent') f.absent++
    if (r.status === 'late' && !r.overridden) { f.lateDays++; f.lateMinutes += r.minutesLate || 0 }
    if (r.status === 'leave') {
      if (r.leaveParts) for (const p of r.leaveParts) { if (p.paid === false) f.unpaidLeave += p.days; else f.paidLeave += p.days }
      else { f.manualLeave++; f.paidLeave += 1 }     // a hand-made "leave" correction has no type: treated as paid
    }
  }
  f.unpaidLeave = r2(f.unpaidLeave); f.paidLeave = r2(f.paidLeave)
  return f
}

// Rate tier for a date: a public holiday, else the person's own weekly day off, else a normal day.
const otTier = (date, offDays, holidays) =>
  holidays.has(date) ? 'holiday' : (offDays || []).includes(new Date(date + 'T00:00:00').getDay()) ? 'off' : 'normal'

// The days off in force for a person on a date (a rotation assignment can change them).
function offDaysOn(emp, date) {
  const a = planAt(emp, date)
  return (a && a.offDays && a.offDays.length ? a.offDays : emp.offDays) || []
}

/**
 * Overtime SUGGESTIONS from scans. HR approves every one before it is paid.
 *  - holiday or the person's day off: every hour worked is overtime.
 *  - a normal day: the time worked past the shift's scheduled end, if at least
 *    `thresholdMin` minutes and no more than 8 hours (more than that is a missed scan).
 * rows: engine rows; emps: employees map (with plans); sched: company default settings.
 */
function suggestOvertime({ rows, emps, holidays, sched, thresholdMin = 0, taken = new Set() }) {
  const out = []
  for (const r of rows) {
    if (!['present', 'late', 'excused'].includes(r.status) || !r.in || !r.out || !(r.hours > 0)) continue
    if (taken.has(r.pin + '|' + r.date)) continue
    const e = emps[r.pin]; if (!e) continue
    let hours = 0
    if (holidays.has(r.date) || offDaysOn(e, r.date).includes(new Date(r.date + 'T00:00:00').getDay())) hours = r.hours
    else {
      const rule = ruleFor(r.pin, emps, sched, r.date)
      if (!rule.end || !rule.start) continue
      const endAt = new Date(`${r.date}T${rule.end}:00`)
      if (rule.end < rule.start) endAt.setDate(endAt.getDate() + 1)           // an overnight shift ends the next morning
      const outAt = new Date(`${r.date}T${r.out}:00`); outAt.setDate(outAt.getDate() + (r.outDayOffset || 0))
      const mins = Math.round((outAt - endAt) / 60000)
      if (mins <= 0 || mins < thresholdMin || mins > 8 * 60) continue
      hours = mins / 60
    }
    hours = r2(hours)
    if (hours > 0) out.push({ pin: r.pin, date: r.date, hours: Math.min(24, hours) })
  }
  return out
}

module.exports = { attendanceFigures, otTier, offDaysOn, suggestOvertime }
