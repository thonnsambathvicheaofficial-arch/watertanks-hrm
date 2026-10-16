import type { Metadata } from 'next'
import { EmptyState, PageHeader } from '@/components/ui'
import { guard } from '@/lib/guard'
import { ImportWizard, type KindInfo } from './ImportWizard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const imp = require('@/lib/import')

export const metadata: Metadata = { title: 'Import' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Rows per request. Staff, holidays and corrections write one row at a time through the normal checks, so batches are small.
const CHUNK: Record<string, number> = { staff: 20, holidays: 40, corrections: 40, paysetup: 300, entitlements: 300 }

export default async function ImportPage() {
  const me = await guard()
  const kinds: KindInfo[] = Object.entries(imp.KINDS as Record<string, { label: string; blurb: string; perm: string }>)
    .filter(([, k]) => me.perms.includes(k.perm))
    .map(([key, k]) => ({ key, label: k.label, blurb: k.blurb, chunk: CHUNK[key] || 20 }))

  return (
    <>
      <PageHeader title="Import" note="Load many records at once from an Excel file. The file is checked first and compared with what is saved, and nothing changes until you confirm." />
      {kinds.length === 0 ? (
        <EmptyState title="Nothing you can import">Importing also needs permission to change the data itself, such as staff or payroll. Ask an administrator.</EmptyState>
      ) : (
        <>
          <section aria-labelledby="tpl-h" className="mb-8 max-w-[820px]">
            <h2 id="tpl-h" className="text-[15px] font-semibold">1. Get a template</h2>
            <p className="mb-3 mt-1 max-w-[66ch] text-[14px] text-ink-soft">Each template holds the right headings and what is saved now, so the quickest way to change many records is to download, edit and upload it again. A notes sheet explains each column.</p>
            <ul className="divide-y divide-line rounded-md border border-line bg-raised">
              {kinds.map(k => (
                <li key={k.key} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-2.5 text-[14px]">
                  <span className="font-medium">{k.label}</span>
                  <span className="flex gap-4">
                    <a className="text-brand-deep underline decoration-line-strong hover:decoration-brand" href={`/api/import-template/${k.key}`}>With current data</a>
                    <a className="text-brand-deep underline decoration-line-strong hover:decoration-brand" href={`/api/import-template/${k.key}?blank=1`}>Blank example</a>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="up-h">
            <h2 id="up-h" className="mb-3 text-[15px] font-semibold">2. Check and import</h2>
            <ImportWizard kinds={kinds} />
          </section>
        </>
      )}
    </>
  )
}
