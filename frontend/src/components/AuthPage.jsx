import { useState } from 'react';
import { login, signup, forgotPassword } from '../lib/api.js';
import Logo from './Logo.jsx';
import { Button, Input, Field } from './ui/primitives.jsx';

/** Login / signup / forgot-password screen shown when there is no valid session. */
function initialMode() {
  if (typeof window === 'undefined') return 'login';
  return new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'login';
}

export default function AuthPage({ onAuthed }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'signup' | 'forgot'
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

  return (
    <div
      className="flex min-h-screen items-center justify-center px-6"
      style={{ background: 'var(--page)' }}
    >
      <div
        className="adv-scale-in w-full max-w-sm border p-7"
        style={{
          background: 'var(--surface-2)',
          borderColor: 'var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <h1>
          <Logo size={26} />
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
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
            <Field label="Organization name">
              <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
            </Field>
          )}
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          {mode !== 'forgot' && (
            <Field
              label="Password"
              hint={mode === 'signup' ? 'At least 10 characters. Breached passwords are rejected.' : undefined}
            >
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={mode === 'signup' ? 10 : undefined}
                required
              />
            </Field>
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

          <Button type="submit" disabled={busy} size="lg" className="w-full">
            {busy
              ? 'Working…'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Email me a reset link'}
          </Button>
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
