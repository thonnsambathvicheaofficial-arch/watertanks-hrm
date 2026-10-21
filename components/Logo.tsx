import Image from 'next/image'

// The mark is an oval on white; it sits on a white chip so it reads on dark and light.
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-white p-1" style={{ width: size + 8, height: size - 4 + 8 }}>
      <Image src="/logo.png" alt="Song Fa" width={size} height={Math.round(size * 0.66)} priority />
    </span>
  )
}
