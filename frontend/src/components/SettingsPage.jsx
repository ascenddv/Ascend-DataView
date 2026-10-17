import { useState } from 'react';
import TeamPanel from './TeamPanel.jsx';
import DangerZone from './DangerZone.jsx';
import { usePreferencesContext } from './PreferencesProvider.jsx';

function Card({ title, description, children }) {
  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {description}
          </p>
        )}
      </div>
      <div className="px-5 py-2">{children}</div>
    </section>
  );
}

function SettingRow({ title, description, children }) {
  return (
    <div
      className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="max-w-md">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        {description && (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented({ value, onChange, options, ariaLabel }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border p-0.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            style={
              active
                ? { background: 'var(--accent-weak)', color: 'var(--series-1)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
      style={{ background: checked ? 'var(--series-1)' : 'var(--border-strong)' }}
    >
      <span
        className="inline-block h-5 w-5 rounded-full transition-transform"
        style={{ background: '#ffffff', transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

/**
 * Settings, a single page with a sub-nav. Appearance holds the per-browser
 * visual options (theme / density / reduced motion, from PreferencesProvider);
 * Team and Organization host the existing TeamPanel and owner-only DangerZone,
 * relocated here from the bottom of the dashboard.
 */
export default function SettingsPage({ org, currentUser, onReset }) {
  const isOwner = currentUser.role === 'owner';
  const tabs = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'team', label: 'Team' },
    ...(isOwner ? [{ id: 'organization', label: 'Organization' }] : []),
  ];
  const [tab, setTab] = useState('appearance');
  const { theme, setTheme, density, setDensity, reduceMotion, setReduceMotion } =
    usePreferencesContext();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--stack-gap)' }}>
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          Settings
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Appearance is saved on this device. Team and organization changes apply for everyone.
        </p>
      </div>

      <nav
        className="flex gap-1 overflow-x-auto border-b pb-px"
        style={{ borderColor: 'var(--border)' }}
        aria-label="Settings sections"
      >
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? 'page' : undefined}
              className="whitespace-nowrap px-3 py-2 text-sm font-medium"
              style={{
                color: active ? 'var(--series-1)' : 'var(--text-secondary)',
                borderBottom: `2px solid ${active ? 'var(--series-1)' : 'transparent'}`,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'appearance' && (
        <Card
          title="Appearance"
          description="How AscendDV looks in this browser. Nothing here changes your data."
        >
          <SettingRow
            title="Theme"
            description="System follows your device setting. Light and Dark override it."
          >
            <Segmented
              ariaLabel="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </SettingRow>

          <SettingRow
            title="Density"
            description="Compact tightens card padding and grid spacing for more on screen at once."
          >
            <Segmented
              ariaLabel="Density"
              value={density}
              onChange={setDensity}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </SettingRow>

          <SettingRow
            title="Reduce motion"
            description="Minimises animations and transitions. Your device setting is always respected; this forces it on."
          >
            <Switch checked={reduceMotion} onChange={setReduceMotion} label="Reduce motion" />
          </SettingRow>
        </Card>
      )}

      {tab === 'team' && <TeamPanel org={org} currentUser={currentUser} />}

      {tab === 'organization' && isOwner && <DangerZone org={org} onReset={onReset} />}
    </div>
  );
}
