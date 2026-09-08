/**
 * Designed empty / degraded state — a small mark, a headline, one line of
 * plain explanation, and an optional call to action. Used wherever the app
 * would otherwise show a bare bordered box of text (graceful degradation:
 * a sparse org gets a smaller, friendlier screen, never an error).
 */

const DefaultIcon = (
  <svg width="22" height="22" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
    <rect x="16" y="54" width="14" height="30" rx="3" opacity="0.5" />
    <rect x="43" y="40" width="14" height="44" rx="3" opacity="0.78" />
    <rect x="70" y="24" width="14" height="60" rx="3" />
  </svg>
);

export default function EmptyState({ icon, title, children, action, className = '' }) {
  return (
    <section
      className={`adv-fade-up flex flex-col items-center border px-6 py-12 text-center ${className}`}
      style={{
        background: 'var(--surface-1)',
        borderColor: 'var(--border)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <span
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
      >
        {icon || DefaultIcon}
      </span>
      <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {children && (
        <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: 'var(--text-secondary)' }}>
          {children}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}
