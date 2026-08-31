/**
 * Single source of truth for plain-language metric explanations (Phase 14c).
 *
 * The (i) definition tooltips on every card AND the Phase 17 onboarding tour
 * both read from this file — explanatory copy for a metric lives here and
 * nowhere else.
 *
 * `typicalRange` is hand-curated general guidance. There is NO benchmark
 * dataset behind AscendDV yet, so the copy says "generally" / "often" / "a
 * common pattern" — never "your peers", "the average nonprofit", or anything
 * that implies a measured comparison group.
 */

import { STABLE_MIN, STRONG_MIN } from './healthBands.js';

const HEALTH_HOW_ITS_BUILT =
  'A 0–100 score built from the period-over-period growth of whichever sub-metrics your data supports. 50 is flat; above 50 is growth, below 50 is decline. It averages those sub-metric scores and reflects only this organization’s own data over time.';

const HEALTH_TYPICAL =
  `Scores from ${STABLE_MIN} to ${STRONG_MIN - 1} are the ordinary healthy range (roughly flat to solid growth). ` +
  `${STRONG_MIN} and up means sustained growth well above what is typical; below ${STABLE_MIN} points to a real decline worth a closer look.`;

const HEALTH = {
  _default: { title: 'Health score', definition: HEALTH_HOW_ITS_BUILT, typicalRange: HEALTH_TYPICAL },
  Financial: {
    title: 'Financial health',
    definition:
      'Looks at revenue, expenses and cash balance together — whether money is coming in at least as fast as it goes out and the cash cushion is holding or growing. ' +
      HEALTH_HOW_ITS_BUILT,
    typicalRange: HEALTH_TYPICAL,
  },
  Growth: {
    title: 'Growth health',
    definition:
      'Tracks whether the organization is reaching more people and raising more money over time — revenue, donors, website visitors and social following. ' +
      HEALTH_HOW_ITS_BUILT,
    typicalRange: HEALTH_TYPICAL,
  },
  Community: {
    title: 'Community health',
    definition:
      'How well the organization is holding on to and engaging the people around it — donor retention, active volunteers and program participants. ' +
      HEALTH_HOW_ITS_BUILT,
    typicalRange: HEALTH_TYPICAL,
  },
  People: {
    title: 'People health',
    definition:
      'The state of the team itself — headcount growth and staff turnover. Rising turnover pulls this score down. ' +
      HEALTH_HOW_ITS_BUILT,
    typicalRange: HEALTH_TYPICAL,
  },
  Marketing: {
    title: 'Marketing health',
    definition:
      'Reach and efficiency of outreach — email list size, email open rate, and revenue raised per marketing dollar spent. ' +
      HEALTH_HOW_ITS_BUILT,
    typicalRange: HEALTH_TYPICAL,
  },
  Fundraising: {
    title: 'Fundraising health',
    definition:
      'How fundraising efforts are converting — the grant award rate (awarded vs. submitted) and donor growth. ' +
      HEALTH_HOW_ITS_BUILT,
    typicalRange: HEALTH_TYPICAL,
  },
  Impact: {
    title: 'Impact health',
    definition:
      'Whether programs are delivering what they set out to — outcomes achieved against outcomes targeted, alongside participant growth. ' +
      HEALTH_HOW_ITS_BUILT,
    typicalRange: HEALTH_TYPICAL,
  },
  Strategic: {
    title: 'Strategic health',
    definition:
      'Progress against the organization’s own stated goals — goals completed vs. goals set. ' +
      HEALTH_HOW_ITS_BUILT,
    typicalRange: HEALTH_TYPICAL,
  },
};

const METRIC = {
  revenue: {
    title: 'Revenue',
    definition: 'Total money received in the period, across every source (donations, grants, events, and other income).',
    typicalRange:
      'Month-to-month swings are normal for a small nonprofit; a steady upward trend across several months is the healthy pattern to look for.',
  },
  expenses: {
    title: 'Expenses',
    definition: 'Total money spent in the period — program, staff, and overhead costs combined.',
    typicalRange:
      'Expenses generally track revenue over time. Spending consistently above income for several months is what draws down the cash cushion.',
  },
  cash_balance: {
    title: 'Cash balance',
    definition: 'Cash on hand at the end of the period — the buffer available to cover expenses if income pauses.',
    typicalRange:
      'A cushion of three or more months of typical expenses is generally considered a comfortable operating reserve.',
  },
  donors_total: {
    title: 'Total donors',
    definition: 'The number of distinct donors who gave in the period.',
    typicalRange:
      'Gradual growth, or a stable base with good retention, is the healthy pattern; a sustained decline usually shows up here first.',
  },
  'revenue-by-source': {
    title: 'Revenue by source',
    definition:
      'How the latest period’s revenue splits across donations, grants, events, and other income.',
    typicalRange:
      'A more even split is generally more resilient. Any single source above about half of total revenue is often considered concentrated — a risk if that source dips.',
  },
};

const RISK = {
  cash_runway: {
    title: 'Cash runway',
    definition:
      'How many months current cash would cover, at the trailing three-month average expense. Flagged when it falls below three months.',
    typicalRange: 'Three to six months of runway is a common comfort zone; below three months is generally treated as urgent.',
  },
  funding_concentration: {
    title: 'Funding concentration',
    definition:
      'Fires when a single revenue source makes up more than half of total revenue in the latest period.',
    typicalRange: 'Keeping any one source under roughly half of revenue is the general guideline this check is based on.',
  },
  revenue_decline: {
    title: 'Revenue decline',
    definition: 'Fires when revenue falls more than 10% from the previous period to the latest one.',
    typicalRange: 'Small month-to-month dips are normal; a drop past 10% in a single period is what this flags.',
  },
  donor_retention: {
    title: 'Donor retention improving',
    definition:
      'A positive signal: the share of last period’s donors who gave again rose by more than 10 percentage points.',
    typicalRange: 'Retention naturally fluctuates; a jump of more than 10 points period-over-period is a notably good move.',
  },
};

export const METRIC_DEFINITIONS = { health: HEALTH, metric: METRIC, risk: RISK };

/**
 * Resolve the definition entry for a planned card descriptor. Returns null when
 * a card type has no curated copy (nothing is invented).
 */
export function definitionFor(descriptor) {
  if (!descriptor || !descriptor.type) return null;
  const dashIndex = String(descriptor.key).indexOf('-');
  const sub = dashIndex === -1 ? '' : String(descriptor.key).slice(dashIndex + 1);

  switch (descriptor.type) {
    case 'health':
      return HEALTH[descriptor.category] || HEALTH._default;
    case 'kpi':
    case 'trend':
      return METRIC[sub] || null;
    case 'bar':
      return METRIC['revenue-by-source'];
    case 'risk':
      return RISK[sub] || null;
    default:
      return null;
  }
}
