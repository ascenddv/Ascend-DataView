/**
 * Point-in-time PDF snapshot of the Overview dashboard (Phase 16).
 *
 * A PDF is just another rendering of the SAME deterministic buildMetrics()
 * payload the JSON API and the React dashboard use — no new data, no new
 * calculation. It is clearly stamped as a snapshot as of a moment, not live
 * data. Scoping is the caller's job: the route hands us only the acting org's
 * computed metrics.
 *
 * pdfkit only (standard AFM fonts, no native deps). Streams compressed off so
 * the artifact stays inspectable.
 */

const PDFDocument = require('pdfkit');

/* --- formatting (backend-local; mirrors frontend/src/lib/format.js) ------- */

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmtValue = (v, format) => (!isNum(v) ? '—' : format === 'currency' ? currency.format(v) : number.format(v));
const fmtPct = (rate, digits = 1) =>
  !isNum(rate) ? null : `${rate > 0 ? '+' : rate < 0 ? '-' : ''}${(Math.abs(rate) * 100).toFixed(digits)}%`;
const fmtSignedPct = (pct, digits = 1) =>
  !isNum(pct) ? null : `${pct > 0 ? '+' : pct < 0 ? '-' : ''}${Math.abs(pct).toFixed(digits)}%`;
function fmtPeriod(iso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(iso || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(iso || '');
}

// Band thresholds mirror frontend/src/lib/healthBands.js and the "Health score
// display bands" section of CLAUDE.md. Keep the three numbers in sync.
const STABLE_MIN = 48;
const STRONG_MIN = 64;
const bandLabel = (score) =>
  !isNum(score) ? 'Unavailable' : score >= STRONG_MIN ? 'Strong' : score >= STABLE_MIN ? 'Stable' : 'Watch';

const CURRENCY_KEYS = new Set(['revenue', 'expenses', 'cash_balance']);

/* --- palette ------------------------------------------------------------ */
const INK = '#1f2933';
const MUTED = '#7b8794';
const RULE = '#d2d6dc';
const ACCENT = '#3b6fb0';
const GOOD = '#2f7d4f';
const WARN = '#b26a00';
const BAD = '#b3261e';

/* --- small drawing helpers -------------------------------------------- */

function sectionHeading(doc, text) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(text.toUpperCase(), { characterSpacing: 0.5 });
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.moveDown(0.5);
}

function keyValueRow(doc, label, value, note, tone = MUTED) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.y;
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(label, left, y, { width: 180 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(value, left + 190, y, { width: 120 });
  if (note) doc.font('Helvetica').fontSize(9).fillColor(tone).text(note, left + 320, y, { width: right - left - 320 });
  doc.moveDown(0.35);
}

/** A tiny sparkline in a fixed box at the current y. */
function sparkline(doc, points, { width = 160, height = 26 } = {}) {
  const values = points.map((p) => p.value).filter(isNum);
  if (values.length < 2) return;
  const x0 = doc.page.margins.left + 190;
  const y0 = doc.y;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  doc.save().lineWidth(1).strokeColor(ACCENT);
  values.forEach((v, i) => {
    const px = x0 + i * stepX;
    const py = y0 + height - ((v - min) / span) * height;
    if (i === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
  });
  doc.stroke().restore();
  doc.y = y0 + height + 4;
}

/** Horizontal bars for a small category comparison. */
function barGroup(doc, rows, format) {
  const left = doc.page.margins.left;
  const maxBar = 240;
  const max = Math.max(...rows.map((r) => r.value).filter(isNum), 0) || 1;
  for (const r of rows) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(r.label, left, y, { width: 110 });
    const w = Math.max(2, (Math.max(r.value, 0) / max) * maxBar);
    doc.save().rect(left + 120, y + 1, w, 8).fill(ACCENT).restore();
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(fmtValue(r.value, format), left + 120 + w + 6, y);
    doc.moveDown(0.7);
  }
}

/* --- the document ---------------------------------------------------- */

function render(doc, metrics, insight, meta) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const dataset = metrics.dataset || {};
  const stamp = meta.generatedAt || new Date().toISOString();
  const stampLabel = new Date(stamp).toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('AscendDV — Overview snapshot');
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(meta.orgName || 'Organization');
  doc.moveDown(0.5);

  // The "this is not live data" stamp — deliberately prominent.
  doc.save().rect(left, doc.y, right - left, 30).fill('#eef2f7').restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT)
    .text(`POINT-IN-TIME SNAPSHOT — as of ${stampLabel}`, left + 8, doc.y + 6, { width: right - left - 16 });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('This is a saved snapshot, not a live view. Figures reflect the data on file at the time above.', left + 8, doc.y + 2, { width: right - left - 16 });
  doc.y += 14;
  doc.moveDown(1);

  if (!dataset.periodCount) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text('No data yet');
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text('This organization has not uploaded any data, so there is nothing to snapshot.');
    footer(doc, stampLabel);
    return;
  }

  const rangeLabel =
    dataset.periods && dataset.periods.length
      ? `${fmtPeriod(dataset.periods[0])} – ${fmtPeriod(dataset.latestPeriod)}`
      : fmtPeriod(dataset.latestPeriod);
  doc.font('Helvetica').fontSize(10).fillColor(INK)
    .text(`${rangeLabel} · ${dataset.periodCount} ${dataset.granularity === 'monthly' ? 'monthly ' : ''}${dataset.periodCount === 1 ? 'period' : 'periods'}`);

  /* Insight */
  if (insight && insight.status === 'ok' && insight.why) {
    sectionHeading(doc, 'Insight');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('WHY');
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(insight.why, { width: right - left });
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('WHAT TO DO');
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(insight.recommendation || '—', { width: right - left });
  } else {
    sectionHeading(doc, 'Insight');
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED)
      .text('AI insight was not available when this snapshot was taken.');
  }

  /* Health scores */
  const health = Object.entries(metrics.healthScores || {}).filter(([, h]) => h && h.status === 'Available');
  if (health.length) {
    sectionHeading(doc, 'Health scores');
    for (const [dimension, h] of health) {
      keyValueRow(
        doc,
        `${dimension} health`,
        `${h.score} / 100`,
        `${bandLabel(h.score)} · ${(h.subScores || []).length} sub-metric${(h.subScores || []).length === 1 ? '' : 's'}`
      );
    }
  }

  /* KPIs */
  if ((metrics.kpis || []).length) {
    sectionHeading(doc, 'Key figures');
    for (const k of metrics.kpis) {
      const format = CURRENCY_KEYS.has(k.key) ? 'currency' : 'number';
      const bits = [];
      const chg = fmtPct(k.growthRate);
      if (chg) bits.push(`${chg} vs prior period`);
      const vsAvg = fmtSignedPct(k.vsTrailingAveragePct);
      if (vsAvg) bits.push(`${vsAvg} vs its trailing average`);
      keyValueRow(doc, k.label, fmtValue(k.latest, format), bits.join('  ·  '));
    }
  }

  /* Trends */
  const trendSeries = (metrics.series || {});
  const trendKeys = ['revenue', 'expenses', 'cash_balance'].filter(
    (key) => Array.isArray(trendSeries[key]) && trendSeries[key].length >= 2 && metrics.cards && metrics.cards.Trend === 'Available'
  );
  if (trendKeys.length) {
    sectionHeading(doc, 'Trends');
    for (const key of trendKeys) {
      const label = key === 'cash_balance' ? 'Cash balance' : key[0].toUpperCase() + key.slice(1);
      const pts = trendSeries[key];
      const first = pts[0].value;
      const last = pts[pts.length - 1].value;
      const over = isNum(first) && first !== 0 ? (last - first) / first : null;
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(label, left, doc.y, { width: 180, continued: false });
      const rowY = doc.y - doc.currentLineHeight();
      sparkline(doc, pts);
      const pct = fmtPct(over);
      if (pct) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`${pct} over range`, left + 360, rowY);
      doc.moveDown(0.4);
    }
  }

  /* Revenue by source */
  const rbc = metrics.revenueByCategory || [];
  if (rbc.length >= 2 && metrics.cards && metrics.cards.BarComparison === 'Available') {
    sectionHeading(doc, `Revenue by source — ${fmtPeriod(dataset.latestPeriod)}`);
    barGroup(doc, rbc, 'currency');
  }

  /* Risks & opportunities */
  const ro = metrics.risksOpportunities || [];
  if (ro.length) {
    sectionHeading(doc, 'Risks & opportunities');
    for (const r of ro) {
      const tone = r.type === 'risk' ? BAD : GOOD;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(tone).text(r.type === 'risk' ? 'RISK' : 'OPPORTUNITY');
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(r.title);
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(r.detail, { width: right - left });
      doc.moveDown(0.5);
    }
  }

  footer(doc, stampLabel);
}

function footer(doc, stampLabel) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = doc.page.height - doc.page.margins.bottom + 12;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
      `AscendDV snapshot · ${stampLabel} · page ${i + 1} of ${range.count}`,
      doc.page.margins.left,
      y,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' }
    );
  }
}

/**
 * @param {object} metrics  - a buildMetrics() payload (org-scoped by the caller)
 * @param {object|null} insight - a generateInsight() result, or null
 * @param {{ orgName: string, generatedAt?: string }} meta
 * @returns {Promise<Buffer>}
 */
function buildOverviewPdf(metrics, insight, meta = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      compress: false,
      bufferPages: true,
      info: { Title: `AscendDV Overview snapshot — ${meta.orgName || 'Organization'}` },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      render(doc, metrics || {}, insight || null, meta);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildOverviewPdf };
