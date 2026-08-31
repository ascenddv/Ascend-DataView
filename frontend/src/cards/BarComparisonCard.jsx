import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  LabelList,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import CardShell, { CardLabel } from './CardShell.jsx';
import { formatValue } from '../lib/format.js';

/**
 * Bar Comparison card — magnitude of one measure across a handful of categories
 * (revenue by source). Horizontal bars, single sequential hue, values
 * direct-labelled; recessive axes. Only rendered when >= 2 categories exist.
 */
export default function BarComparisonCard({
  title,
  data = [],
  format = 'currency',
  confidence = null,
  definition = null,
}) {
  const rows = data.filter((d) => Number.isFinite(d.value));
  const height = Math.max(120, rows.length * 44);

  return (
    <CardShell confidence={confidence} definition={definition}>
      <CardLabel>{title}</CardLabel>
      <div className="mt-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={rows}
            margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
            barCategoryGap={6}
          >
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis
              type="category"
              dataKey="label"
              width={104}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--gridline)', opacity: 0.4 }}
              contentStyle={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
              formatter={(v) => [formatValue(v, format), 'Amount']}
            />
            <Bar
              dataKey="value"
              fill="var(--series-1)"
              radius={[4, 4, 4, 4]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v) => formatValue(v, format)}
                style={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardShell>
  );
}
