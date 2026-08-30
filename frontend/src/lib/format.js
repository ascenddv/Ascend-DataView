/** Display formatting helpers. Presentation only — no business logic here. */

const currency0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const number0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatValue(value, format = 'number') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return format === 'currency' ? currency0.format(value) : number0.format(value);
}

/** Signed change, e.g. "+$3,400" / "-120". */
export function formatChange(change, format = 'number') {
  if (typeof change !== 'number' || !Number.isFinite(change)) return null;
  const sign = change > 0 ? '+' : change < 0 ? '-' : '';
  const body = formatValue(Math.abs(change), format);
  return body === null ? null : `${sign}${body}`;
}

/** Growth rate (a ratio like 0.109) as a signed percent, e.g. "+10.9%". */
export function formatPercent(rate, digits = 1) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
  const sign = rate > 0 ? '+' : rate < 0 ? '-' : '';
  return `${sign}${(Math.abs(rate) * 100).toFixed(digits)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-12-31" -> "Dec 2025". Falls back to the raw string if unparseable. */
export function formatPeriod(iso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "Jan 2025 – Dec 2025" from an ordered list of ISO periods. */
export function formatPeriodRange(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return '';
  if (periods.length === 1) return formatPeriod(periods[0]);
  return `${formatPeriod(periods[0])} – ${formatPeriod(periods[periods.length - 1])}`;
}

/** Direction of a change, for choosing an icon + status tone. */
export function changeDirection(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}
