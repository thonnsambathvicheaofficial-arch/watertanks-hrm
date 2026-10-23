'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type PickerPerson = { pin: string; name: string; nameKh?: string; staffCode?: string }

// A staff member chosen by typing: filters on name (English or Khmer), PIN or Staff ID as you type, then you pick one with
// the mouse or the arrow keys and Enter. It submits `name` (the PIN) like the plain dropdown it replaces.
export function StaffPicker({ people, name = 'pin', defaultValue = '', required = false, placeholder = 'Type a name, PIN or Staff ID' }: {
  people: PickerPerson[]; name?: string; defaultValue?: string; required?: boolean; placeholder?: string
}) {
  const label = (p: PickerPerson) => `${p.name || 'Unnamed'} · ${p.pin}`
  const byPin = useMemo(() => new Map(people.map(p => [p.pin, p])), [people])
  const initial = defaultValue ? byPin.get(defaultValue) : undefined
  const [picked, setPicked] = useState<PickerPerson | null>(initial || null)
  const [text, setText] = useState(initial ? label(initial) : '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q || (picked && text === label(picked))) return people
    return people.filter(p => p.pin.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q) || (p.nameKh || '').includes(text.trim()) || (p.staffCode || '').toLowerCase().includes(q))
  }, [people, text, picked])

  // The form cannot be sent with words typed but nobody chosen.
  useEffect(() => {
    if (!input.current) return
    input.current.setCustomValidity(picked ? '' : required || text.trim() ? 'Choose a person from the list.' : '')
  }, [picked, required, text])
  useEffect(() => { if (open && list.current) (list.current.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }) }, [active, open])

  const choose = (p: PickerPerson) => { setPicked(p); setText(label(p)); setOpen(false) }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive(a => Math.min(a + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (matches[active]) choose(matches[active]) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false) }
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={picked ? picked.pin : ''} />
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        required={required}
        onFocus={e => { setOpen(true); e.currentTarget.select() }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
        onChange={e => { setText(e.target.value); setPicked(null); setActive(0); setOpen(true) }}
        className="h-9 w-full rounded border border-line-strong bg-raised px-3 text-[14px] text-ink transition-colors placeholder:text-ink-faint hover:border-ink-faint focus-visible:border-brand"
      />
      {open && (
        <ul
          id={`${id}-list`}
          ref={list}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded border border-line-strong bg-raised py-1 text-[14px] shadow-lg"
        >
          {matches.length === 0 && <li className="px-3 py-2 text-ink-soft">No one matches “{text.trim()}”.</li>}
          {matches.map((p, i) => (
            <li
              key={p.pin}
              role="option"
              aria-selected={picked?.pin === p.pin}
              // mousedown, not click: the input's blur would close the list before a click lands
              onMouseDown={e => { e.preventDefault(); choose(p) }}
              // the field's <label> would forward this click to the text box and reopen the list
              onClick={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5', i === active && 'bg-brand-wash', picked?.pin === p.pin && 'font-medium')}
            >
              <span className="truncate">{p.name || 'Unnamed'}{p.nameKh && <span lang="km" className="ml-2 text-[13px] text-ink-soft">{p.nameKh}</span>}</span>
              <span className="num shrink-0 text-[12px] text-ink-soft">{p.staffCode ? `${p.staffCode} · ` : ''}{p.pin}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
