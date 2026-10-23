'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MONTHS, addDays, addMonths, daysInclusive, sameDayInMonth, formatDMY, formatShort, monthGrid, orderRange, parseDate, todayISO, weekdayLong } from '@/lib/date-pick'

export type Holiday = { date: string; name: string }

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const FIELD = 'h-9 w-full rounded border border-line-strong bg-raised pl-3 pr-9 text-[14px] text-ink transition-colors placeholder:text-ink-faint hover:border-ink-faint focus-visible:border-brand'

// Two dates (first day, last day) chosen on one calendar: click the first day, then the last, and the range shows as you go.
// Public holidays are marked. Either box can also be typed (25/10/2026). It submits `nameFrom` and `nameTo` as YYYY-MM-DD,
// exactly like the two native date boxes it replaces; an empty last day means a single day.
export function DateRange({ nameFrom = 'from', nameTo = 'to', defaultFrom = '', defaultTo = '', holidays = [], required = true, labelFrom = 'First day', labelTo = 'Last day', hintTo = 'Leave empty for a single day.' }: {
  nameFrom?: string; nameTo?: string; defaultFrom?: string; defaultTo?: string; holidays?: Holiday[]; required?: boolean; labelFrom?: string; labelTo?: string; hintTo?: string
}) {
  const id = useId()
  const today = useMemo(() => todayISO(), [])
  const holiday = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays])
  const [from, setFrom] = useState(parseDate(defaultFrom))
  const [to, setTo] = useState(parseDate(defaultTo))
  const [fromText, setFromText] = useState(formatDMY(parseDate(defaultFrom)))
  const [toText, setToText] = useState(formatDMY(parseDate(defaultTo)))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<'from' | 'to'>('from')
  const [view, setView] = useState((parseDate(defaultFrom) || today).slice(0, 7))
  const [hover, setHover] = useState('')
  const [focusDate, setFocusDate] = useState(parseDate(defaultFrom) || today)
  const wrap = useRef<HTMLDivElement>(null)
  const fromInput = useRef<HTMLInputElement>(null)
  const toInput = useRef<HTMLInputElement>(null)

  // Typed text that is not a date cannot be submitted; the first day is required.
  useEffect(() => {
    fromInput.current?.setCustomValidity(fromText.trim() && !parseDate(fromText) ? 'Enter the date as dd/mm/yyyy.' : required && !from ? 'Choose the first day.' : '')
    toInput.current?.setCustomValidity(toText.trim() && !parseDate(toText) ? 'Enter the date as dd/mm/yyyy.' : '')
  }, [from, fromText, toText, required])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const showMonth = (date: string) => { setView(date.slice(0, 7)); setFocusDate(date) }
  const openFor = (which: 'from' | 'to') => {
    const start = (which === 'to' ? to || from : from) || today
    setActive(which); setOpen(true); showMonth(start)
  }
  const setFirst = (d: string) => { setFrom(d); setFromText(formatDMY(d)) }
  const setLast = (d: string) => { setTo(d); setToText(formatDMY(d)) }

  const pick = (date: string) => {
    if (active === 'from' || !from) {
      setFirst(date)
      if (to && to < date) setLast('')
      setActive('to'); showMonth(date)
    } else {
      const [a, b] = orderRange(from, date)
      setFirst(a); setLast(b); setOpen(false)
    }
  }

  // Typing: a valid date moves the calendar; blur tidies it to dd/mm/yyyy and puts a backwards range in order.
  const typed = (which: 'from' | 'to', text: string) => {
    if (which === 'from') setFromText(text); else setToText(text)
    const iso = parseDate(text)
    if (iso) { which === 'from' ? setFrom(iso) : setTo(iso); showMonth(iso) }
    else if (!text.trim()) { which === 'from' ? setFrom('') : setTo('') }
  }
  const settle = () => {
    const a = parseDate(fromText), b = parseDate(toText)
    if (a) setFromText(formatDMY(a))
    if (b) setToText(formatDMY(b))
    if (a && b && b < a) { setFirst(b); setLast(a) }
  }

  const [lo, hi] = useMemo<[string, string]>(() => {
    if (!from) return ['', '']
    if (active === 'to' && open && hover && !to) return orderRange(from, hover)
    return [from, to || from]
  }, [from, to, hover, active, open])
  const span = lo && hi ? daysInclusive(lo, hi) : 0
  const hols = lo && hi ? holidays.filter(h => h.date >= lo && h.date <= hi) : []
  const summary = from ? `${formatShort(lo)}${hi !== lo ? ` to ${formatShort(hi)}` : ''} · ${span} day${span === 1 ? '' : 's'}${hols.length ? ` · ${hols.length} public holiday${hols.length === 1 ? '' : 's'} inside` : ''}` : ''

  const grid = useMemo(() => monthGrid(view), [view])
  const moveFocus = (date: string) => { showMonth(date); setTimeout(() => document.getElementById(`${id}-${date}`)?.focus(), 0) }
  const onGridKey = (e: React.KeyboardEvent) => {
    const k = e.key
    const next = k === 'ArrowLeft' ? addDays(focusDate, -1) : k === 'ArrowRight' ? addDays(focusDate, 1) : k === 'ArrowUp' ? addDays(focusDate, -7) : k === 'ArrowDown' ? addDays(focusDate, 7)
      : k === 'PageUp' ? sameDayInMonth(addMonths(focusDate.slice(0, 7), e.shiftKey ? -12 : -1), Number(focusDate.slice(8, 10))) : k === 'PageDown' ? sameDayInMonth(addMonths(focusDate.slice(0, 7), e.shiftKey ? 12 : 1), Number(focusDate.slice(8, 10)))
      : k === 'Home' ? addDays(focusDate, -((new Date(focusDate + 'T00:00:00Z').getUTCDay() + 6) % 7)) : k === 'End' ? addDays(focusDate, 6 - ((new Date(focusDate + 'T00:00:00Z').getUTCDay() + 6) % 7)) : ''
    if (k === 'Escape') { e.preventDefault(); setOpen(false); (active === 'from' ? fromInput : toInput).current?.focus(); return }
    if (!next) return
    e.preventDefault()
    moveFocus(next)
  }
  const onInputKey = (which: 'from' | 'to') => (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); openFor(which) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); settle(); setOpen(false) }
  }

  const label = (text: string, htmlFor: string) => <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">{text}</label>
  const icon = (which: 'from' | 'to') => (
    <button type="button" tabIndex={-1} aria-label={`Open the calendar for the ${which === 'from' ? 'first' : 'last'} day`} onClick={() => (open && active === which ? setOpen(false) : openFor(which))}
      className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded text-ink-soft transition-colors hover:bg-brand-wash hover:text-ink">
      <CalendarDays size={16} aria-hidden />
    </button>
  )

  return (
    <div ref={wrap} className="relative">
      <input type="hidden" name={nameFrom} value={from} />
      <input type="hidden" name={nameTo} value={to} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          {label(labelFrom, `${id}-from`)}
          <div className="relative">
            <input id={`${id}-from`} ref={fromInput} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/yyyy" required={required} value={fromText}
              aria-haspopup="dialog" aria-expanded={open && active === 'from'}
              onFocus={() => openFor('from')} onClick={() => openFor('from')} onChange={e => typed('from', e.target.value)} onBlur={settle} onKeyDown={onInputKey('from')} className={cn(FIELD, open && active === 'from' && 'border-brand')} />
            {icon('from')}
          </div>
        </div>
        <div>
          {label(labelTo, `${id}-to`)}
          <div className="relative">
            <input id={`${id}-to`} ref={toInput} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/yyyy" value={toText}
              aria-haspopup="dialog" aria-expanded={open && active === 'to'}
              onFocus={() => openFor('to')} onClick={() => openFor('to')} onChange={e => typed('to', e.target.value)} onBlur={settle} onKeyDown={onInputKey('to')} className={cn(FIELD, open && active === 'to' && 'border-brand')} />
            {icon('to')}
          </div>
          <span className="mt-1 block text-[12px] text-ink-soft">{!open && summary && to ? summary : hintTo}</span>
        </div>
      </div>

      {open && (
        <div role="dialog" aria-label="Choose dates" className="absolute left-0 top-full z-30 mt-2 w-[304px] max-w-full rounded-md border border-line-strong bg-raised p-3 shadow-lg" onMouseLeave={() => setHover('')}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => setView(addMonths(view, -1))} className="flex h-8 w-8 items-center justify-center rounded text-ink-soft transition-colors hover:bg-brand-wash hover:text-ink"><ChevronLeft size={18} aria-hidden /></button>
            <div className="text-[14px] font-semibold" aria-live="polite">{MONTHS[Number(view.slice(5, 7)) - 1]} {view.slice(0, 4)}</div>
            <button type="button" aria-label="Next month" onClick={() => setView(addMonths(view, 1))} className="flex h-8 w-8 items-center justify-center rounded text-ink-soft transition-colors hover:bg-brand-wash hover:text-ink"><ChevronRight size={18} aria-hidden /></button>
          </div>
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-ink-soft" aria-hidden>
            {WEEK.map(d => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div role="grid" aria-label={`${MONTHS[Number(view.slice(5, 7)) - 1]} ${view.slice(0, 4)}`} className="grid grid-cols-7 gap-y-0.5" onKeyDown={onGridKey}>
            {grid.map(c => {
              const inRange = !!lo && c.date >= lo && c.date <= hi
              const edge = c.date === lo || c.date === hi
              const hol = holiday.get(c.date)
              return (
                <button
                  key={c.date}
                  id={`${id}-${c.date}`}
                  type="button"
                  tabIndex={c.date === focusDate ? 0 : -1}
                  aria-label={`${weekdayLong(c.date)} ${Number(c.date.slice(8, 10))} ${MONTHS[Number(c.date.slice(5, 7)) - 1]} ${c.date.slice(0, 4)}${hol ? `, ${hol}` : ''}`}
                  aria-pressed={edge}
                  aria-current={c.date === today ? 'date' : undefined}
                  title={hol || undefined}
                  onClick={() => pick(c.date)}
                  onMouseEnter={() => setHover(c.date)}
                  className={cn(
                    'num relative flex h-9 items-center justify-center text-[13px] transition-colors',
                    inRange ? 'bg-brand/15' : 'rounded hover:bg-brand-wash',
                    inRange && c.date === lo && 'rounded-l', inRange && c.date === hi && 'rounded-r', inRange && lo === hi && 'rounded',
                    edge && '!rounded bg-brand font-medium text-white hover:bg-brand-deep',
                    !edge && !c.inMonth && 'text-ink-faint/70',
                    !edge && c.inMonth && (c.dow === 0 || c.dow === 6) && 'text-ink-soft',
                    !edge && hol && 'font-medium text-holiday',
                    c.date === today && !edge && 'ring-1 ring-inset ring-brand/60',
                  )}
                >
                  {Number(c.date.slice(8, 10))}
                  {hol && <span aria-hidden className={cn('absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full', edge ? 'bg-white' : 'bg-holiday')} />}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
            <p className="min-h-[32px] flex-1 text-[12px] leading-snug text-ink-soft" aria-live="polite">{summary || (active === 'from' ? 'Choose the first day.' : 'Now choose the last day.')}</p>
            <div className="flex shrink-0 gap-1">
              {from && <button type="button" onClick={() => { setLast(''); setOpen(false) }} className="h-8 rounded px-2 text-[12px] font-medium text-ink-soft transition-colors hover:bg-brand-wash hover:text-ink">One day</button>}
              <button type="button" onClick={() => pick(today)} className="h-8 rounded px-2 text-[12px] font-medium text-brand-deep transition-colors hover:bg-brand-wash">Today</button>
              <button type="button" onClick={() => { setFirst(''); setLast(''); setActive('from') }} className="h-8 rounded px-2 text-[12px] font-medium text-ink-soft transition-colors hover:bg-brand-wash hover:text-ink">Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
