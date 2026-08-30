import { useEffect, useState } from 'react';
import { fetchMetrics, fetchInsight } from '../lib/api.js';
import Dashboard from './Dashboard.jsx';
import DashboardSkeleton from './DashboardSkeleton.jsx';

/**
 * Fetches /api/metrics and /api/insight and hands both to the presentational
 * Dashboard. Metrics render as soon as they arrive; the (slower) AI insight
 * fills in when it resolves, so its latency never blocks the dashboard.
 */
export default function Overview() {
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
      <p className="text-sm" style={{ color: 'var(--status-critical)' }}>
        Couldn’t load metrics: {metricsState.error}
      </p>
    );
  }

  return <Dashboard metrics={metricsState.metrics} insightState={insightState} />;
}
