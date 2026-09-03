import React from 'react';

/**
 * Catches any render/lifecycle error below it and shows a calm recovery card
 * instead of a white screen. Reports to Sentry if the SDK loaded (window.Sentry
 * — added via a script tag when SENTRY_DSN is configured); always logs a stable
 * "UI_ERROR_BOUNDARY" line so it's greppable.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('UI_ERROR_BOUNDARY', error && error.message, info && info.componentStack);
    if (typeof window !== 'undefined' && window.Sentry && typeof window.Sentry.captureException === 'function') {
      try {
        window.Sentry.captureException(error, { extra: { componentStack: info && info.componentStack } });
      } catch {
        /* reporting must never throw */
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        style={{ background: 'var(--page)' }}
      >
        <div
          className="w-full max-w-md rounded-xl border p-6 text-center"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
        >
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Something went wrong
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            The page hit an unexpected error. Reloading usually fixes it. If it keeps happening,
            your data is safe — nothing was lost.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: 'var(--series-1)' }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
