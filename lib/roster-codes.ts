// How a day is shown on the roster grid. One place, so the grid, legend and
// exports agree. Colours come from the status tokens in globals.css.
export interface Cell {
  status: string; hours: number; in: string | null; out: string | null; note?: string | null; rosterNote?: string; leaveReason?: string
  overridden?: boolean; minutesLate?: number; leaveCode?: string; leaveDays?: number; holiday?: string
}

export const LEGEND: { code: string; label: string; cls: string }[] = [
  { code: 'P', label: 'Present', cls: 'bg-present-wash text-present' },
  { code: 'L', label: 'Late', cls: 'bg-late-wash text-late' },
  { code: 'A', label: 'Absent', cls: 'bg-absent-wash text-absent' },
  { code: 'O', label: 'Day off', cls: 'bg-dayoff-wash text-dayoff' },
  { code: 'AL', label: 'Leave (code of the type)', cls: 'bg-leave-wash text-leave' },
  { code: 'E', label: 'Excused', cls: 'bg-excused-wash text-excused' },
  { code: 'H', label: 'Public holiday', cls: 'bg-holiday-wash text-holiday' },
]

export function cellStyle(c: Cell): { code: string; cls: string } {
  switch (c.status) {
    case 'present': return { code: 'P', cls: 'bg-present-wash text-present' }
    case 'late': return { code: 'L', cls: 'bg-late-wash text-late' }
    case 'absent': return { code: 'A', cls: 'bg-absent-wash text-absent' }
    case 'day_off': return { code: 'O', cls: 'bg-dayoff-wash text-dayoff' }
    case 'leave': return { code: c.leaveCode || 'LV', cls: 'bg-leave-wash text-leave' }
    case 'excused': return { code: 'E', cls: 'bg-excused-wash text-excused' }
    case 'holiday': return { code: 'H', cls: 'bg-holiday-wash text-holiday' }
    default: return { code: '?', cls: 'bg-dayoff-wash text-dayoff' }
  }
}
