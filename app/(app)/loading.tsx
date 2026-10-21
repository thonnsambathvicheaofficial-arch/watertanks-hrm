// Shown the instant a link is clicked while the next page's data loads, so navigation never looks frozen.
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div aria-hidden className="space-y-4 motion-safe:animate-pulse">
        <div className="h-7 w-48 rounded bg-line" />
        <div className="h-4 w-80 max-w-full rounded bg-line/70" />
        <div className="mt-6 space-y-2 rounded-md border border-line bg-raised p-3">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-8 rounded bg-line/50" />)}
        </div>
      </div>
    </div>
  )
}
