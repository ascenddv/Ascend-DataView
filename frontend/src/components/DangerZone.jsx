import { useState } from 'react';
import { resetOrgData, exportAccount, deleteOrganization } from '../lib/api.js';

/**
 * Low-prominence, collapsed-by-default "danger zone" (owner-only — App gates it).
 * Three actions, most to least reversible:
 *   - Export: a full JSON download of the org's data.
 *   - Reset data: wipe every stored period (a normal upload merges, never replaces).
 *   - Delete organization: remove the org and every user, dataset and record.
 * Reset and Delete each require typing the exact org name; the server re-checks it.
 */
export default function DangerZone({ org, onReset }) {
  const [open, setOpen] = useState(false);

  const [resetTyped, setResetTyped] = useState('');
  const [resetStatus, setResetStatus] = useState({ kind: 'idle' });
  const resetArmed = resetTyped.trim() === org.name && resetStatus.kind !== 'busy';

  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteStatus, setDeleteStatus] = useState({ kind: 'idle' });
  const deleteArmed = deleteTyped.trim() === org.name && deleteStatus.kind !== 'busy';

  const [exportStatus, setExportStatus] = useState({ kind: 'idle' });

  async function doExport() {
    setExportStatus({ kind: 'busy' });
    try {
      const { blob, filename } = await exportAccount();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportStatus({ kind: 'done' });
    } catch (err) {
      setExportStatus({ kind: 'error', message: err.message });
    }
  }

  async function doReset() {
    setResetStatus({ kind: 'busy' });
    try {
      const res = await resetOrgData(org.id, resetTyped.trim());
      setResetStatus({ kind: 'done', deleted: res.deleted });
      setResetTyped('');
      onReset(res);
    } catch (err) {
      setResetStatus({ kind: 'error', message: err.message });
    }
  }

  async function doDelete() {
    setDeleteStatus({ kind: 'busy' });
    try {
      await deleteOrganization(org.id, deleteTyped.trim());
      // The session cookie is gone — land on the app, which shows sign-in.
      window.location.href = '/';
    } catch (err) {
      setDeleteStatus({ kind: 'error', message: err.message });
    }
  }

  const confirmInput = (value, onChange) => (
    <input
      className="mt-1 w-full max-w-sm rounded-lg border px-3 py-2 text-sm outline-none"
      style={{ borderColor: 'var(--border)', background: 'var(--page)', color: 'var(--text-primary)' }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={org.name}
    />
  );

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
        <div className="mt-4 space-y-4">
          {/* Export */}
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Export organization data
            </h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Downloads a JSON file with {org.name}’s organization details, members, stored
              periods, AscendAI history and usage, and pending invitations. No passwords.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={doExport}
                disabled={exportStatus.kind === 'busy'}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                {exportStatus.kind === 'busy' ? 'Preparing…' : 'Download export'}
              </button>
              {exportStatus.kind === 'error' && (
                <span role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
                  {exportStatus.message}
                </span>
              )}
            </div>
          </div>

          {/* Reset data */}
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--status-critical)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Reset all data for {org.name}
            </h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Permanently deletes every period this organization has stored. Uploads and
              manual entries after this start from an empty history. This cannot be undone.
            </p>
            <label className="mt-3 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Type <b>{org.name}</b> to confirm
              {confirmInput(resetTyped, setResetTyped)}
            </label>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                disabled={!resetArmed}
                onClick={doReset}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: 'var(--status-critical)' }}
              >
                {resetStatus.kind === 'busy' ? 'Resetting…' : 'Reset data'}
              </button>
              {resetStatus.kind === 'done' && (
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Deleted {resetStatus.deleted} period{resetStatus.deleted === 1 ? '' : 's'}.
                </span>
              )}
              {resetStatus.kind === 'error' && (
                <span role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
                  {resetStatus.message}
                </span>
              )}
            </div>
          </div>

          {/* Delete organization */}
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--status-critical)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Delete {org.name}
            </h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Permanently removes this organization and <b>every</b> user, dataset, AscendAI
              conversation and pending invitation. Everyone is signed out. This cannot be undone.
            </p>
            <label className="mt-3 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Type <b>{org.name}</b> to confirm
              {confirmInput(deleteTyped, setDeleteTyped)}
            </label>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                disabled={!deleteArmed}
                onClick={doDelete}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: 'var(--status-critical)' }}
              >
                {deleteStatus.kind === 'busy' ? 'Deleting…' : 'Delete organization'}
              </button>
              {deleteStatus.kind === 'error' && (
                <span role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
                  {deleteStatus.message}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
