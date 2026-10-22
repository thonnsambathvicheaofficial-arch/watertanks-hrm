import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Logo } from '@/components/Logo'
import { PrintButton } from '@/components/PrintButton'
import { MigrationNotice, PageHeader } from '@/components/ui'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { records } = require('@/lib/discipline-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const D = require('@/lib/discipline')

export const metadata: Metadata = { title: 'Warning letter' }
export const dynamic = 'force-dynamic'

type Person = { staffCode: string; name: string; nameKh: string; position: string; departmentName: string }

// The letter to print and sign. English first, Khmer beneath. The Khmer wording is a draft for HR to confirm.
export default async function LetterPage({ params }: { params: { id: string } }) {
  await guard()
  if (!(await records.ready())) return <><PageHeader title="Warning letter" /><MigrationNotice file="009_discipline.sql" /></>
  const r = await records.get(params.id)
  if (!r) notFound()
  if (r.status !== 'confirmed') redirect(`/discipline/${r.id}`)
  const people: Record<string, Person> = await records.people()
  const p = people[r.pin] || ({} as Person)
  const L = D.letterModel(r, p)
  const line = (en: string, kh: string, value: string) => (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-3 border-b border-line py-1.5 last:border-b-0">
      <dt className="text-ink-soft">{en}<span className="block text-[12px]">{kh}</span></dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/discipline/${r.id}`} className="touch-target text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">Back to the record</Link>
        <div className="ml-auto"><PrintButton label="Print letter" /></div>
      </div>

      <article className="mx-auto max-w-[720px] rounded-md border border-line bg-raised p-6 text-[14px] leading-relaxed sm:p-10 print:max-w-none print:border-0 print:p-0">
        <header className="mb-6 flex items-center gap-3 border-b border-line-strong pb-5">
          <Logo size={44} />
          <div><p className="text-[16px] font-semibold">Song Fa Water Tanks</p></div>
          <p className="ml-auto num text-ink-soft">{r.letterIssuedOn || r.occurredOn}</p>
        </header>

        <h1 className="text-[20px] font-semibold">{L.titleEn}</h1>
        <p className="mb-5 text-[18px] font-semibold text-ink-soft">{L.titleKh}</p>

        <dl className="mb-5">
          {line('Staff ID', 'អត្តលេខ', p.staffCode || `PIN ${r.pin}`)}
          {line('Name', 'ឈ្មោះ', `${p.name || ''}${p.nameKh ? ` · ${p.nameKh}` : ''}`)}
          {line('Position', 'មុខតំណែង', p.position || '')}
          {line('Department', 'ផ្នែក', p.departmentName || '')}
          {line('Date it happened', 'កាលបរិច្ឆេទកើតហេតុ', r.occurredOn)}
        </dl>

        <p className="mb-2">{L.bodyEn}</p>
        <p className="mb-5 text-ink-soft">{L.bodyKh}</p>

        <div className="mb-5 rounded border border-line-strong p-3">
          <p className="mb-1 text-[12px] font-medium text-ink-soft">Reason · មូលហេតុ</p>
          <p className="whitespace-pre-wrap">{r.reason}</p>
        </div>

        {L.deductionEn && (
          <div className="mb-5">
            <p>{L.deductionEn}</p>
            <p className="text-ink-soft">{L.deductionKh}</p>
          </div>
        )}

        <div className="mt-12 grid grid-cols-2 gap-10">
          <div>
            <div className="h-14 border-b border-ink" />
            <p className="mt-1 text-[13px]">Employee signature<span className="block text-[12px] text-ink-soft">ហត្ថលេខាបុគ្គលិក</span></p>
            <p className="mt-4 text-[13px] text-ink-soft">Date received · ថ្ងៃទទួល: ____ / ____ / ________</p>
          </div>
          <div>
            <div className="h-14 border-b border-ink" />
            <p className="mt-1 text-[13px]">Human resources<span className="block text-[12px] text-ink-soft">ហត្ថលេខាផ្នែកធនធានមនុស្ស</span></p>
            <p className="mt-4 text-[13px] text-ink-soft">{r.letterIssuedBy ? `Issued by ${r.letterIssuedBy}` : ''}</p>
          </div>
        </div>
      </article>
    </>
  )
}
