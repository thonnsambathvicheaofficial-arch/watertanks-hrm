'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { StaffPicker, type PickerPerson } from '@/components/StaffPicker'

// The same Group / Department rule the whole app uses (lib/staff-filter.js).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { matchesGroup, matchesDepartment } = require('@/lib/staff-filter') as {
  matchesGroup: (want: string, have: string | null | undefined) => boolean
  matchesDepartment: (want: string, have: string | null | undefined) => boolean
}

export type FilterPerson = PickerPerson & { group: string | null; departmentId: string }

// The Staff filter of a page's filter bar. It is linked to the Group and Department selects in the same form: as soon as either
// changes (before Filter is pressed) the list shows only the people who fit, and a person already chosen who no longer fits is cleared.
export function StaffFilterPicker({ people, group: initialGroup, department: initialDepartment, defaultValue = '', name = 'pin' }: {
  people: FilterPerson[]; group: string; department: string; defaultValue?: string; name?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const [group, setGroup] = useState(initialGroup)
  const [department, setDepartment] = useState(initialDepartment)
  const [pin, setPin] = useState(defaultValue)

  // Follow the selects of the surrounding form (and start from what they actually show, which a browser may have restored).
  useEffect(() => {
    const form = root.current?.closest('form')
    if (!form) return
    const read = () => {
      const g = form.elements.namedItem('group') as HTMLSelectElement | null
      const d = form.elements.namedItem('department') as HTMLSelectElement | null
      setGroup(g ? g.value : ''); setDepartment(d ? d.value : '')
    }
    read()
    form.addEventListener('change', read)
    return () => form.removeEventListener('change', read)
  }, [])

  const list = useMemo(() => people.filter(p => matchesGroup(group, p.group) && matchesDepartment(department, p.departmentId)), [people, group, department])
  const stillFits = !pin || list.some(p => p.pin === pin)
  useEffect(() => { if (!stillFits) setPin('') }, [stillFits])

  return (
    <div ref={root}>
      {/* a new list starts a fresh picker, so a stale choice or half-typed text cannot linger */}
      <StaffPicker
        key={`${group}|${department}`}
        name={name}
        defaultValue={stillFits ? pin : ''}
        onPick={setPin}
        people={list}
        placeholder={group || department ? `All staff (${list.length})` : 'All staff'}
      />
    </div>
  )
}
