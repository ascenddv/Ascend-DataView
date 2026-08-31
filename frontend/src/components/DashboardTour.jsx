import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { METRIC_DEFINITIONS } from '../lib/metricDefinitions.js';

/**
 * Interactive walkthrough of the populated Overview (Phase 17). Each step
 * highlights a real section of the user's own dashboard and explains it with
 * copy pulled from metricDefinitions.js — the same source the (i) tooltips use,
 * never a second copy. Purely structural "where you are" lines (the tabs step,
 * the closing step) are the only text authored here.
 *
 * Triggered automatically after the first ingestion, and on demand from
 * "Take a tour". Closing it (finish or skip) is what the caller turns into
 * onboarding_completed.
 */
function buildSteps(metrics) {
  const cards = metrics?.cards || {};
  const health = metrics?.healthScores || {};
  const anyHealth = Object.values(health).some((h) => h && h.status === 'Available');
  const firstRisk = (metrics?.risksOpportunities || [])[0];
  const steps = [];

  if (anyHealth) {
    steps.push({ anchor: 'health', title: 'Health scores', body: METRIC_DEFINITIONS.health._default });
  }
  if ((metrics?.kpis || []).length) {
    steps.push({ anchor: 'kpi', title: 'Key figures', body: METRIC_DEFINITIONS.metric.revenue });
  }
  if (cards.BarComparison === 'Available' && (metrics?.revenueByCategory || []).length >= 2) {
    steps.push({
      anchor: 'bar',
      title: 'Revenue by source',
      body: METRIC_DEFINITIONS.metric['revenue-by-source'],
    });
  }
  if (firstRisk && METRIC_DEFINITIONS.risk[firstRisk.key]) {
    steps.push({
      anchor: 'risk',
      title: 'Risks & opportunities',
      body: METRIC_DEFINITIONS.risk[firstRisk.key],
    });
  }
  steps.push({
    anchor: 'tabs',
    title: 'One area at a time',
    note: 'Switch tabs to focus on a single area of your organization — the same cards, filtered to that dimension.',
  });
  steps.push({
    anchor: null,
    title: 'You’re set',
    note: 'That’s the tour. You can replay it any time with “Take a tour” at the top of the dashboard.',
  });
  return steps;
}

export default function DashboardTour({ metrics, onClose }) {
  const steps = useMemo(() => buildSteps(metrics), [metrics]);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);

  const clamped = Math.min(idx, steps.length - 1);
  const step = steps[clamped];
  const anchor = step ? step.anchor : null;

  // Position against the anchored element. Deps are primitives (anchor, idx) so
  // this settles in one pass — no render loop.
  useLayoutEffect(() => {
    if (!anchor || typeof document === 'undefined') {
      setRect(null);
      return undefined;
    }
    const measure = () => {
      const el = document.querySelector(`[data-tour="${anchor}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      );
    };
    const el = document.querySelector(`[data-tour="${anchor}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    measure();
    const t = setTimeout(measure, 350); // re-measure after the smooth scroll settles
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchor, idx]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!step) return null;

  const last = clamped >= steps.length - 1;
  const hasViewport = typeof window !== 'undefined';
  const cardStyle =
    rect && hasViewport
      ? {
          position: 'fixed',
          top: Math.max(12, Math.min(rect.top + rect.height + 8, window.innerHeight - 240)),
          left: Math.max(12, Math.min(rect.left, window.innerWidth - 344)),
          width: 320,
        }
      : {
          position: 'fixed',
          top: '50%',
          left: '50%',
          width: 340,
          transform: 'translate(-50%, -50%)',
        };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Dashboard tour">
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-xl"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
            outline: '2px solid var(--series-1)',
          }}
        />
      ) : (
        <div className="fixed inset-0" style={{ background: 'rgba(15, 23, 42, 0.55)' }} />
      )}

      <div
        className="rounded-xl border p-4 shadow-xl"
        style={{ ...cardStyle, background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            {clamped + 1} / {steps.length}
          </span>
          <button type="button" onClick={onClose} className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Skip tour
          </button>
        </div>

        <h3 className="mt-2 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          {step.title}
        </h3>

        {step.body ? (
          <>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {step.body.definition}
            </p>
            {step.body.typicalRange && (
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span className="font-semibold">Typically: </span>
                {step.body.typicalRange}
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {step.note}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIdx((n) => Math.max(0, n - 1))}
            disabled={clamped === 0}
            className="text-sm disabled:opacity-40"
            style={{ color: 'var(--text-muted)' }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => (last ? onClose() : setIdx((n) => n + 1))}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
            style={{ background: 'var(--series-1)' }}
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
