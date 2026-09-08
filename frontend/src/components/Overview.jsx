import { useEffect, useState } from 'react';
import { fetchMetrics, fetchInsight } from '../lib/api.js';
import Dashboard from './Dashboard.jsx';
import DashboardSkeleton from './DashboardSkeleton.jsx';
import EmptyState from './ui/EmptyState.jsx';
import { Button } from './ui/primitives.jsx';

/**
 * Fetches /api/metrics and /api/insight and hands both to the presentational
 * Dashboard. Metrics render as soon as they arrive; the (slower) AI insight
 * fills in when it resolves, so its latency never blocks the dashboard.
 */
export default function Overview({ autoStartTour = false, onTourDone }) {
  const [metricsState, setMetricsState] = useState({ status: 'loading' });
  const [insightState, setInsightState] = useState({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetchMetrics(controller.signal)
      .then((metrics) => setMetricsState({ status: 'ready', metrics }))
      .catch((err) => {
        if (err.name !== 'AbortError') setMetricsState({ status: 'error', error: err.message });
      });

    fetchInsight(controller.signal)
      .then((insight) => setInsightState({ status: 'ready', insight }))
      .catch((err) => {
        if (err.name !== 'AbortError') setInsightState({ status: 'error', error: err.message });
      });

    return () => controller.abort();
  }, []);

  if (metricsState.status === 'loading') {
    return <DashboardSkeleton />;
  }

  if (metricsState.status === 'error') {
    return (
      <EmptyState
        title="Couldn’t load the dashboard"
        action={
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        }
      >
        {metricsState.error}
      </EmptyState>
    );
  }

  return (
    <Dashboard
      metrics={metricsState.metrics}
      insightState={insightState}
      autoStartTour={autoStartTour}
      onTourDone={onTourDone}
    />
  );
}
