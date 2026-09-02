/**
 * AscendAI tools (Stage 4, Phase 18).
 *
 * Each tool is a real function reading from the SAME deterministic
 * buildMetrics/eligibility/confidence layer the rest of the app uses. The model
 * decides what to look up; these functions compute it; the model narrates the
 * result — it never invents or calculates a number itself.
 *
 * Every tool takes `orgId` explicitly and is scoped by it (via `loadMetrics`,
 * which reads `getStandardizedData(orgId)`), exactly like every other
 * tenant-scoped helper. A tool call can never reach another org's data.
 *
 * `loadMetrics` is injectable so tools can be unit-tested against a fixture
 * without a database.
 */

const { getStandardizedData } = require('../../db');
const { buildMetrics } = require('../buildMetrics');
const { HEALTH_DIMENSIONS } = require('../subMetrics');

const { stableMin: STABLE_MIN, strongMin: STRONG_MIN } = require('../../../shared/health-bands.json');

const KPI_FIELDS = ['revenue', 'expenses', 'cash_balance', 'donors_total'];
const TREND_FIELDS = ['revenue', 'expenses', 'cash_balance', 'donors_total'];

const defaultLoadMetrics = async (orgId) => buildMetrics(await getStandardizedData(orgId));

const bandLabel = (score) =>
  typeof score !== 'number' || !Number.isFinite(score)
    ? 'Unavailable'
    : score >= STRONG_MIN
      ? 'Strong'
      : score >= STABLE_MIN
        ? 'Stable'
        : 'Watch';

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number((v * 100).toFixed(1)) : null);

/* -------------------------------------------------------------------------- */
/* Tool schemas — OpenAI/DeepSeek function-calling format                     */
/* -------------------------------------------------------------------------- */

const SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'getHealthScore',
      description:
        "Get the current health score (0-100), its band (Watch/Stable/Strong), and the sub-metric growth rates behind it for one of this organization's eight health dimensions. Use this for any question about how a dimension is doing or why its score is what it is.",
      parameters: {
        type: 'object',
        properties: {
          dimension: {
            type: 'string',
            enum: HEALTH_DIMENSIONS,
            description: 'Which health dimension to look up.',
          },
        },
        required: ['dimension'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getKpi',
      description:
        "Get the latest value of a headline figure, its change vs. the previous period, and how it compares to this organization's own trailing average.",
      parameters: {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            enum: KPI_FIELDS,
            description: 'Which headline figure to look up.',
          },
        },
        required: ['field'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getRiskDetails',
      description:
        'List the risk and opportunity rules that have currently fired for this organization (e.g. cash runway below three months, funding concentration, revenue decline, improving donor retention), each with the specific numbers that triggered it. Takes no arguments.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTrend',
      description:
        "Get a headline figure's value over every period on file (the time series), plus the first-to-latest change and the direction/consistency of the recent trend. Use this for questions about how something has moved over time, not just the latest period.",
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: TREND_FIELDS,
            description: 'Which figure to get the time series for.',
          },
        },
        required: ['metric'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getRevenueBySource',
      description:
        "Get the latest period's revenue broken down by source (donations, grants, events, other), each with its share of total revenue. Use this for questions about revenue mix or funding concentration.",
      parameters: { type: 'object', properties: {} },
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Tool implementations                                                       */
/* -------------------------------------------------------------------------- */

async function getHealthScore(orgId, { dimension } = {}, { loadMetrics = defaultLoadMetrics } = {}) {
  if (!HEALTH_DIMENSIONS.includes(dimension)) {
    return { error: `Unknown dimension "${dimension}".`, validDimensions: HEALTH_DIMENSIONS };
  }
  const metrics = await loadMetrics(orgId);
  const h = (metrics.healthScores || {})[dimension];
  if (!h || h.status !== 'Available') {
    return {
      dimension,
      status: 'Unavailable',
      reason: (h && h.reason) || 'Not enough data to score this dimension yet.',
    };
  }
  const conf = (metrics.confidence || {})[`health-${dimension}`] || null;
  const t = (metrics.trends || {})[dimension] || null;
  return {
    dimension,
    status: 'Available',
    score: h.score,
    scoreExact: h.scoreExact,
    band: bandLabel(h.score),
    periodsCovered: metrics.dataset ? metrics.dataset.periodCount : null,
    subMetrics: (h.subScores || []).map((s) => ({
      metric: s.key,
      periodOverPeriodGrowthPct: pct(s.growthRate),
      inverted: s.inverted,
      subScore: s.subScore,
    })),
    recentTrend: t
      ? {
          primaryMetric: t.metric,
          direction: t.direction,
          consistency: t.consistency,
          consecutivePeriods: t.consecutivePeriods,
          latestVsTrailingAvgPct: t.deltaFromTrailingPct,
        }
      : null,
    dataConfidence: conf ? { tier: conf.tier, why: conf.reasons } : null,
  };
}

async function getKpi(orgId, { field } = {}, { loadMetrics = defaultLoadMetrics } = {}) {
  if (!KPI_FIELDS.includes(field)) {
    return { error: `Unknown field "${field}".`, validFields: KPI_FIELDS };
  }
  const metrics = await loadMetrics(orgId);
  const k = (metrics.kpis || []).find((x) => x.key === field);
  if (!k) {
    return { field, available: false, reason: 'This figure is not present in the uploaded data.' };
  }
  const conf = (metrics.confidence || {})[`kpi-${field}`] || null;
  return {
    field,
    label: k.label,
    latest: k.latest,
    previous: k.previous,
    change: k.change,
    growthPct: pct(k.growthRate),
    trailingAverage: k.trailingAverage ?? null,
    vsTrailingAveragePct: k.vsTrailingAveragePct ?? null,
    latestPeriod: metrics.dataset ? metrics.dataset.latestPeriod : null,
    dataConfidence: conf ? { tier: conf.tier, why: conf.reasons } : null,
  };
}

async function getRiskDetails(orgId, _args = {}, { loadMetrics = defaultLoadMetrics } = {}) {
  const metrics = await loadMetrics(orgId);
  const fired = (metrics.risksOpportunities || []).map((r) => ({
    type: r.type,
    key: r.key,
    title: r.title,
    detail: r.detail,
    metricValue: r.metricValue,
  }));
  return {
    count: fired.length,
    items: fired,
    note: fired.length === 0 ? 'No risk or opportunity rules are currently firing.' : undefined,
  };
}

async function getTrend(orgId, { metric } = {}, { loadMetrics = defaultLoadMetrics } = {}) {
  if (!TREND_FIELDS.includes(metric)) {
    return { error: `Unknown metric "${metric}".`, validMetrics: TREND_FIELDS };
  }
  const metrics = await loadMetrics(orgId);
  const series = (metrics.series || {})[metric] || [];
  if (series.length < 2) {
    return { metric, available: false, reason: 'Not enough periods on file to show a trend.' };
  }
  const first = series[0].value;
  const latest = series[series.length - 1].value;
  const firstToLastGrowthPct =
    typeof first === 'number' && first !== 0 ? pct((latest - first) / first) : null;

  // The Phase 15 trend signal is keyed by dimension; surface it when this metric
  // is the dimension's primary series (revenue -> Financial, donors -> Community).
  const DIM_FOR_METRIC = { revenue: 'Financial', donors_total: 'Community' };
  const dimTrend = (metrics.trends || {})[DIM_FOR_METRIC[metric]] || null;

  return {
    metric,
    periods: series.length,
    firstPeriod: series[0].period,
    latestPeriod: series[series.length - 1].period,
    first,
    latest,
    firstToLastGrowthPct,
    series: series.map((p) => ({ period: p.period, value: p.value })),
    recentSignal:
      dimTrend && dimTrend.metric && metric === 'revenue'
        ? { direction: dimTrend.direction, consistency: dimTrend.consistency, latestVsTrailingAvgPct: dimTrend.deltaFromTrailingPct }
        : null,
  };
}

async function getRevenueBySource(orgId, _args = {}, { loadMetrics = defaultLoadMetrics } = {}) {
  const metrics = await loadMetrics(orgId);
  const cats = metrics.revenueByCategory || [];
  if (cats.length < 2) {
    return {
      available: false,
      reason: 'The uploaded data does not break revenue into two or more sources.',
    };
  }
  const total = cats.reduce((sum, c) => sum + (typeof c.value === 'number' ? c.value : 0), 0);
  const sources = cats.map((c) => ({
    source: c.label,
    amount: c.value,
    sharePct: total > 0 ? pct(c.value / total) : null,
  }));
  const top = sources.reduce((a, b) => ((b.sharePct || 0) > (a.sharePct || 0) ? b : a), sources[0]);
  return {
    latestPeriod: metrics.dataset ? metrics.dataset.latestPeriod : null,
    totalOfBrokenOutSources: total,
    sources,
    largestSource: { source: top.source, sharePct: top.sharePct },
  };
}

const IMPLEMENTATIONS = { getHealthScore, getKpi, getRiskDetails, getTrend, getRevenueBySource };

/**
 * Execute a tool by name with parsed arguments. Unknown tool -> an error object
 * (returned to the model, not thrown) so a hallucinated tool name degrades
 * cleanly.
 */
async function runTool(name, args, orgId, deps = {}) {
  const impl = IMPLEMENTATIONS[name];
  if (!impl) return { error: `No such tool: ${name}` };
  return impl(orgId, args || {}, deps);
}

module.exports = {
  TOOL_SCHEMAS: SCHEMAS,
  runTool,
  getHealthScore,
  getKpi,
  getRiskDetails,
  getTrend,
  getRevenueBySource,
  KPI_FIELDS,
};
