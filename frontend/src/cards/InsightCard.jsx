import CardShell, { CardLabel } from './CardShell.jsx';

/**
 * Full-width AI insight card, the "why" and "what should we do" narrative,
 * rendered prominently at the top of the Overview.
 *
 * `state` is one of: 'loading' | 'ready'. Any other condition (error, or the
 * service returning `status: 'unavailable'`) renders NOTHING, a missing
 * narrative must never break or clutter the dashboard (graceful degradation).
 * `Dashboard` only mounts this card when it will actually show something.
 */
export default function InsightCard({ state, insight }) {
  if (state === 'loading') {
    return (
      <CardShell>
        <CardLabel>Insight</CardLabel>
        <div className="mt-2 flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>Generating insight</span>
          <span className="inline-flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                aria-hidden="true"
                className="inline-block h-1 w-1 rounded-full"
                style={{
                  background: 'currentColor',
                  animation: 'adv-typing 1.1s ease-in-out infinite',
                  animationDelay: `${i * 160}ms`,
                }}
              />
            ))}
          </span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="adv-skeleton h-16 rounded" />
          <div className="adv-skeleton h-16 rounded" />
        </div>
      </CardShell>
    );
  }

  if (state !== 'ready' || !insight || insight.status !== 'ok') return null;

  return (
    <CardShell>
      <CardLabel>Insight</CardLabel>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <div>
          <h3
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            Why
          </h3>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {insight.why}
          </p>
        </div>
        <div>
          <h3
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            What to do
          </h3>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {insight.recommendation}
          </p>
        </div>
      </div>
    </CardShell>
  );
}
