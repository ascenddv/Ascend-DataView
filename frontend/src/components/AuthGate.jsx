import { useCallback, useEffect, useState } from 'react';
import { getMe, logout as apiLogout, logoutAll as apiLogoutAll } from '../lib/api.js';
import AuthPage from './AuthPage.jsx';
import { VerifyEmailPage, ResetPasswordPage } from './AuthTokenPages.jsx';

/**
 * Wraps the app: first handles the two token landing pages (/verify-email and
 * /reset-password, reached from email links — the app has no router, so we read
 * location directly), then resolves the current session once and shows
 * <AuthPage> if there isn't one, otherwise renders children with
 * { user, org, onLogout, onLogoutAll }.
 */
export default function AuthGate({ children }) {
  const [state, setState] = useState({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setState(me ? { status: 'authed', ...me } : { status: 'anon' });
    } catch {
      setState({ status: 'anon' });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onLogout() {
    try {
      await apiLogout();
    } finally {
      setState({ status: 'anon' });
    }
  }

  async function onLogoutAll() {
    try {
      await apiLogoutAll();
    } finally {
      setState({ status: 'anon' });
    }
  }

  // Email-link landing pages, shown regardless of session state.
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const token =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token')
      : null;
  if (path === '/verify-email') return <VerifyEmailPage token={token} />;
  if (path === '/reset-password') return <ResetPasswordPage token={token} />;

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--page)' }}>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      </div>
    );
  }

  if (state.status !== 'authed') {
    return <AuthPage onAuthed={(r) => setState({ status: 'authed', ...r })} />;
  }

  return children({ user: state.user, org: state.org, onLogout, onLogoutAll });
}
