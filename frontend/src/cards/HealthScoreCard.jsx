import CardShell, { CardLabel } from './CardShell.jsx';

/**
 * Health Score card — a large 0–100 score with a qualitative label.
 *
 * The label bands (Strong / Stable / Watch) are a DISPLAY concern and live only
 * here — they are not part of the scoring formula. A dimension that did not score
 * produces no card at all (handled by the registry), so this component never has
 * to render "N/A" or a placeholder.
 */
function band(score) {
  if (score >= 80) return { label: 'Strong', color: 'var(--status-good)' };
  if (score >= 60) return { label: 'Stable', color: 'var(--series-1)' };
  return { label: 'Watch', color: 'var(--status-warning)' };
}

export default function HealthScoreCard({ dimension, score, subScores = [] }) {
  const { label, color } = band(score);
  const signalCount = subScores.length;

  return (
    <CardShell accent={color} tint>
      <CardLabel>{dimension} health</CardLabel>

      <div className="mt-2 flex items-end gap-2">
        <span className="text-4xl font-bold leading-none" style={{ color: 'var(--text-primary)' }}>
          {score}
        </span>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          / 100
        </span>
      </div>

      <div className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: color }}
        />
        <span style={{ color }}>{label}</span>
      </div>

      <div className="mt-auto pt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {signalCount} sub-metric{signalCount === 1 ? '' : 's'} scored
      </div>
    </CardShell>
  );
}
