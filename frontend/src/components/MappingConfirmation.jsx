import { useMemo, useState } from 'react';
import { confirmUpload } from '../lib/api.js';

/**
 * Pre-storage column-mapping confirmation (Phase 14b).
 *
 * Shown when POST /api/upload comes back with `needsConfirmation`. The parsed
 * file is held server-side and NOTHING is stored until the user confirms or
 * corrects each low-confidence mapping here. Correcting a row changes what
 * actually gets stored — the corrected field, not the original guess.
 */
export default function MappingConfirmation({ pending, onConfirmed, onCancel }) {
  const flagged = pending.fieldsNeedingConfirmation || [];
  const [corrections, setCorrections] = useState(() =>
    Object.fromEntries(flagged.map((f) => [f.header, f.field]))
  );
  const [status, setStatus] = useState({ kind: 'idle' });

  const grouped = useMemo(() => {
    const by = new Map();
    for (const f of pending.schemaFields || []) {
      const key = f.category || 'Other';
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(f);
    }
    return [...by.entries()];
  }, [pending.schemaFields]);

  function setChoice(header, value) {
    setCorrections((prev) => ({ ...prev, [header]: value || null }));
  }

  async function submit() {
    setStatus({ kind: 'busy' });
    try {
      const result = await confirmUpload(pending.pendingId, corrections);
      onConfirmed(result);
    } catch (err) {
      setStatus({ kind: 'error', message: err.message });
    }
  }

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: 'var(--status-warning)', background: 'var(--surface-1)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        Confirm {flagged.length} column {flagged.length === 1 ? 'match' : 'matches'} before saving
      </h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
        We matched these columns in <b>{pending.filename}</b> by name similarity, not exactly.
        Check each one — nothing from this file is stored until you confirm.
      </p>

      <div className="mt-4 space-y-3">
        {flagged.map((f) => (
          <div
            key={f.header}
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            style={{ borderColor: 'var(--border)' }}
          >
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                “{f.header}”
              </div>
              {f.samples && f.samples.length > 0 && (
                <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  e.g. {f.samples.join(' · ')}
                </div>
              )}
              <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                our guess: {f.field} ({Math.round(f.confidence * 100)}% sure)
              </div>
            </div>
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span className="sr-only">Field for {f.header}</span>
              <select
                value={corrections[f.header] || ''}
                onChange={(e) => setChoice(f.header, e.target.value)}
                className="w-full rounded-lg border px-2.5 py-1.5 text-sm sm:w-64"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--page)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="">— Ignore this column —</option>
                {grouped.map(([cat, fields]) => (
                  <optgroup key={cat} label={cat}>
                    {fields.map((sf) => (
                      <option key={sf.name} value={sf.name}>
                        {sf.name}
                        {sf.required ? ' (required)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
        ))}
      </div>

      {status.kind === 'error' && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>
          {status.message}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={status.kind === 'busy'}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--series-1)' }}
        >
          {status.kind === 'busy' ? 'Saving…' : 'Confirm and save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={status.kind === 'busy'}
          className="text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
