import { useState } from 'react';
import { login, signup } from '../lib/api.js';

/** Login / signup screen shown when there is no valid session. */
export default function AuthPage({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === 'login'
          ? await login({ email, password })
          : await signup({ email, password, orgName });
      onAuthed(result);
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
          {mode === 'login' ? 'Sign in to your organization.' : 'Create an organization account.'}
        </p>

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
          <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Password
            <input
              type="password"
              className={field}
              style={{ borderColor: 'var(--border)', background: 'var(--page)', color: 'var(--text-primary)' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>

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
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError(null);
          }}
          className="mt-4 text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          {mode === 'login'
            ? 'Need an account? Create one'
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
