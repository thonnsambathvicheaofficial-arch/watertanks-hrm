import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Mono, Noto_Sans_Khmer } from 'next/font/google'
import './globals.css'

// IBM Plex: an engineering-drawn sans with a true tabular-figure set, for a tool
// people read digits in all day. Noto Sans Khmer is declared in the stack so
// Khmer names and notes render in a matching weight everywhere.
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex', display: 'swap' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' })
const khmer = Noto_Sans_Khmer({ subsets: ['khmer'], weight: ['400', '500', '600'], variable: '--font-khmer', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Song Fa HR', template: '%s · Song Fa HR' },
  description: 'Attendance, roster, leave and payroll for Song Fa Water Tanks.',
  icons: { icon: '/logo.png' },
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plex.variable} ${plexMono.variable} ${khmer.variable}`}>
      <body>{children}</body>
    </html>
  )
}
