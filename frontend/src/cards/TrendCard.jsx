import { LineChart, Line, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import CardShell, { CardLabel } from './CardShell.jsx';
import {
  formatValue,
  formatPercent,
  formatPeriod,
  changeDirection,
} from '../lib/format.js';

// First -> last change across the visible range, same "null on a zero base"
// contract as the backend's calculateGrowthRate. Display-only.
function rangeGrowth(first, last) {
  if (![first, last].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (first === 0) return null;
  return (last - first) / first;
}

/**
 * Trend card — headline value + a sparkline over time (single series, one hue,
 * no legend: the label names it). Only rendered when the Trend card is
 * `Available` (> MIN_PERIODS_FOR_TREND_CARD periods); a `Limited` 3-point series
 * is intentionally not shown.
 */
export default function TrendCard({ label, series = [], format = 'number' }) {
  const points = series.filter((p) => Number.isFinite(p.value));
  const latest = points.length ? points[points.length - 1].value : null;
  const first = points.length ? points[0].value : null;
  const overall = rangeGrowth(first, latest);
  const dir = changeDirection(overall);

  const tone =
    dir === 'up'
      ? 'var(--delta-up)'
      : dir === 'down'
        ? 'var(--status-critical)'
        : 'var(--text-muted)';

  return (
    <CardShell>
      <div className="flex items-baseline justify-between gap-2">
        <CardLabel>{label}</CardLabel>
        {overall !== null && (
          <span className="text-xs" style={{ color: tone }}>
            {formatPercent(overall)} over range
          </span>
        )}
      </div>

      <div
        className="mt-1 text-2xl font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        {formatValue(latest, format)}
      </div>

      <div className="mt-2 h-14">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Tooltip
              cursor={{ stroke: 'var(--gridline)' }}
              contentStyle={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
              labelFormatter={(_, payload) =>
                payload && payload[0] ? formatPeriod(payload[0].payload.period) : ''
              }
              formatter={(v) => [formatValue(v, format), label]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>{points.length ? formatPeriod(points[0].period) : ''}</span>
        <span>{points.length ? formatPeriod(points[points.length - 1].period) : ''}</span>
      </div>
    </CardShell>
  );
}
