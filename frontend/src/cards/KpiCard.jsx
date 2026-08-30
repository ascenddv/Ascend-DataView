import CardShell, { CardLabel } from './CardShell.jsx';
import {
  formatValue,
  formatChange,
  formatPercent,
  changeDirection,
} from '../lib/format.js';

/**
 * KPI card — a headline number with a period-over-period change indicator.
 * `limited` (only one period of data) drops the change indicator rather than
 * showing a fake zero.
 */
export default function KpiCard({
  label,
  latest,
  change,
  growthRate,
  format = 'number',
  limited = false,
}) {
  const value = formatValue(latest, format);
  const dir = changeDirection(change);
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';

  // "up is good" for every KPI we surface (revenue, cash, donors) — expenses is
  // shown as a KPI too, but a rising-expense signal is not colored as a loss here;
  // the health score handles that judgement. Neutral tone keeps this factual.
  const tone =
    dir === 'up'
      ? 'var(--delta-up)'
      : dir === 'down'
        ? 'var(--status-critical)'
        : 'var(--text-muted)';

  const changeText = formatChange(change, format);
  const pctText = formatPercent(growthRate);

  return (
    <CardShell>
      <CardLabel>{label}</CardLabel>
      <div
        className="mt-2 text-3xl font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </div>

      {!limited && changeText && (
        <div className="mt-1 flex items-center gap-1.5 text-sm" style={{ color: tone }}>
          <span aria-hidden="true">{arrow}</span>
          <span>{changeText}</span>
          {pctText && (
            <span style={{ color: 'var(--text-secondary)' }}>({pctText})</span>
          )}
          <span className="sr-only">
            {dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'unchanged'} vs previous period
          </span>
        </div>
      )}

      {limited && (
        <div className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          single period — no change yet
        </div>
      )}
    </CardShell>
  );
}
