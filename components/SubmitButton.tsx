'use client'

import { useFormStatus } from 'react-dom'
import type { ComponentProps } from 'react'
import { Button } from './ui'

// A submit button that shows it is working and cannot be pressed twice while a slow
// action (reading a month of scans, building payroll) runs on the server.
export function SubmitButton({ pendingLabel = 'Working', children, ...props }: { pendingLabel?: string } & ComponentProps<typeof Button>) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" {...props} disabled={pending || props.disabled} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </Button>
  )
}
