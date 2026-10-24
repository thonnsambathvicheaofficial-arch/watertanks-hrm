// A person's dated notes in one table cell: the first one in view, the rest a click away, so a roster row stays one line high.
// items look like "23 Oct: Unpaid leave: family event". Plain <details>, so it works without any script.
export function NoteList({ items, label }: { items?: string[]; label: string }) {
  if (!items || !items.length) return null
  return (
    <details className="max-w-[320px]">
      <summary className="flex cursor-pointer list-none items-baseline gap-1.5 text-[12px] text-ink-soft [&::-webkit-details-marker]:hidden" title={items.join('\n')}>
        <span className="truncate">{items[0]}</span>
        {items.length > 1 && <span className="shrink-0 rounded-sm bg-brand-wash px-1.5 text-[11px] font-medium text-brand-deep">+{items.length - 1}</span>}
      </summary>
      <ul className="mt-1 space-y-1 whitespace-normal border-t border-line pt-1 text-[12px] leading-snug text-ink-soft" aria-label={label}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </details>
  )
}
