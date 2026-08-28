import { useEffect, useState } from 'react';

/**
 * Phase 1 connectivity proof: calls GET /api/health and reports the result.
 */
export default function HealthCheck() {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', error: err.message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const tone =
    state.status === 'ready'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : state.status === 'error'
        ? 'border-rose-300 bg-rose-50 text-rose-900'
        : 'border-slate-300 bg-slate-50 text-slate-600';

  return (
    <div className={`rounded-xl border p-5 ${tone}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide">
        Backend connection
      </h2>

      {state.status === 'loading' && (
        <p className="mt-2 text-sm">Contacting /api/health…</p>
      )}

      {state.status === 'ready' && (
        <>
          <p className="mt-2 text-sm">
            Connected. <code>GET /api/health</code> responded:
          </p>
          <pre className="mt-3 rounded-lg bg-white/70 p-3 text-xs">
            {JSON.stringify(state.data, null, 2)}
          </pre>
        </>
      )}

      {state.status === 'error' && (
        <p className="mt-2 text-sm">
          Could not reach the backend: {state.error}. Is it running on port 3001?
        </p>
      )}
    </div>
  );
}
