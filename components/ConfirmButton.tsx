'use client'

import { useFormStatus } from 'react-dom'
import type { ComponentProps } from 'react'
import { Button } from './ui'

// A submit button that asks first. Used where the action removes or locks something.
// While the action runs it is disabled, and shows `pendingLabel` if one is given.
export function ConfirmButton({ message, pendingLabel, children, ...props }: { message: string; pendingLabel?: string } & ComponentProps<typeof Button>) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" {...props} disabled={pending || props.disabled} aria-busy={pending} onClick={e => { if (!window.confirm(message)) e.preventDefault() }}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
