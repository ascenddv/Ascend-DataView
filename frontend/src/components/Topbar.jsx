import { usePreferencesContext } from './PreferencesProvider.jsx';
import { IconMenu, IconSun, IconMoon, IconMonitor } from '../lib/icons.jsx';

const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: IconMonitor, light: IconSun, dark: IconMoon };
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

/**
 * Slim bar above the content area: mobile menu button + section title on the
 * left; a theme quick-cycle (System → Light → Dark) and "sign out of all
 * devices" on the right. The full visual controls live in Settings → Appearance.
 */
export default function Topbar({ title, onMenu, onLogoutAll }) {
  const { theme, setTheme } = usePreferencesContext();
  const ThemeIcon = THEME_ICON[theme] || IconMonitor;

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b py-3"
      style={{
        background: 'var(--surface-2)',
        borderColor: 'var(--border)',
        paddingLeft: 'var(--shell-pad)',
        paddingRight: 'var(--shell-pad)',
      }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="rounded-md p-1 md:hidden"
          style={{ color: 'var(--text-secondary)' }}
        >
          <IconMenu />
        </button>
        <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTheme(NEXT_THEME[theme])}
          aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[NEXT_THEME[theme]]}.`}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface-hover)]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <ThemeIcon size={15} />
          {THEME_LABEL[theme]}
        </button>
        <button
          type="button"
          onClick={onLogoutAll}
          className="hidden text-xs underline sm:inline"
          style={{ color: 'var(--text-muted)' }}
        >
          Sign out of all devices
        </button>
      </div>
    </header>
  );
}
