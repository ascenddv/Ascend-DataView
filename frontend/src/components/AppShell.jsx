import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

const SECTION_TITLES = { dashboard: 'Dashboard', data: 'Data', settings: 'Settings' };

/**
 * Persistent app chrome: a fixed left sidebar on md+, an off-canvas drawer
 * below that, and a slim top bar over the scrolling content column. Purely
 * layout, every section's content is passed in as `children`.
 */
export default function AppShell({
  user,
  org,
  section,
  onSection,
  onLogout,
  onLogoutAll,
  banner = null,
  children,
}) {
  const [navOpen, setNavOpen] = useState(false);
  const go = (s) => {
    onSection(s);
    setNavOpen(false);
  };

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--page)' }}>
      <aside className="hidden shrink-0 md:block" style={{ width: 'var(--sidebar-w)' }}>
        <div className="fixed inset-y-0 left-0" style={{ width: 'var(--sidebar-w)' }}>
          <Sidebar section={section} onSection={go} user={user} org={org} onLogout={onLogout} />
        </div>
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="adv-fade-in absolute inset-0"
            style={{ background: 'rgba(0, 0, 0, 0.45)' }}
            onClick={() => setNavOpen(false)}
          />
          <div
            className="adv-slide-in-left absolute inset-y-0 left-0"
            style={{ width: 'var(--sidebar-w)', boxShadow: 'var(--shadow-lg)' }}
          >
            <Sidebar
              section={section}
              onSection={go}
              user={user}
              org={org}
              onLogout={onLogout}
              onClose={() => setNavOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={SECTION_TITLES[section] || 'Dashboard'}
          onMenu={() => setNavOpen(true)}
          onLogoutAll={onLogoutAll}
        />

        {banner && (
          <div style={{ paddingLeft: 'var(--shell-pad)', paddingRight: 'var(--shell-pad)', paddingTop: 16 }}>
            <div className="mx-auto w-full max-w-6xl">{banner}</div>
          </div>
        )}

        <main
          className="flex-1 py-6"
          style={{ paddingLeft: 'var(--shell-pad)', paddingRight: 'var(--shell-pad)' }}
        >
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>

        <footer
          className="pb-6 pt-2 text-center text-xs"
          style={{
            paddingLeft: 'var(--shell-pad)',
            paddingRight: 'var(--shell-pad)',
            color: 'var(--text-muted)',
          }}
        >
          <a href="/legal/terms" style={{ textDecoration: 'underline' }}>
            Terms
          </a>
          {' · '}
          <a href="/legal/privacy" style={{ textDecoration: 'underline' }}>
            Privacy
          </a>
        </footer>
      </div>
    </div>
  );
}
