/** Placeholder shown while /api/metrics is in flight. */
export default function DashboardSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading dashboard">
      <div className="mb-4">
        <div className="adv-skeleton h-6 w-32 rounded" />
        <div className="adv-skeleton mt-2 h-4 w-56 rounded" />
      </div>
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        style={{ gap: 'var(--grid-gap)' }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="adv-skeleton h-32"
            style={{ borderRadius: 'var(--radius-lg)', animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    </section>
  );
}
