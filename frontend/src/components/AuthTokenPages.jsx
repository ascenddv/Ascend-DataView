import { useEffect, useRef, useState } from 'react';
import { verifyEmail, resetPassword } from '../lib/api.js';

const PASSWORD_MIN = 10;

const Shell = ({ title, children }) => (
  <div className="flex min-h-screen items-center justify-center px-6" style={{ background: 'var(--page)' }}>
    <div
      className="w-full max-w-sm rounded-xl border p-6"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h1>
      {children}
    </div>
  </div>
);

const homeLink = (
  <a href="/" className="mt-4 inline-block text-xs" style={{ color: 'var(--text-muted)' }}>
    ← Back to AscendDV
  </a>
);

/** GET /verify-email?token=… — consumes the token, then sends the user home. */
export function VerifyEmailPage({ token }) {
  const [state, setState] = useState('working'); // working | done | error
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState('error');
      return;
    }
    verifyEmail(token).then(
      () => setState('done'),
      () => setState('error')
    );
  }, [token]);

  return (
    <Shell title="Email verification">
      {state === 'working' && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Confirming your email…</p>
      )}
      {state === 'done' && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Your email is verified. You can now upload data, use AscendAI and invite your team.
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--status-critical)' }}>
          That verification link is invalid or has expired. Sign in and request a new one from the banner at the top of the app.
        </p>
      )}
      {homeLink}
    </Shell>
  );
}

/** GET /reset-password?token=… — form to set a new password. */
export function ResetPasswordPage({ token }) {
  const [password, setPassword] = useState('');
  const [state, setState] = useState('form'); // form | working | done | error
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setState('working');
    try {
      await resetPassword(token, password);
      setState('done');
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  }

  if (!token) {
    return (
      <Shell title="Reset password">
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--status-critical)' }}>
          This reset link is missing its token. Request a new one from the sign-in screen.
        </p>
        {homeLink}
      </Shell>
    );
  }

  if (state === 'done') {
    return (
      <Shell title="Reset password">
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Your password has been changed and every existing session was signed out. Sign in with your new password.
        </p>
        <a
          href="/"
          className="mt-4 inline-block rounded-lg px-3 py-2 text-sm font-semibold text-white"
          style={{ background: 'var(--series-1)' }}
        >
          Go to sign in
        </a>
      </Shell>
    );
  }

  return (
    <Shell title="Reset password">
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          New password
          <input
            type="password"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--page)', color: 'var(--text-primary)' }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={PASSWORD_MIN}
            required
          />
        </label>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          At least {PASSWORD_MIN} characters. Passwords found in known breaches are rejected.
        </p>
        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>{error}</p>
        )}
        <button
          type="submit"
          disabled={state === 'working'}
          className="w-full rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--series-1)' }}
        >
          {state === 'working' ? 'Working…' : 'Set new password'}
        </button>
      </form>
      {homeLink}
    </Shell>
  );
}
