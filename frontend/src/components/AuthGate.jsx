import { useCallback, useEffect, useState } from 'react';
import { getMe, logout as apiLogout, logoutAll as apiLogoutAll } from '../lib/api.js';
import AuthPage from './AuthPage.jsx';

/**
 * Wraps the app: resolves the current session once, shows <AuthPage> if there
 * isn't one, otherwise renders children with { user, org, onLogout }.
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
