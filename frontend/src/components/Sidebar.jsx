import {
  IconDashboard,
  IconData,
  IconSettings,
  IconSparkles,
  IconLogOut,
  IconClose,
} from '../lib/icons.jsx';
import Logo from './Logo.jsx';
import { openAscendAi } from '../lib/ascendai-bus.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'data', label: 'Data', Icon: IconData },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
];

function NavButton({ active, onClick, children, ariaCurrent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ariaCurrent}
      className={`relative flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm font-medium transition-[background-color,color] duration-[140ms] ${
        active ? '' : 'hover:bg-[var(--surface-hover)]'
      }`}
      style={
        active
          ? { background: 'var(--accent-weak)', color: 'var(--accent)' }
          : { color: 'var(--text-secondary)' }
      }
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full"
          style={{ background: 'var(--accent)' }}
        />
      )}
      {children}
    </button>
  );
}

/**
 * Persistent left navigation. Grouped, small-caps section labels; the active
 * item gets a soft accent wash. Rendered both as the fixed desktop rail and
 * inside the mobile drawer (which passes `onClose`).
 */
export default function Sidebar({ section, onSection, user, org, onLogout, onClose }) {
  return (
    <nav
      aria-label="Primary"
      className="flex h-full min-h-screen w-full flex-col border-r"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between px-5 pb-1 pt-5">
        <Logo size={24} />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-md p-1 md:hidden"
            style={{ color: 'var(--text-muted)' }}
          >
            <IconClose size={18} />
          </button>
        )}
      </div>

      <div className="px-3 pt-4">
        <p
          className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          General
        </p>
        <ul className="space-y-0.5">
          {NAV.map(({ id, label, Icon }) => (
            <li key={id}>
              <NavButton
                active={section === id}
                ariaCurrent={section === id ? 'page' : undefined}
                onClick={() => onSection(id)}
              >
                <Icon size={17} />
                {label}
              </NavButton>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-3 pt-4">
        <p
          className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Assistant
        </p>
        <NavButton
          active={false}
          onClick={() => {
            openAscendAi();
            if (onClose) onClose();
          }}
        >
          <IconSparkles size={17} />
          Ask AscendAI
        </NavButton>
      </div>

      <div className="mt-auto px-3 pb-4">
        <div className="mb-2 rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <p className="truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {org.name}
          </p>
          <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            {user.email}
          </p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium hover:bg-[var(--surface-hover)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <IconLogOut size={16} />
          Sign out
        </button>
      </div>
    </nav>
  );
}
