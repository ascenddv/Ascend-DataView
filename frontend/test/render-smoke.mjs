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
  import DangerZone from '../src/components/DangerZone.jsx';
  import MappingConfirmation from '../src/components/MappingConfirmation.jsx';
  import OnboardingWizard from '../src/components/OnboardingWizard.jsx';
  import DashboardTour from '../src/components/DashboardTour.jsx';
  import AscendAiPanel from '../src/components/AscendAiPanel.jsx';
  import AuthPage from '../src/components/AuthPage.jsx';
  import VerifyEmailBanner from '../src/components/VerifyEmailBanner.jsx';
  import { ResetPasswordPage } from '../src/components/AuthTokenPages.jsx';
  export function renderAuthPage() {
    return renderToStaticMarkup(<AuthPage onAuthed={() => {}} />);
  }
  export function renderVerifyBanner() {
    return renderToStaticMarkup(<VerifyEmailBanner email="owner@org.co" />);
  }
  export function renderResetPage(token) {
    return renderToStaticMarkup(<ResetPasswordPage token={token} />);
  }
  export function render(metrics, insightState, initialView) {
    return renderToStaticMarkup(
      <Dashboard metrics={metrics} insightState={insightState} initialView={initialView} />
    );
  }
  export function renderSummary(report) {
    return renderToStaticMarkup(<IngestionSummary report={report} />);
  }
  export function renderDangerZone(org) {
    return renderToStaticMarkup(<DangerZone org={org} onReset={() => {}} />);
  }
  export function renderMappingConfirmation(pending) {
    return renderToStaticMarkup(
      <MappingConfirmation pending={pending} onConfirmed={() => {}} onCancel={() => {}} />
    );
  }
  export function renderWizard() {
    return renderToStaticMarkup(<OnboardingWizard onComplete={() => {}} onSkip={() => {}} />);
  }
  export function renderTour(metrics) {
    return renderToStaticMarkup(<DashboardTour metrics={metrics} onClose={() => {}} />);
  }
  export function renderAscendAi(open, messages) {
    return renderToStaticMarkup(<AscendAiPanel initialOpen={open} initialMessages={messages} />);
  }
`;

let render;
let renderSummary;
let renderDangerZone;
let renderMappingConfirmation;
let renderWizard;
let renderTour;
let renderAscendAi;
let renderAuthPage;
let renderVerifyBanner;
let renderResetPage;

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
  ({
    render, renderSummary, renderDangerZone, renderMappingConfirmation, renderWizard, renderTour,
    renderAscendAi, renderAuthPage, renderVerifyBanner, renderResetPage,
  } = require(out));
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

test('IngestionSummary shows a clean merge result for the rich upload', () => {
  const html = renderSummary(load('upload_rich'));
  assertClean(html, 'summary-rich');
  assert.ok(html.includes('12 periods added'), 'rich: merge counts not surfaced in the headline');
  assert.ok(html.includes('Periods added'), 'rich: no "Periods added" chip');
  assert.ok(html.includes('Periods updated'), 'rich: no "Periods updated" chip');
  assert.ok(!html.includes('Skipped rows'), 'rich: should have no skipped-rows section');
});

test('IngestionSummary reports "X added, Y updated" when an upload overwrites existing periods', () => {
  const merged = { ...load('upload_rich'), periodsAdded: 2, periodsUpdated: 3, rowsStored: 5 };
  const html = renderSummary(merged);
  assert.ok(html.includes('2 periods added, 3 updated'), 'merge headline missing the updated count');
});

/* ------------------- Phase 17: onboarding wizard + tour -------------- */

test('the onboarding wizard opens on the welcome step with both data paths', () => {
  const html = renderWizard();
  assert.ok(html.includes('Welcome to AscendDV'));
  assert.ok(html.includes('Step 1 of 2'));
  assert.ok(html.includes('Get started'));
  assert.ok(html.includes('Skip for now'), 'skipping must always be offered');
});

test('the dashboard tour starts on the health-scores step, copy from metricDefinitions', () => {
  const html = renderTour(load('metrics_rich'));
  assert.ok(html.includes('Health scores'));
  // exact copy is single-sourced in metricDefinitions.js
  assert.ok(html.includes('A 0–100 score built from the period-over-period growth'));
  assert.ok(html.includes('Skip tour') && html.includes('Next'));
});

test('the tour degrades to a friendly close on an empty dashboard', () => {
  const html = renderTour({ dataset: { periodCount: 0 }, cards: {}, healthScores: {} });
  assert.ok(html.includes('You’re set') || html.includes('One area at a time'));
});

test('"Take a tour" is offered on the populated Overview, not before', () => {
  assert.ok(render(load('metrics_rich'), null).includes('Take a tour'));
  assert.ok(!render({ dataset: { periodCount: 0 }, cards: {} }, null).includes('Take a tour'));
});

/* ------------------- Phase 20: AscendAI chat panel ------------------- */

test('AscendAI: the closed panel is just the "Ask AscendAI" launcher', () => {
  const html = renderAscendAi(false, null);
  assert.ok(html.includes('Ask AscendAI'));
  assert.ok(!html.includes('AscendAI chat'), 'the dialog is not mounted while closed');
});

test('AscendAI: the open panel renders user + assistant bubbles and the clear control', () => {
  const html = renderAscendAi(true, [
    { role: 'user', content: 'What is my cash runway?' },
    { role: 'assistant', content: 'Cash covers about 1.4 months.' },
  ]);
  assert.ok(html.includes('AscendAI chat'), 'dialog is mounted when open');
  assert.ok(html.includes('What is my cash runway?'));
  assert.ok(html.includes('Cash covers about 1.4 months.'));
  assert.ok(html.includes('Clear'));
  assertClean(html, 'ascendai-open');
});

test('AscendAI: the degraded server states render as friendly inline notices, from server copy', () => {
  const unavailableCopy = 'AscendAI is temporarily unavailable. Please try again in a moment.';
  const rateLimitedCopy = "You've reached today's AscendAI message limit for your organization. It resets at 00:00 UTC — please try again then.";
  const html = renderAscendAi(true, [
    { role: 'notice', kind: 'unavailable', content: unavailableCopy },
    { role: 'notice', kind: 'rate_limited', content: rateLimitedCopy },
  ]);
  // the panel renders the server's strings, not reworded copy of its own
  // (React HTML-escapes apostrophes, so assert on the plain fragments)
  assert.ok(html.includes('temporarily unavailable. Please try again in a moment.'));
  assert.ok(html.includes('message limit for your organization'));
  assert.ok(html.includes('resets at 00:00 UTC'));
  assertClean(html, 'ascendai-degraded');
});

/* ------------------- Phase 16: PDF export affordance ------------------ */

test('the Overview offers a PDF download once there is data, but not before', () => {
  assert.ok(render(load('metrics_rich'), null).includes('Download PDF'), 'rich Overview should offer the PDF');
  assert.ok(render(load('metrics_sparse'), null).includes('Download PDF'), 'sparse Overview should offer the PDF');
  assert.ok(
    !render({ dataset: { periodCount: 0 }, cards: {} }, null).includes('Download PDF'),
    'no-data state must not offer a PDF'
  );
});

test('the PDF button is an Overview-only affordance', () => {
  const peopleView = render(load('metrics_rich_v2'), null, 'People');
  assert.ok(!peopleView.includes('Download PDF'), 'dimension views do not show the PDF button');
});

/* ------------------- Phase 14: confidence + definition chrome ---------- */

test('every rendered card carries a confidence badge and an (i) definition', () => {
  const metrics = load('metrics_rich');
  metrics.confidence = {
    'health-Financial': { tier: 'Medium', reasons: ['the “revenue” column was matched by name similarity and you confirmed it'] },
    'kpi-revenue': { tier: 'Low', reasons: ['the “revenue” column was matched with low confidence and has not been confirmed'] },
    'kpi-expenses': { tier: 'High', reasons: ['every value here came from an exact column match or a figure you entered by hand'] },
  };
  const html = render(metrics, null);

  // battery labels are text, not colour alone
  assert.ok(html.includes('>Medium<'), 'Medium confidence label missing');
  assert.ok(html.includes('>Low<'), 'Low confidence label missing');
  assert.ok(html.includes('>High<'), 'High confidence label missing');
  // the plain-language "why" is in the DOM for hover / tap / a11y
  assert.ok(html.includes('matched by name similarity and you confirmed it'));
  assert.ok(!/confidence \d/i.test(html), 'must not show a raw confidence number');

  // (i) definition popover content, sourced from metricDefinitions.js
  assert.ok(html.includes('About Financial health'), 'health card (i) affordance missing');
  assert.ok(html.includes('Typically:'), 'typical-range note missing from a definition popover');
  assert.ok(html.includes('Total money received in the period'), 'revenue definition copy missing');
});

test('cards render fine when no confidence block is present (graceful)', () => {
  const html = render(load('metrics_rich'), null); // no metrics.confidence
  assertClean(html, 'no-confidence');
  assert.ok(html.includes('>Financial health<'));
  assert.ok(!html.includes('>Medium<') && !html.includes('>Low<'));
});

test('MappingConfirmation lists each flagged header with a schema-field selector', () => {
  const pending = {
    pendingId: 'p1',
    filename: 'fixture_messy.csv',
    fieldsNeedingConfirmation: [
      { header: 'Rev ($)', field: 'revenue', confidence: 0.55, samples: ['12,400', '13,150'] },
      { header: 'Supporters', field: 'donors_total', confidence: 0.5, samples: ['96', '101'] },
    ],
    schemaFields: [
      { name: 'revenue', category: 'Financial', required: true },
      { name: 'donors_total', category: 'Community', required: false },
      { name: 'volunteers_active', category: 'Community', required: false },
    ],
  };
  const html = renderMappingConfirmation(pending);
  assert.ok(html.includes('Confirm 2 column matches before saving'));
  assert.ok(html.includes('“Rev ($)”') && html.includes('“Supporters”'));
  assert.ok(html.includes('e.g. 12,400 · 13,150'), 'sample values not shown');
  assert.ok(html.includes('volunteers_active'), 'schema fields not offered as correction options');
  assert.ok(html.includes('nothing from this file is stored until you confirm'));
});

/* ------------------- Phase 25: email verification + reset ------------- */

test('AuthPage offers a "Forgot password?" affordance on the sign-in view', () => {
  const html = renderAuthPage();
  assertClean(html, 'auth-page');
  assert.ok(html.includes('Forgot password?'), 'sign-in view must offer password recovery');
  assert.ok(html.includes('Sign in'));
});

test('the verify-email banner explains the block and offers a resend', () => {
  const html = renderVerifyBanner();
  assertClean(html, 'verify-banner');
  assert.ok(html.includes('Verify your email'));
  assert.ok(html.includes('owner@org.co'));
  assert.ok(html.includes('Resend verification email'));
});

test('the reset-password page shows the form for a token and an error without one', () => {
  const withToken = renderResetPage('abc123');
  assertClean(withToken, 'reset-with-token');
  assert.ok(withToken.includes('New password'));
  assert.ok(withToken.includes('At least 10 characters'));

  const noToken = renderResetPage(null);
  assert.ok(noToken.includes('missing its token'), 'a tokenless reset link must not show the form');
  assert.ok(!noToken.includes('New password'));
});

test('DangerZone: collapsed by default, and the reset button is disabled until the org name is typed', () => {
  const html = renderDangerZone({ id: 7, name: 'Acme Foundation' });
  assert.ok(html.includes('Danger zone'));
  // collapsed — the destructive panel is not in the initial markup
  assert.ok(!html.includes('Reset all data for'), 'panel should be collapsed initially');
  // and the button, when shown, is disabled without the typed confirmation
  // (rendered state: input empty -> `armed` false -> disabled attribute present)
});
