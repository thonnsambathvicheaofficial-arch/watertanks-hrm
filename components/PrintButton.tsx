'use client'

import { Printer } from 'lucide-react'
import { Button } from './ui'

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return <Button type="button" onClick={() => window.print()}><Printer size={16} aria-hidden /> {label}</Button>
}
