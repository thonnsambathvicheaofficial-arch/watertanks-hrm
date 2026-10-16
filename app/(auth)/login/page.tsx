import type { Metadata } from 'next'
import { Logo } from '@/components/Logo'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="flex flex-col justify-between bg-steel gap-8 px-8 py-6 text-steel-text lg:gap-0 lg:px-12 lg:py-12">
        <Logo size={48} />
        <div className="lg:py-0">
          <h1 className="max-w-[16ch] text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] lg:text-[38px]">Song Fa Water Tanks</h1>
          <p className="mt-3 max-w-[42ch] text-[15px] text-steel-soft">
            Attendance, roster, leave and payroll, read straight from the fingerprint readers on the factory floor.
          </p>
        </div>
        <p className="hidden text-[13px] text-steel-soft lg:block">Phnom Penh · Mon to Sat</p>
      </section>
      <section className="flex items-center px-8 py-10 lg:px-16">
        <div className="w-full max-w-[340px]">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Sign in</h2>
          <p className="mb-6 mt-1 text-[14px] text-ink-soft">Use the account HR gave you.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  )
}
