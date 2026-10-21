'use client'

import { useEffect } from 'react'

/**
 * For a signed-in person who may look at a page but not change it: says so, and switches off
 * the page's saving forms (forms that filter or navigate with GET are left alone). This is only
 * a courtesy. Every action is checked again on the server, so a form that slipped through
 * would still be refused.
 */
export function ReadOnlyNotice({ text = 'You can look at this page but not change it. Ask an administrator if you need to.' }: { text?: string }) {
  useEffect(() => {
    document.querySelectorAll<HTMLFormElement>('main form').forEach(f => {
      if ((f.getAttribute('method') || '').toLowerCase() === 'get') return
      for (const el of Array.from(f.elements)) (el as HTMLInputElement).disabled = true
    })
  }, [])
  return <p role="note" className="mb-5 max-w-[70ch] rounded border border-line bg-paper px-3.5 py-2.5 text-[14px] text-ink-soft">{text}</p>
}
