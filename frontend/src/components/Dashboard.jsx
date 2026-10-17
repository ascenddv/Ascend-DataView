import { Suspense, lazy, useEffect, useState } from 'react';
import {
  planCards,
  cardsForView,
  dimensionViews,
  CARD_TYPES,
  OVERVIEW,
} from '../cards/registry.js';
import KpiCard from '../cards/KpiCard.jsx';
import HealthScoreCard from '../cards/HealthScoreCard.jsx';
import RiskOpportunityCard from '../cards/RiskOpportunityCard.jsx';
import InsightCard from '../cards/InsightCard.jsx';
import ViewTabs from './ViewTabs.jsx';
import PdfExportButton from './PdfExportButton.jsx';
import EmptyState from './ui/EmptyState.jsx';
import { Button } from './ui/primitives.jsx';
import { formatPeriodRange } from '../lib/format.js';

// Recharts is the single heaviest dependency; the two cards that use it and the
// guided tour are split into their own chunks so the initial load doesn't carry
// them. Suspense fallbacks keep the layout stable while a chunk arrives.
const TrendCard = lazy(() => import('../cards/TrendCard.jsx'));
const BarComparisonCard = lazy(() => import('../cards/BarComparisonCard.jsx'));
const DashboardTour = lazy(() => import('./DashboardTour.jsx'));

const COMPONENT_FOR_TYPE = {
  [CARD_TYPES.HEALTH]: HealthScoreCard,
  [CARD_TYPES.KPI]: KpiCard,
  [CARD_TYPES.TREND]: TrendCard,
  [CARD_TYPES.BAR]: BarComparisonCard,
  [CARD_TYPES.RISK]: RiskOpportunityCard,
};

function CardGridInner({ cards }) {
  const firstOfType = {};
  for (const c of cards) if (!(c.type in firstOfType)) firstOfType[c.type] = c.key;

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      style={{ gap: 'var(--grid-gap)' }}
    >
      {cards.map(({ key, span, type, props }) => {
        const Component = COMPONENT_FOR_TYPE[type];
        // The tour highlights the first card of each type.
        const tourAnchor = firstOfType[type] === key ? type : undefined;
        return (
          <div key={key} className={span === 2 ? 'sm:col-span-2' : ''} data-tour={tourAnchor}>
            <Component {...props} />
          </div>
        );
      })}
    </div>
  );
}

function CardGrid({ cards }) {
  return (
    <Suspense
      fallback={
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          style={{ gap: 'var(--grid-gap)' }}
          aria-hidden="true"
        >
          {cards.map(({ key, span }) => (
            <div
              key={key}
              className={`adv-skeleton h-40 ${span === 2 ? 'sm:col-span-2' : ''}`}
              style={{ borderRadius: 'var(--radius-lg)' }}
            />
          ))}
        </div>
      }
    >
      <CardGridInner cards={cards} />
    </Suspense>
  );
}

/**
 * Presentational dashboard. Renders the Overview (every card the registry
 * produces, unchanged from before Phase 11) plus a tab per health dimension;
 * a dimension view is a pure filter of the same card list by `category`.
 */
export default function Dashboard({
  metrics,
  insightState = null,
  initialView = OVERVIEW,
  autoStartTour = false,
  onTourDone,
}) {
  const [view, setView] = useState(initialView);
  const [showTour, setShowTour] = useState(false);
  const dataset = metrics?.dataset || {};

  useEffect(() => {
    if (autoStartTour && dataset.periodCount) setShowTour(true);
  }, [autoStartTour, dataset.periodCount]);

  function closeTour() {
    setShowTour(false);
    if (onTourDone) onTourDone();
  }

  const showInsight =
    insightState &&
    (insightState.status === 'loading' ||
      (insightState.status === 'ready' && insightState.insight?.status === 'ok'));

  if (!dataset.periodCount) {
    return (
      <EmptyState
        title="No data yet"
        action={
          <Button as="a" href="#/data" size="sm">
            Add data
          </Button>
        }
      >
        Upload a CSV and AscendDV builds the dashboard from whatever it can measure.
      </EmptyState>
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
      <div data-tour="tabs">
        <ViewTabs views={views} active={active} onChange={setView} />
      </div>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {isOverview ? 'Overview' : active}
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {periodLine}
          </p>
        </div>
        {isOverview && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowTour(true)}
              className="whitespace-nowrap"
            >
              Take a tour
            </Button>
            <PdfExportButton />
          </div>
        )}
      </header>

      {showTour && (
        <Suspense fallback={null}>
          <DashboardTour metrics={metrics} onClose={closeTour} />
        </Suspense>
      )}

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
        <EmptyState title={`Nothing to show for ${active} yet`}>
          {metrics.healthScores?.[active]?.reason ||
            `Add ${active}-related fields to your data to populate this view.`}
        </EmptyState>
      )}
    </section>
  );
}
