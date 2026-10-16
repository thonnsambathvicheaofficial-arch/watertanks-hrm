import { echoAll, echoOne, type Echo } from '@/lib/echo'
import type { Profile } from './StaffForm'

// Rebuild a Profile from the values typed before a rejected save, or null if none.
export function profileFromEcho(e: Echo | null, base: Profile | null): Profile | null {
  if (!e) return null
  const s = (k: string) => echoOne(e, k) ?? ''
  return {
    pin: base?.pin ?? s('pin'), name: s('name'), group: s('group'), timeIn: s('timeIn'), timeOut: s('timeOut'),
    offDays: echoAll(e, 'offDays').map(Number), aliases: s('aliases').split(/[,\s]+/).filter(Boolean),
    departmentId: s('departmentId'), shiftId: s('shiftId'), position: s('position'), phone: s('phone'),
    joiningDate: s('joiningDate'), resignedDate: s('resignedDate'),
  }
}
