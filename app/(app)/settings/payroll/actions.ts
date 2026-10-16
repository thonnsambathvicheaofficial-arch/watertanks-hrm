'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')

const BACK = '/settings/payroll'
const get = (f: FormData, k: string) => f.get(k)

export async function saveSettings(f: FormData) {
  await act(BACK, async (s) => {
    await pr.settings.save({
      exchangeRate: get(f, 'exchangeRate'), dependentReliefKhr: get(f, 'dependentReliefKhr'), nonResidentRate: get(f, 'nonResidentRate'),
      nssfEmployeeRate: get(f, 'nssfEmployeeRate'), nssfEmployerPensionRate: get(f, 'nssfEmployerPensionRate'), nssfEmployerHealthRate: get(f, 'nssfEmployerHealthRate'), nssfEmployerRiskRate: get(f, 'nssfEmployerRiskRate'),
      nssfCeilingKhr: get(f, 'nssfCeilingKhr'), nssfFloorKhr: get(f, 'nssfFloorKhr'), workDaysPerMonth: get(f, 'workDaysPerMonth'), hoursPerDay: get(f, 'hoursPerDay'),
      otRateNormal: get(f, 'otRateNormal'), otRateOff: get(f, 'otRateOff'), otRateHoliday: get(f, 'otRateHoliday'), otSuggestThresholdMin: get(f, 'otSuggestThresholdMin'),
      lateMode: get(f, 'lateMode'), lateAmount: get(f, 'lateAmount'),
    }, s.username)
    return 'Settings saved.'
  }, undefined, f)
}

export async function saveBrackets(f: FormData) {
  await act(BACK, async () => {
    const min = f.getAll('bMin'), max = f.getAll('bMax'), rate = f.getAll('bRate'), qd = f.getAll('bQd')
    await pr.settings.saveBrackets(min.map((_, i) => ({ min: min[i], max: max[i], rate: rate[i], quickDeduction: qd[i] })))
    return 'Tax brackets saved.'
  }, undefined, f)
}

export async function fillFromHrm(_f: FormData) {
  await act(BACK, async (s) => {
    const r = await pr.settings.fillFromHrm(s.username)
    if (!r.filled && !r.brackets) return 'Nothing to fill: every one of those fields already has a value.'
    return `Filled ${r.filled} empty field${r.filled === 1 ? '' : 's'}${r.brackets ? ` and ${r.brackets} tax brackets` : ''} from HRM Hub's current values. Check them against the current regulation.`
  })
}

export async function saveAllowance(f: FormData) {
  const id = String(f.get('id') || '') || null
  await act(BACK, async () => { await pr.allowances.save(id, { name: f.get('name'), kind: f.get('kind'), amount: f.get('amount'), isActive: f.get('isActive') === 'on' }); return id ? 'Allowance saved.' : 'Allowance added.' }, undefined, id ? undefined : f)
}

export async function deleteAllowance(f: FormData) {
  await act(BACK, async () => { await pr.allowances.remove(String(f.get('id'))); return 'Allowance deleted.' })
}
