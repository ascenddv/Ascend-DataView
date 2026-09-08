import { OVERVIEW } from '../cards/registry.js';

/** Horizontal, scrollable tab bar: Overview + one tab per health dimension. */
export default function ViewTabs({ views, active, onChange }) {
  return (
    <nav
      className="mb-5 flex gap-1 overflow-x-auto border-b pb-px"
      style={{ borderColor: 'var(--border)' }}
      aria-label="Dashboard views"
    >
      {views.map((v) => {
        const isActive = v === active;
        const label = v === OVERVIEW ? 'Overview' : v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-current={isActive ? 'page' : undefined}
            className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive ? '' : 'hover:text-[var(--text-primary)]'
            }`}
            style={{
              color: isActive ? 'var(--series-1)' : 'var(--text-muted)',
              borderBottom: `2px solid ${isActive ? 'var(--series-1)' : 'transparent'}`,
              marginBottom: '-1px',
            }}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
