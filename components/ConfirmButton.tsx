'use client'

import { Button } from './ui'
import type { ComponentProps } from 'react'

// A submit button that asks first. Used only where the action removes something.
export function ConfirmButton({ message, ...props }: { message: string } & ComponentProps<typeof Button>) {
  return <Button type="submit" {...props} onClick={e => { if (!window.confirm(message)) e.preventDefault() }} />
}
