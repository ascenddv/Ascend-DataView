/** Placeholder shown while /api/metrics is in flight. */
export default function DashboardSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading dashboard">
      <div className="mb-4">
        <div className="h-6 w-32 animate-pulse rounded" style={{ background: 'var(--gridline)' }} />
        <div
          className="mt-2 h-4 w-56 animate-pulse rounded"
          style={{ background: 'var(--gridline)' }}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
          />
        ))}
      </div>
    </section>
  );
}
