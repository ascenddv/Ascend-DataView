import { useState } from 'react';
import { resetOrgData } from '../lib/api.js';

/**
 * Low-prominence, collapsed-by-default "danger zone". The only path to wiping an
 * org's dataset — a normal upload merges, it never replaces. Requires typing the
 * exact org name before the reset button enables, and the server re-checks it.
 */
export default function DangerZone({ org, onReset }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState({ kind: 'idle' });

  const armed = typed.trim() === org.name && status.kind !== 'busy';

  async function doReset() {
    setStatus({ kind: 'busy' });
    try {
      const res = await resetOrgData(org.id, typed.trim());
      setStatus({ kind: 'done', deleted: res.deleted });
      setTyped('');
      onReset(res);
    } catch (err) {
      setStatus({ kind: 'error', message: err.message });
    }
  }

  return (
    <section
      className="mt-10 rounded-xl border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-medium"
        style={{ color: 'var(--text-secondary)' }}
      >
        {open ? '▾' : '▸'} Danger zone
      </button>

      {open && (
        <div className="mt-4 rounded-lg border p-4" style={{ borderColor: 'var(--status-critical)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Reset all data for {org.name}
          </h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Permanently deletes every period this organization has stored. Uploads and
            manual entries after this start from an empty history. This cannot be undone
            and only affects <b>{org.name}</b>.
          </p>

          <label
            className="mt-3 block text-xs font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            Type <b>{org.name}</b> to confirm
            <input
              className="mt-1 w-full max-w-sm rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--page)',
                color: 'var(--text-primary)',
              }}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={org.name}
            />
          </label>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={!armed}
              onClick={doReset}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: 'var(--status-critical)' }}
            >
              {status.kind === 'busy' ? 'Resetting…' : 'Reset data'}
            </button>
            {status.kind === 'done' && (
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Deleted {status.deleted} period{status.deleted === 1 ? '' : 's'}.
              </span>
            )}
            {status.kind === 'error' && (
              <span role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
                {status.message}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
