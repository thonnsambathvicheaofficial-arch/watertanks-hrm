// Adds an audit-log entry to every store function that changes data, with the values
// before and after where they matter. Installed once (lib/act.ts requires this file),
// so every change made through an action is covered, and the stores themselves stay
// exactly as they were tested.
//
// An entry is written only AFTER the change succeeded. Bulk operations write one summary
// entry; the single changes inside them are not logged one by one (see `bulk`).
const audit = require('./audit')
const hr = require('./hr-store')
const lv = require('./leave-store')
const pr = require('./payroll-store')
const store = require('./store')
const { devices: dev } = require('./device-admin')
const notify = require('./notify')
const disc = require('./discipline-store')
const D = require('./discipline')

{

  // wrap(object, 'method', { before?: (...args) => data, entry: (args, result, before) => entry | null })
  // Each wrapped function is marked, so a second copy of this file (or a module loaded twice by
  // the bundler) never wraps the same function again and doubles an entry.
  const wrap = (obj, name, spec) => {
    const orig = obj[name]
    if (!orig || orig.__audited) return
    const wrapped = async function (...args) {
      const ctx = audit.context()
      if (ctx && ctx.inBulk && !spec.always) return orig.apply(this, args)
      const before = spec.before ? await spec.before(...args).catch(() => undefined) : undefined
      if (spec.bulk && ctx) ctx.inBulk = true
      let result
      try { result = await orig.apply(this, args) } finally { if (spec.bulk && ctx) ctx.inBulk = false }
      const after = spec.after ? await spec.after(...args).catch(() => undefined) : undefined
      let e = null
      try { e = await spec.entry(args, result, before, after) } catch { e = null }
      // An entry builder may return one entry, several, or nothing (when nothing really changed).
      for (const one of [].concat(e || [])) await audit.record(one)
      return result
    }
    wrapped.__audited = true
    obj[name] = wrapped
  }
  const dash = (v) => (v === null || v === undefined || v === '' ? 'none' : v)
  const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o ? o[k] : undefined]))
  const mask = (v) => (v ? '***' + String(v).slice(-3) : v)

  // ── departments, shifts, rotation, staff ──
  wrap(hr.departments, 'create', { entry: ([n]) => ({ action: 'department.create', entity: 'department', key: String(n).trim(), summary: `Added the department "${String(n).trim()}"` }) })
  wrap(hr.departments, 'rename', { before: async (id) => (await hr.departments.list()).find(d => d.id === id), entry: ([, n], _r, b) => ({ action: 'department.rename', entity: 'department', key: String(n).trim(), summary: `Renamed the department "${b ? b.name : '?'}" to "${String(n).trim()}"` }) })
  wrap(hr.departments, 'remove', { before: async (id) => (await hr.departments.list()).find(d => d.id === id), entry: ([], _r, b) => ({ action: 'department.delete', entity: 'department', key: b ? b.name : '', summary: `Deleted the department "${b ? b.name : '?'}"${b && b.staff ? `; ${b.staff} staff now have none` : ''}` }) })
  wrap(hr.shifts, 'create', { entry: ([i]) => ({ action: 'shift.create', entity: 'shift', key: String(i.name).trim(), summary: `Created the shift "${String(i.name).trim()}" (${i.start} to ${i.end})`, details: pick(i, ['start', 'end', 'graceMinutes', 'offDays']) }) })
  wrap(hr.shifts, 'update', { before: (id) => hr.shifts.get(id), entry: ([, i], _r, b) => ({ action: 'shift.update', entity: 'shift', key: String(i.name).trim(), summary: `Changed the shift "${String(i.name).trim()}"`, details: audit.diff(b ? { name: b.name, start: b.start, end: b.end, graceMinutes: b.graceMinutes, offDays: b.offDays } : {}, { name: String(i.name).trim(), start: i.start, end: i.end, graceMinutes: i.graceMinutes === '' || i.graceMinutes == null ? null : Number(i.graceMinutes), offDays: [...new Set((i.offDays || []).map(Number))].sort() }) }) })
  wrap(hr.shifts, 'remove', { before: (id) => hr.shifts.get(id), entry: (_a, _r, b) => ({ action: 'shift.delete', entity: 'shift', key: b ? b.name : '', summary: `Deleted the shift "${b ? b.name : '?'}"` }) })
  wrap(dev, 'add', { entry: ([i], id) => ({ action: 'device.add', entity: 'device', key: String(i.name).trim(), summary: `Added the device "${String(i.name).trim()}"`, details: { id } }) })
  wrap(dev, 'update', { entry: ([, i], r) => ({ action: 'device.update', entity: 'device', key: String(i.name).trim(), summary: `Changed the device "${String(i.name).trim()}"`, details: audit.diff(pick(r.before, ['name', 'type', 'ip', 'port', 'serial', 'publicHost', 'publicPort']), { name: r.row.name, type: r.row.type, ip: r.row.ip, port: r.row.port, serial: r.row.serial, publicHost: r.row.public_host, publicPort: r.row.public_port }) }) })
  wrap(dev, 'remove', { entry: (_a, d) => ({ action: 'device.delete', entity: 'device', key: d.name, summary: `Removed the device "${d.name}"` }) })
  wrap(dev, 'pull', { entry: ([, o], r) => ({ action: 'device.pull', entity: 'device', key: r.name, summary: r.ok ? `Read ${r.name} now${o && o.full ? ' (everything)' : ''}: ${r.pushed} new scan${r.pushed === 1 ? '' : 's'}` : `Tried to read ${r.name} now; it failed`, details: { ok: r.ok, pushed: r.pushed, totalOnDevice: r.totalOnDevice, error: r.error } }) })
  wrap(store.settings, 'set', { before: () => store.settings.get(), after: () => store.settings.get(), entry: ([p], _r, b, a) => ({ action: 'settings.workhours', entity: 'settings', key: 'work hours', summary: 'Changed the default work hours', details: audit.diff(pick(b, ['workStart', 'workEnd', 'graceMinutes']), pick(a, ['workStart', 'workEnd', 'graceMinutes'])) }) })
  wrap(notify, 'saveSettings', { entry: ([, by], r) => ({ action: 'notify.settings', entity: 'settings', key: 'telegram', summary: r.after.enabled ? (r.before.enabled ? 'Changed the Telegram notification settings' : 'Switched Telegram scan notifications on') : (r.before.enabled ? 'Switched Telegram scan notifications off' : 'Changed the Telegram notification settings (still off)'), details: audit.diff(pick(r.before, ['enabled', 'chat_id', 'scope_group', 'department_ids', 'ignore_repeat_seconds', 'max_age_minutes', 'digest_threshold', 'leave_digest_enabled', 'leave_digest_time']), pick(r.after, ['enabled', 'chat_id', 'scope_group', 'department_ids', 'ignore_repeat_seconds', 'max_age_minutes', 'digest_threshold', 'leave_digest_enabled', 'leave_digest_time'])) }) })
  wrap(notify, 'sendTest', { entry: ([chat], r) => ({ action: 'notify.test', entity: 'settings', key: 'telegram', summary: r.ok ? 'Sent a Telegram test message' : 'A Telegram test message failed', details: { ok: r.ok, bot: r.bot, group: r.chat, error: r.error } }) })
  wrap(hr.staff, 'rename', { entry: ([pin, newPin], r) => ({ action: 'staff.rename', entity: 'staff', key: String(newPin), summary: `Changed the PIN of ${r.name || pin} from ${pin} to ${newPin}; ${r.scans} scan${r.scans === 1 ? '' : 's'} moved`, details: { from: pin, to: newPin, scansMoved: r.scans } }) })
  wrap(hr.assignments, 'create', { before: async (a) => hr.shifts.get(a.shiftId), entry: ([a], _r, sh) => ({ action: 'rotation.assign', entity: 'staff', key: a.pin, summary: `Put ${a.pin} on ${sh ? sh.name : 'a shift'} from ${a.from}${a.to ? ' to ' + a.to : ' onward'}`, details: pick(a, ['from', 'to', 'note']) }) })
  wrap(hr.assignments, 'createMany', { bulk: true, before: async (a) => hr.shifts.get(a.shiftId), entry: ([a], r, sh) => ({ action: 'rotation.assign', entity: 'staff', key: `${r.created.length} people`, summary: `Put ${r.created.length} staff on ${sh ? sh.name : 'a shift'} from ${a.from}${a.to ? ' to ' + a.to : ' onward'}${r.conflicts.length ? `; ${r.conflicts.length} skipped` : ''}`, details: { pins: r.created, skipped: r.conflicts } }) })
  wrap(hr.assignments, 'remove', { entry: ([id]) => ({ action: 'rotation.remove', entity: 'staff', key: String(id), summary: 'Removed a rotation assignment' }) })
  wrap(hr.staff, 'save', {
    before: async (pin) => hr.staff.get(pin), after: async (pin) => hr.staff.get(pin),
    entry: ([pin, , opts], _r, b, a) => {
      const keys = ['name', 'group', 'departmentId', 'shiftId', 'position', 'phone', 'joiningDate', 'resignedDate', 'timeIn', 'timeOut', 'offDays', 'aliases', 'staffCode', 'nameKh', 'gender', 'dateOfBirth', 'maritalStatus', 'idCardNo', 'nssfNo', 'address', 'personalEmail', 'emergencyContact', 'emergencyPhone', 'employmentType', 'probationEnd', 'lineManager', 'resignReason']
      const created = !!(opts && opts.create)
      return { action: created ? 'staff.create' : 'staff.update', entity: 'staff', key: String(pin), summary: created ? `Added ${a ? a.name : pin} (PIN ${pin})` : `Changed ${a ? a.name : pin} (PIN ${pin})`, details: created ? { after: pick(a, keys) } : audit.diff(pick(b, keys), pick(a, keys)) }
    },
  })

  // ── leave and corrections ──
  wrap(lv.types, 'save', { before: async (id) => (id ? (await lv.types.list()).find(t => t.id === id) : null), entry: ([id, i], _r, b) => ({ action: id ? 'leavetype.update' : 'leavetype.create', entity: 'leave type', key: String(i.code).toUpperCase(), summary: `${id ? 'Changed' : 'Added'} the leave type "${String(i.name).trim()}" (${String(i.code).toUpperCase()})`, details: id && b ? audit.diff(pick(b, ['code', 'name', 'isPaid', 'defaultDays', 'isActive']), { code: String(i.code).toUpperCase(), name: String(i.name).trim(), isPaid: !!i.isPaid, defaultDays: i.defaultDays === '' || i.defaultDays == null ? null : Number(i.defaultDays), isActive: i.isActive !== false }) : undefined }) })
  wrap(lv.types, 'remove', { before: async (id) => (await lv.types.list()).find(t => t.id === id), entry: (_a, _r, b) => ({ action: 'leavetype.delete', entity: 'leave type', key: b ? b.code : '', summary: `Deleted the leave type "${b ? b.name : '?'}"` }) })
  wrap(lv.entitlements, 'saveMany', { before: async (year) => lv.entitlements.forYear(year), entry: ([year, entries], r, b) => ({ action: 'entitlement.set', entity: 'leave', key: String(year), summary: `Set ${r.saved} leave entitlement${r.saved === 1 ? '' : 's'} for ${year}${r.cleared ? ` and cleared ${r.cleared}` : ''}`, details: { changes: entries.map(e => ({ pin: e.pin, typeId: e.typeId, from: b && b[e.pin] ? b[e.pin][e.typeId] ?? null : null, to: e.days === '' ? null : Number(e.days) })).slice(0, 300) } }) })
  wrap(lv.entitlements, 'fillDefaults', { entry: ([year], r) => ({ action: 'entitlement.fill', entity: 'leave', key: String(year), summary: `Filled ${r} leave entitlement${r === 1 ? '' : 's'} for ${year} from the defaults` }) })
  wrap(lv.requests, 'create', { before: async (a) => (await lv.types.list()).find(t => t.id === a.typeId), entry: ([a], r, t) => ({ action: 'leave.record', entity: 'leave', key: a.pin, summary: `Recorded ${r.days} day${r.days === 1 ? '' : 's'} of ${t ? t.name.toLowerCase() : 'leave'} for ${a.pin} (${a.from}${a.halfDay ? ', ' + a.period + ' half day' : a.to && a.to !== a.from ? ' to ' + a.to : ''}), ${a.status === 'pending' ? 'pending' : 'approved'}`, details: { id: r.id, reason: a.reason || undefined, warning: r.warning || undefined } }) })
  wrap(lv.requests, 'decide', { before: (id) => lv.requests.get(id), entry: ([, d], _r, b) => ({ action: 'leave.' + d.status, entity: 'leave', key: b ? b.pin : '', summary: `${{ approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }[d.status]} ${b ? b.days + ' day(s) of ' + b.typeName.toLowerCase() + ' for ' + b.pin + ' (' + b.from + ')' : 'a leave request'}`, details: { note: d.note || undefined } }) })
  wrap(lv.holidays, 'add', { entry: ([h]) => ({ action: 'holiday.add', entity: 'holiday', key: h.date, summary: `Added the public holiday "${String(h.name).trim()}" on ${h.date}` }) })
  wrap(lv.holidays, 'addRange', { entry: ([h]) => ({ action: 'holiday.add', entity: 'holiday', key: h.date, summary: `Added the public holiday "${String(h.name).trim()}" on ${h.date}${Number(h.days) > 1 ? ` for ${Math.floor(Number(h.days))} days` : ''}` }) })
  wrap(lv.holidays, 'update', { entry: ([h]) => ({ action: 'holiday.update', entity: 'holiday', key: h.date, summary: `Renamed the public holiday on ${h.date} to "${String(h.name).trim()}"` }) })
  // ── discipline register ──
  const dWho = (r) => (r ? `${D.kindLabel(r.kind)} for PIN ${r.pin} (${r.occurredOn})` : 'a record')
  const dMoney = (r) => (r && r.deduction ? `, USD ${Number(r.deduction).toFixed(2)} deduction for payroll ${r.payrollYear}-${String(r.payrollMonth).padStart(2, '0')}` : '')
  const dRec = disc.records
  wrap(dRec, 'add', { entry: ([i], id) => ({ action: 'discipline.add', entity: 'discipline', key: String(id), summary: `Recorded a draft ${D.kindLabel(i.kind)} for PIN ${i.pin} (${i.occurredOn})${i.deduction ? `, USD ${Number(i.deduction).toFixed(2)} deduction` : ''}` }) })
  wrap(dRec, 'update', { before: (id) => dRec.get(id), entry: ([id], _r, b) => ({ action: 'discipline.update', entity: 'discipline', key: String(id), summary: `Changed the draft ${dWho(b)}` }) })
  wrap(dRec, 'discard', { before: (id) => dRec.get(id), entry: ([id], _r, b) => ({ action: 'discipline.discard', entity: 'discipline', key: String(id), summary: `Discarded the draft ${dWho(b)}` }) })
  wrap(dRec, 'confirm', { before: (id) => dRec.get(id), entry: ([id], _r, b) => ({ action: 'discipline.confirm', entity: 'discipline', key: String(id), summary: `Confirmed the ${dWho(b)}${dMoney(b)}${b && b.deduction ? ' (added to Monthly items as a withholding)' : ''}` }) })
  wrap(dRec, 'withdraw', { before: (id) => dRec.get(id), entry: ([id, o], _r, b) => ({ action: 'discipline.withdraw', entity: 'discipline', key: String(id), summary: `Withdrew the ${dWho(b)}${b && b.deduction ? ' and removed its payroll deduction' : ''}. Reason: ${String((o && o.reason) || '').trim()}` }) })
  wrap(dRec, 'issueLetter', { before: (id) => dRec.get(id), entry: ([id], r, b) => (b && !b.letterIssuedOn ? { action: 'discipline.letter', entity: 'discipline', key: String(id), summary: `Issued the warning letter for the ${dWho(b)}` } : null) })
  wrap(dRec, 'acknowledge', { before: (id) => dRec.get(id), entry: ([id, d], _r, b) => ({ action: 'discipline.acknowledge', entity: 'discipline', key: String(id), summary: `Marked the ${dWho(b)} as signed${d ? ' on ' + d : ''}` }) })

  wrap(lv.holidays, 'remove', { entry: ([d]) => ({ action: 'holiday.remove', entity: 'holiday', key: String(d), summary: `Removed the public holiday on ${d}` }) })
  const ovRow = (o) => (o ? { status: o.status, note: o.note, timeIn: o.timeIn || null, timeOut: o.timeOut || null } : null)
  wrap(lv.overrides, 'set', {
    before: async (a) => (await store.overrides.query({ from: a.date, to: a.date, pin: a.pin }))[0], after: async (a) => (await store.overrides.query({ from: a.date, to: a.date, pin: a.pin }))[0],
    entry: ([a], _r, b, o) => ({ action: 'correction.set', entity: 'day', key: `${a.pin}|${a.date}`, summary: `${b ? 'Changed the correction for' : 'Corrected'} ${a.pin} on ${a.date} to ${String(a.status).replace('_', ' ')}`, details: { before: ovRow(b), after: ovRow(o), scansSaid: a.originalStatus || undefined } }),
  })
  wrap(lv.overrides, 'remove', { before: async (pin, date) => (await store.overrides.query({ from: date, to: date, pin }))[0], entry: ([pin, date], _r, b) => ({ action: 'correction.remove', entity: 'day', key: `${pin}|${date}`, summary: `Removed the correction for ${pin} on ${date}`, details: { before: ovRow(b) } }) })

  // ── payroll ──
  const sKeys = ['exchangeRate', 'dependentReliefKhr', 'nonResidentRate', 'nssfEmployeeRate', 'nssfEmployerPensionRate', 'nssfEmployerHealthRate', 'nssfEmployerRiskRate', 'nssfCeilingKhr', 'nssfFloorKhr', 'workDaysPerMonth', 'hoursPerDay', 'otRateNormal', 'otRateOff', 'otRateHoliday', 'otSuggestThresholdMin', 'lateMode', 'lateAmount']
  wrap(pr.settings, 'save', { before: () => pr.settings.get(), after: () => pr.settings.get(), entry: (_a, _r, b, a) => { const d = audit.diff(pick(b, sKeys), pick(a, sKeys)); return Object.keys(d).length ? { action: 'payroll.settings', entity: 'payroll settings', key: 'settings', summary: `Changed payroll settings: ${Object.keys(d).join(', ')}`, details: d } : null } })
  wrap(pr.settings, 'saveBrackets', { before: async () => (await pr.settings.get()).brackets, after: async () => (await pr.settings.get()).brackets, entry: (_a, _r, b, a) => JSON.stringify(b) === JSON.stringify(a) ? null : ({ action: 'payroll.brackets', entity: 'payroll settings', key: 'tax brackets', summary: `Changed the tax brackets (${(b || []).length} to ${(a || []).length})`, details: { before: b, after: a } }) })
  wrap(pr.settings, 'fillFromHrm', { before: () => pr.settings.get(), after: () => pr.settings.get(), entry: (_a, r, b, a) => ({ action: 'payroll.settings', entity: 'payroll settings', key: 'settings', summary: `Filled ${r.filled} empty payroll setting${r.filled === 1 ? '' : 's'}${r.brackets ? ` and ${r.brackets} tax brackets` : ''} from HRM Hub's values`, details: audit.diff(pick(b, sKeys), pick(a, sKeys)) }) })
  const pKeys = ['salary', 'dependents', 'paymentMethod', 'bankName', 'bankAccount', 'taxResident', 'taxExempt', 'nssfExempt']
  wrap(pr.structure, 'saveMany', {
    before: () => pr.structure.list(), after: () => pr.structure.list(),
    entry: ([entries], r, b, a) => {
      const changed = entries.map(e => e.pin).filter(pin => JSON.stringify(pick(b[pin], pKeys)) !== JSON.stringify(pick(a[pin], pKeys)))
      if (!changed.length) return null
      const view = (o) => (o ? { ...pick(o, pKeys), bankAccount: mask(o.bankAccount) } : {})
      // One entry per person so "who changed this salary" is a lookup by PIN.
      return changed.map(pin => ({ action: 'pay.setup', entity: 'pay', key: pin, summary: `Changed pay setup for ${pin}: ${Object.keys(audit.diff(pick(b[pin], pKeys), pick(a[pin], pKeys))).join(', ')}`, details: audit.diff(view(b[pin]), view(a[pin])) }))
    },
  })
  wrap(pr.allowances, 'save', { entry: ([id, i]) => ({ action: id ? 'allowance.update' : 'allowance.create', entity: 'payroll settings', key: String(i.name).trim(), summary: `${id ? 'Changed' : 'Added'} the allowance "${String(i.name).trim()}" (${i.kind === 'percent' ? i.amount + '% of salary' : '$' + i.amount})` }) })
  wrap(pr.allowances, 'remove', { before: async (id) => (await pr.allowances.list()).find(x => x.id === id), entry: (_a, _r, b) => ({ action: 'allowance.delete', entity: 'payroll settings', key: b ? b.name : '', summary: `Deleted the allowance "${b ? b.name : '?'}"` }) })
  wrap(pr.entries, 'add', { entry: ([a]) => ({ action: 'payroll.item', entity: 'pay', key: a.pin, summary: `Added ${pr.KINDS[a.kind] ? pr.KINDS[a.kind].toLowerCase() : a.kind} of $${a.amount} for ${a.pin} (${a.year}-${String(a.month).padStart(2, '0')})`, details: pick(a, ['kind', 'label', 'amount', 'remarks']) }) })
  wrap(pr.entries, 'remove', { before: async (id) => { const { data } = await require('./supabase').from('payroll_entries').select('*').eq('id', id).maybeSingle(); return data }, entry: (_a, _r, b) => ({ action: 'payroll.item.remove', entity: 'pay', key: b ? b.pin : '', summary: `Removed a ${b ? b.kind : 'monthly'} item of $${b ? b.amount : '?'} for ${b ? b.pin : '?'} (${b ? b.year + '-' + String(b.month).padStart(2, '0') : ''})`, details: b ? pick(b, ['kind', 'label', 'amount', 'remarks']) : undefined }) })
  wrap(pr.overtime, 'suggest', { entry: ([y, m], r) => ({ action: 'overtime.suggest', entity: 'overtime', key: `${y}-${String(m).padStart(2, '0')}`, summary: `Suggested ${r} overtime entr${r === 1 ? 'y' : 'ies'} from the scans for ${y}-${String(m).padStart(2, '0')}` }) })
  wrap(pr.overtime, 'add', { entry: ([a]) => ({ action: 'overtime.add', entity: 'overtime', key: a.pin, summary: `Added ${a.hours} h of approved overtime for ${a.pin} on ${a.date}`, details: { note: a.note || undefined } }) })
  wrap(pr.overtime, 'decide', { before: async (id) => { const { data } = await require('./supabase').from('overtime_entries').select('*').eq('id', id).maybeSingle(); return data }, entry: ([, d], _r, b) => ({ action: 'overtime.' + d.status, entity: 'overtime', key: b ? b.pin : '', summary: `${{ approved: 'Approved', rejected: 'Rejected', pending: 'Reopened' }[d.status]} ${d.hours ? d.hours : b ? b.hours : '?'} h of overtime for ${b ? b.pin : '?'} on ${b ? b.date : '?'}`, details: b ? { suggested: b.scan_hours, hours: d.hours || b.hours } : undefined }) })
  wrap(pr.overtime, 'decideAllPending', { entry: ([y, m, s], r) => ({ action: 'overtime.' + s, entity: 'overtime', key: `${y}-${String(m).padStart(2, '0')}`, summary: `${s === 'approved' ? 'Approved' : 'Rejected'} all ${r} pending overtime entr${r === 1 ? 'y' : 'ies'} for ${y}-${String(m).padStart(2, '0')}` }) })
  wrap(pr.overtime, 'remove', { entry: ([id]) => ({ action: 'overtime.remove', entity: 'overtime', key: String(id), summary: 'Removed an overtime entry' }) })
  wrap(pr.runs, 'generate', { entry: ([y, m], r) => ({ action: 'payroll.generate', entity: 'payroll', key: `${y}-${String(m).padStart(2, '0')}`, summary: `Generated payroll for ${y}-${String(m).padStart(2, '0')}: ${r.count} slip${r.count === 1 ? '' : 's'}${r.incomplete ? `, ${r.incomplete} incomplete` : ''}${r.skipped.length ? `, ${r.skipped.length} left out (no salary)` : ''}` }) })
  wrap(pr.runs, 'discard', { entry: ([y, m]) => ({ action: 'payroll.discard', entity: 'payroll', key: `${y}-${String(m).padStart(2, '0')}`, summary: `Discarded the draft payroll for ${y}-${String(m).padStart(2, '0')}` }) })
  wrap(pr.runs, 'finalize', {
    after: async (y, m) => pr.runs.get(y, m),
    entry: ([y, m], _r, _b, run) => { const net = run ? Math.round(run.slips.reduce((a, s) => a + s.net, 0) * 100) / 100 : null; return { action: 'payroll.finalize', entity: 'payroll', key: `${y}-${String(m).padStart(2, '0')}`, summary: `Finalized payroll for ${y}-${String(m).padStart(2, '0')}${run ? `: ${run.slips.length} slips, net pay $${net}` : ''}`, details: run ? { slips: run.slips.length, netPay: net, exchangeRate: run.settings && run.settings.exchangeRate } : undefined } },
  })
}

module.exports = {}
