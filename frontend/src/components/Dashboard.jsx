import { useState } from 'react';
import {
  planCards,
  cardsForView,
  dimensionViews,
  CARD_TYPES,
  OVERVIEW,
} from '../cards/registry.js';
import KpiCard from '../cards/KpiCard.jsx';
import TrendCard from '../cards/TrendCard.jsx';
import BarComparisonCard from '../cards/BarComparisonCard.jsx';
import HealthScoreCard from '../cards/HealthScoreCard.jsx';
import RiskOpportunityCard from '../cards/RiskOpportunityCard.jsx';
import InsightCard from '../cards/InsightCard.jsx';
import ViewTabs from './ViewTabs.jsx';
import { formatPeriodRange } from '../lib/format.js';

const COMPONENT_FOR_TYPE = {
  [CARD_TYPES.HEALTH]: HealthScoreCard,
  [CARD_TYPES.KPI]: KpiCard,
  [CARD_TYPES.TREND]: TrendCard,
  [CARD_TYPES.BAR]: BarComparisonCard,
  [CARD_TYPES.RISK]: RiskOpportunityCard,
};

function CardGrid({ cards }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(({ key, span, type, props }) => {
        const Component = COMPONENT_FOR_TYPE[type];
        return (
          <div key={key} className={span === 2 ? 'sm:col-span-2' : ''}>
            <Component {...props} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Presentational dashboard. Renders the Overview (every card the registry
 * produces — unchanged from before Phase 11) plus a tab per health dimension;
 * a dimension view is a pure filter of the same card list by `category`.
 */
export default function Dashboard({ metrics, insightState = null, initialView = OVERVIEW }) {
  const [view, setView] = useState(initialView);
  const dataset = metrics?.dataset || {};

  const showInsight =
    insightState &&
    (insightState.status === 'loading' ||
      (insightState.status === 'ready' && insightState.insight?.status === 'ok'));

  if (!dataset.periodCount) {
    return (
      <section
        className="rounded-xl border p-10 text-center"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          No data yet
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Upload a CSV to see the dashboard.
        </p>
      </section>
    );
  }

  const views = [OVERVIEW, ...dimensionViews(metrics)];
  const active = views.includes(view) ? view : OVERVIEW;
  const isOverview = active === OVERVIEW;
  const cards = isOverview ? planCards(metrics) : cardsForView(metrics, active);
  const periodLine = `${formatPeriodRange(dataset.periods)} · ${dataset.periodCount} ${
    dataset.granularity === 'monthly' ? 'monthly ' : ''
  }${dataset.periodCount === 1 ? 'period' : 'periods'}`;

  return (
    <section>
      <ViewTabs views={views} active={active} onChange={setView} />

      <header className="mb-4">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {isOverview ? 'Overview' : active}
        </h2>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {periodLine}
        </p>
      </header>

      {isOverview && showInsight && (
        <div className="mb-4">
          <InsightCard
            state={insightState.status === 'ready' ? 'ready' : 'loading'}
            insight={insightState.insight}
          />
        </div>
      )}

      {cards.length > 0 ? (
        <CardGrid cards={cards} />
      ) : (
        <section
          className="rounded-xl border p-10 text-center"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
        >
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Nothing to show for {active} yet
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: 'var(--text-secondary)' }}>
            {metrics.healthScores?.[active]?.reason ||
              `Add ${active}-related fields to your data to populate this view.`}
          </p>
        </section>
      )}
    </section>
  );
}
