'use client'

// Ticks or clears every checkbox with the given name inside the same form.
export function SelectAll({ name }: { name: string }) {
  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.closest('form')
    if (!form) return
    const boxes = Array.from(form.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`))
    const all = boxes.every(b => b.checked)
    boxes.forEach(b => { b.checked = !all })
  }
  return (
    <button type="button" onClick={toggle} className="text-[13px] font-medium text-brand-deep underline decoration-line-strong underline-offset-[3px] hover:decoration-brand">
      Select or clear all shown
    </button>
  )
}
