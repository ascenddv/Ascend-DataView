/**
 * Render smoke test: bundle <Dashboard> with esbuild, render it to static markup
 * for the real rich + sparse payloads, and assert the output is clean — the
 * component tree mounts without throwing, the right cards are present, and no
 * "N/A" / NaN / undefined / Infinity leaks into the DOM.
 *
 * (Recharts' ResponsiveContainer produces no SVG without a laid-out DOM, so this
 * verifies card structure and text, not chart geometry — that's the browser's
 * job, covered by a screenshot at the gate.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const load = (name) => JSON.parse(readFileSync(here(`./fixtures/${name}.json`)));

// Bundle Dashboard + React SSR into one CJS module we can require().
const probeSource = `
  import { renderToStaticMarkup } from 'react-dom/server';
  import Dashboard from '../src/components/Dashboard.jsx';
  import IngestionSummary from '../src/components/IngestionSummary.jsx';
  export function render(metrics, insightState, initialView) {
    return renderToStaticMarkup(
      <Dashboard metrics={metrics} insightState={insightState} initialView={initialView} />
    );
  }
  export function renderSummary(report) {
    return renderToStaticMarkup(<IngestionSummary report={report} />);
  }
`;

let render;
let renderSummary;

test.before(async () => {
  const out = here('./.render-smoke.bundle.cjs');
  await build({
    stdin: { contents: probeSource, resolveDir: here('.'), loader: 'jsx' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    logLevel: 'silent',
  });
  ({ render, renderSummary } = require(out));
});

const FORBIDDEN = ['N/A', 'NaN', 'undefined', 'Infinity'];

function assertClean(markup, label) {
  for (const bad of FORBIDDEN) {
    assert.ok(!markup.includes(bad), `${label}: rendered DOM contains "${bad}"`);
  }
}

const readyInsight = (name) => ({ status: 'ready', insight: load(name) });

test('rich payload renders a full dashboard with the insight, no dirty values', () => {
  const html = render(load('metrics_rich'), readyInsight('insight_rich'));
  assertClean(html, 'rich');
  // `>X health<` matches the card's label element, not prose mentioning it.
  for (const s of ['>Financial health<', '>Growth health<', '>Community health<']) {
    assert.ok(html.includes(s), `rich: missing card "${s}"`);
  }
  assert.ok(html.includes('Revenue by source'), 'rich: missing bar comparison card');
  assert.ok(!html.includes('Cash runway'), 'rich: risk card should be gone after the cash fix');
  assert.ok(html.includes('Overview'));
  assert.ok(html.includes('What to do'), 'rich: insight card not rendered');
  assert.ok(html.includes('health score of 58'), 'rich: insight "why" text missing');
});

test('sparse payload renders only what the data supports', () => {
  const html = render(load('metrics_sparse'), readyInsight('insight_sparse'));
  assertClean(html, 'sparse');
  assert.ok(html.includes('>Financial health<'), 'sparse: missing Financial health card');
  assert.ok(!html.includes('>Growth health<'), 'sparse: Growth card must not render');
  assert.ok(!html.includes('>Community health<'), 'sparse: Community card must not render');
  assert.ok(!html.includes('Revenue by source'), 'sparse: no bar comparison card');
  assert.ok(!html.includes('over range'), 'sparse: no trend cards (Trend is Limited)');
  assert.ok(html.includes('Cash runway'), 'sparse: missing the cash runway risk card');
  assert.ok(html.includes('cash runway risk'), 'sparse: insight text missing');
});

test('insight failure renders no insight card, dashboard still intact', () => {
  const html = render(load('metrics_rich'), { status: 'error', error: 'HTTP 500' });
  assert.ok(!html.includes('Insight'), 'errored insight must render nothing');
  assert.ok(html.includes('Financial health'), 'dashboard must still render without an insight');
});

test('insight service unavailable (quota) renders no insight card', () => {
  const html = render(load('metrics_rich'), {
    status: 'ready',
    insight: { status: 'unavailable', why: null, recommendation: null, reason: 'temporarily unavailable' },
  });
  assert.ok(!html.includes('>Insight<'), 'unavailable insight must render nothing');
  assert.ok(html.includes('Financial health'), 'dashboard intact');
});

test('insight still loading renders a placeholder, not a broken card', () => {
  const html = render(load('metrics_rich'), { status: 'loading' });
  assert.ok(html.includes('Generating insight'));
  assertClean(html, 'loading-insight');
});

test('empty dataset renders the no-data state, not a broken grid', () => {
  const html = render({ dataset: { periodCount: 0 }, cards: {} }, null);
  assertClean(html, 'empty');
  assert.ok(html.includes('No data yet'));
});

/* ------------------------ Phase 11: per-dimension views ---------------- */

test('view tabs render for every dimension plus Overview', () => {
  const html = render(load('metrics_rich_v2'), null);
  for (const label of ['Overview', 'Financial', 'People', 'Marketing', 'Strategic']) {
    assert.ok(html.includes(`>${label}</button>`), `missing tab "${label}"`);
  }
});

test('a dimension view renders only that category\'s cards', () => {
  const html = render(load('metrics_rich_v2'), null, 'People');
  assertClean(html, 'people-view');
  assert.ok(html.includes('>People health<'), 'People view should show the People health card');
  assert.ok(!html.includes('>Financial health<'), 'People view must not show the Financial card');
  assert.ok(!html.includes('Revenue by source'), 'People view must not show the revenue bar');
});

test('an empty dimension view (sparse Marketing) shows a friendly state, nothing fabricated', () => {
  const html = render(load('metrics_sparse_v2'), null, 'Marketing');
  assertClean(html, 'sparse-marketing');
  assert.ok(html.includes('Nothing to show for Marketing yet'));
  // no HealthScoreCard rendered -> no "/ 100" score anywhere
  assert.ok(!html.includes('/ 100'), 'must not fabricate a Marketing score');
  assert.ok(html.includes('needs a native signal') || html.includes('No sub-metrics available'),
    'shows the real reason the dimension has no data');
});

test('the Overview view still renders the full card set + insight', () => {
  const html = render(load('metrics_rich_v2'), { status: 'ready', insight: load('insight_rich') }, 'overview');
  assert.ok(html.includes('>Financial health<') && html.includes('>Strategic health<'));
  assert.ok(html.includes('Revenue by source'));
  assert.ok(html.includes('What to do'), 'insight card shows only on Overview');
});

test('IngestionSummary surfaces skipped rows, duplicates and mapping for the messy upload', () => {
  const html = renderSummary(load('upload_messy'));
  assertClean(html, 'summary-messy');
  assert.ok(html.includes('Skipped rows'), 'messy: no skipped-rows section');
  assert.ok(html.includes('duplicate period 2025-04-30'), 'messy: duplicate not shown to the user');
  assert.ok(
    html.includes('missing required field(s): expenses'),
    'messy: skip reason not shown'
  );
  // renamed headers resolved by the mapping are surfaced
  assert.ok(html.includes('Rev ($)') && html.includes('revenue'), 'messy: renamed header not shown');
});

test('IngestionSummary shows a clean result for the rich upload', () => {
  const html = renderSummary(load('upload_rich'));
  assertClean(html, 'summary-rich');
  assert.ok(html.includes('imported cleanly'), 'rich: not reported as clean');
  assert.ok(!html.includes('Skipped rows'), 'rich: should have no skipped-rows section');
});
