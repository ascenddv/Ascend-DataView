import { useCallback, useEffect, useState } from 'react';
import { getMe, logout as apiLogout, logoutAll as apiLogoutAll } from '../lib/api.js';
import AuthPage from './AuthPage.jsx';
import { VerifyEmailPage, ResetPasswordPage, AcceptInvitePage } from './AuthTokenPages.jsx';
import { TermsPage, PrivacyPage } from './LegalPages.jsx';
import LandingPage from './LandingPage.jsx';
import Logo from './Logo.jsx';

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
  if (path === '/accept-invite') return <AcceptInvitePage token={token} />;
  if (path === '/legal/terms') return <TermsPage />;
  if (path === '/legal/privacy') return <PrivacyPage />;

  if (state.status === 'loading') {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3"
        style={{ background: 'var(--page)' }}
      >
        <span className="adv-pulse">
          <Logo variant="glyph" size={40} />
        </span>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      </div>
    );
  }

  if (state.status !== 'authed') {
    // Logged-out visitors land on the marketing page at "/"; every other path
    // (notably /login and /login?mode=signup) goes straight to the auth card.
    if (path === '/') return <LandingPage />;
    return (
      <AuthPage
        onAuthed={(r) => {
          if (typeof window !== 'undefined' && window.location.pathname !== '/') {
            window.history.replaceState(null, '', '/');
          }
          setState({ status: 'authed', ...r });
        }}
      />
    );
  }

  return children({ user: state.user, org: state.org, onLogout, onLogoutAll });
}
