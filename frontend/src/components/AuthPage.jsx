import { useState } from 'react';
import { login, signup, forgotPassword } from '../lib/api.js';

/** Login / signup / forgot-password screen shown when there is no valid session. */
export default function AuthPage({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [acceptTos, setAcceptTos] = useState(false);

  function switchMode(next) {
    setMode(next);
    setError(null);
    setForgotSent(false);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await forgotPassword(email);
        setForgotSent(true);
      } else {
        const result =
          mode === 'login'
            ? await login({ email, password })
            : await signup({ email, password, orgName, acceptTos });
        onAuthed(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const field =
    'mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none';

  return (
    <div
      className="flex min-h-screen items-center justify-center px-6"
      style={{ background: 'var(--page)' }}
    >
      <div
        className="w-full max-w-sm rounded-xl border p-6"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          AscendDV
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {mode === 'login'
            ? 'Sign in to your organization.'
            : mode === 'signup'
              ? 'Create an organization account.'
              : 'We’ll email you a link to set a new password.'}
        </p>

        {mode === 'forgot' && forgotSent ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              If an account exists for that email, a password reset link is on its way. The link
              expires in an hour.
            </p>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              ← Back to sign in
            </button>
          </div>
        ) : (
        <form onSubmit={submit} className="mt-5 space-y-3">
          {mode === 'signup' && (
            <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Organization name
              <input
                className={field}
                style={{ borderColor: 'var(--border)', background: 'var(--page)', color: 'var(--text-primary)' }}
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            </label>
          )}
          <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Email
            <input
              type="email"
              className={field}
              style={{ borderColor: 'var(--border)', background: 'var(--page)', color: 'var(--text-primary)' }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          {mode !== 'forgot' && (
            <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Password
              <input
                type="password"
                className={field}
                style={{ borderColor: 'var(--border)', background: 'var(--page)', color: 'var(--text-primary)' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={mode === 'signup' ? 10 : undefined}
                required
              />
              {mode === 'signup' && (
                <span className="mt-1 block font-normal" style={{ color: 'var(--text-muted)' }}>
                  At least 10 characters. Breached passwords are rejected.
                </span>
              )}
            </label>
          )}

          {mode === 'login' && (
            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              Forgot password?
            </button>
          )}

          {mode === 'signup' && (
            <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                required
                checked={acceptTos}
                onChange={(e) => setAcceptTos(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I agree to the{' '}
                <a href="/legal/terms" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/legal/privacy" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                  Privacy Policy
                </a>
                . We use one first-party session cookie to keep you signed in.
              </span>
            </label>
          )}

          {error && (
            <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--series-1)' }}
          >
            {busy
              ? 'Working…'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Email me a reset link'}
          </button>
        </form>
        )}

        {mode !== 'forgot' && (
          <button
            type="button"
            onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
            className="mt-4 text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            {mode === 'login'
              ? 'Need an account? Create one'
              : 'Already have an account? Sign in'}
          </button>
        )}

        <p className="mt-6 border-t pt-3 text-center text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <a href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</a>
          {' · '}
          <a href="/legal/privacy" style={{ textDecoration: 'underline' }}>Privacy</a>
        </p>
      </div>
    </div>
  );
}
