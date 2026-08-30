/**
 * Static, self-contained render of both dashboard states for visual review.
 * Uses the real planCards() logic and the real captured /api/metrics payloads;
 * charts are hand-rolled inline SVG (the live app uses Recharts). Not a
 * screenshot of the running app — a faithful preview of layout + values.
 *
 *   node test/render-dashboards.mjs > <out>.html
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planCards, CARD_TYPES } from '../src/cards/registry.js';
import {
  formatValue,
  formatChange,
  formatPercent,
  formatPeriod,
  formatPeriodRange,
  changeDirection,
} from '../src/lib/format.js';

const load = (n) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../test/fixtures/${n}.json`, import.meta.url))));

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---- inline SVG charts --------------------------------------------------- */

function sparkline(points, stroke) {
  const vals = points.map((p) => p.value);
  const w = 260;
  const h = 48;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * (w - 4) + 2;
      const y = h - 2 - ((p.value - min) / span) * (h - 4);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function barChart(data, fill) {
  const max = Math.max(...data.map((d) => d.value)) || 1;
  const rowH = 40;
  return `<svg viewBox="0 0 400 ${data.length * rowH}" width="100%" height="${data.length * rowH}">
    ${data
      .map((d, i) => {
        const bw = (d.value / max) * 250;
        const y = i * rowH + 8;
        return `<text x="0" y="${y + 14}" font-size="12" fill="var(--text-secondary)">${esc(d.label)}</text>
        <rect x="108" y="${y}" width="${bw.toFixed(1)}" height="22" rx="4" fill="${fill}"/>
        <text x="${(108 + bw + 6).toFixed(1)}" y="${y + 15}" font-size="12" fill="var(--text-secondary)">${esc(
          formatValue(d.value, 'currency')
        )}</text>`;
      })
      .join('')}
  </svg>`;
}

/* ---- card renderers ---------------------------------------------------- */

function healthCard({ dimension, score, subScores }) {
  const bandLabel = score >= 80 ? 'Strong' : score >= 60 ? 'Stable' : 'Watch';
  const bandColor =
    score >= 80 ? 'var(--status-good)' : score >= 60 ? 'var(--series-1)' : 'var(--status-warning)';
  return card(`
    <div class="label">${esc(dimension)} health</div>
    <div class="big">${score}<span class="unit"> / 100</span></div>
    <div class="band"><span class="dot" style="background:${bandColor}"></span><span style="color:${bandColor}">${bandLabel}</span></div>
    <div class="muted">${subScores.length} sub-metric${subScores.length === 1 ? '' : 's'} scored</div>
  `);
}

function kpiCard({ label, latest, change, growthRate, format, limited }) {
  const dir = changeDirection(change);
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  const tone =
    dir === 'up' ? 'var(--delta-up)' : dir === 'down' ? 'var(--status-critical)' : 'var(--text-muted)';
  const delta = limited
    ? `<div class="muted">single period — no change yet</div>`
    : `<div class="delta" style="color:${tone}">${arrow} ${esc(formatChange(change, format))}
        <span class="muted">(${esc(formatPercent(growthRate))})</span></div>`;
  return card(`
    <div class="label">${esc(label)}</div>
    <div class="big">${esc(formatValue(latest, format))}</div>
    ${delta}
  `);
}

function trendCard({ label, series, format }) {
  const pts = series.filter((p) => Number.isFinite(p.value));
  const first = pts[0].value;
  const last = pts[pts.length - 1].value;
  const rng = first === 0 ? null : (last - first) / first;
  const tone = rng > 0 ? 'var(--delta-up)' : rng < 0 ? 'var(--status-critical)' : 'var(--text-muted)';
  return card(`
    <div class="row"><span class="label">${esc(label)}</span>
      <span style="font-size:12px;color:${tone}">${esc(formatPercent(rng))} over range</span></div>
    <div class="big2">${esc(formatValue(last, format))}</div>
    <div class="chart">${sparkline(pts, 'var(--series-1)')}</div>
    <div class="row muted" style="font-size:11px">
      <span>${esc(formatPeriod(pts[0].period))}</span><span>${esc(formatPeriod(pts[pts.length - 1].period))}</span>
    </div>
  `);
}

function barCard({ title, data }) {
  return card(
    `<div class="label">${esc(title)}</div><div class="chart">${barChart(data, 'var(--series-1)')}</div>`,
    'span2'
  );
}

function riskCard({ type, title, detail }) {
  const isRisk = type === 'risk';
  const accent = isRisk ? 'var(--status-critical)' : 'var(--status-good)';
  return card(
    `<div class="row" style="gap:6px;justify-content:flex-start">
       <span style="color:${accent}">${isRisk ? '▲' : '★'}</span>
       <span class="label">${isRisk ? 'Risk' : 'Opportunity'}</span></div>
     <div class="big3">${esc(title)}</div>
     <p class="detail">${esc(detail)}</p>`,
    '',
    accent
  );
}

function card(inner, extraClass = '', accent = null) {
  return `<div class="card ${extraClass}"${accent ? ` style="border-left:3px solid ${accent}"` : ''}>${inner}</div>`;
}

const RENDERERS = {
  [CARD_TYPES.HEALTH]: healthCard,
  [CARD_TYPES.KPI]: kpiCard,
  [CARD_TYPES.TREND]: trendCard,
  [CARD_TYPES.BAR]: barCard,
  [CARD_TYPES.RISK]: riskCard,
};

function insightBlock(insight) {
  if (!insight || insight.status !== 'ok') return '';
  return `<div class="card insight">
    <div class="label">Insight <span class="muted" style="text-transform:none;font-weight:400">· ${esc(insight.model)}</span></div>
    <div class="insight-cols">
      <div><h3>Why</h3><p>${esc(insight.why)}</p></div>
      <div><h3>What to do</h3><p>${esc(insight.recommendation)}</p></div>
    </div>
  </div>`;
}

function dashboard(name, metrics, insight) {
  const cards = planCards(metrics);
  const d = metrics.dataset;
  return `<section>
    <h2>${esc(name)}</h2>
    <p class="sub">${esc(formatPeriodRange(d.periods))} · ${d.periodCount} monthly periods · ${cards.length} cards + 1 insight</p>
    ${insightBlock(insight)}
    <div class="grid">${cards.map((c) => RENDERERS[c.type](c.props)).join('')}</div>
  </section>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>AscendDV — dashboard states</title>
<style>
:root{
  --page:#f9f9f7;--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#898781;
  --border:rgba(11,11,11,.10);--series-1:#2a78d6;--status-good:#0ca30c;--status-warning:#fab219;
  --status-critical:#d03b3b;--delta-up:#006300;
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--text-primary);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
.tagline{color:var(--text-secondary);font-size:14px;margin:0 0 28px}
section{margin-bottom:40px}
h2{font-size:18px;margin:0 0 2px}
.sub{color:var(--text-secondary);font-size:13px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:820px){.grid{grid-template-columns:repeat(2,1fr)}}
.card{background:var(--surface-1);border:1px solid var(--border);border-radius:12px;padding:16px}
.card.span2{grid-column:span 2}
.card.insight{margin-bottom:16px}
.insight-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:8px}
@media(max-width:820px){.insight-cols{grid-template-columns:1fr}}
.insight h3{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-secondary);margin:0}
.insight p{font-size:13px;line-height:1.5;color:var(--text-primary);margin:4px 0 0}
.label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)}
.big{font-size:30px;font-weight:600;margin-top:8px}
.big2{font-size:22px;font-weight:600;margin-top:4px}
.big3{font-size:16px;font-weight:600;margin-top:8px}
.unit{font-size:14px;color:var(--text-muted);font-weight:400}
.band{margin-top:8px;font-size:14px;font-weight:500;display:flex;align-items:center;gap:6px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.delta{margin-top:4px;font-size:14px}
.muted{color:var(--text-muted);font-size:12px;margin-top:6px}
.row{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.chart{margin-top:10px}
.detail{margin:4px 0 0;font-size:13px;color:var(--text-secondary);line-height:1.45}
</style></head><body><div class="wrap">
<h1>AscendDV</h1><p class="tagline">Analytics that adapt to the data you actually have.</p>
${dashboard('fixture_rich.csv — full data', load('metrics_rich'), load('insight_rich'))}
${dashboard('fixture_sparse.csv — financial only, "Watch"', load('metrics_sparse'), load('insight_sparse'))}
</div></body></html>`;

process.stdout.write(html);
