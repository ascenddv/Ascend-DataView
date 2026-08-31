import { useEffect, useState } from 'react';
import { submitManualEntry } from '../lib/api.js';

/**
 * Add one period by hand. The field list comes from GET /api/schema (never a
 * second copy of the canonical dictionary). Values are sent as-is — the backend
 * runs them through the same normalization as a CSV cell, so "$12,400" works.
 */
export default function ManualEntry({ onEntered }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(null);
  const [values, setValues] = useState({});
  const [status, setStatus] = useState({ kind: 'idle' });

  useEffect(() => {
    if (!open || fields) return;
    fetch('/api/schema', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setFields(d.fields))
      .catch(() => setStatus({ kind: 'error', message: 'Could not load the field list.' }));
  }, [open, fields]);

  function set(name, v) {
    setValues((prev) => ({ ...prev, [name]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    setStatus({ kind: 'busy' });
    const payload = Object.fromEntries(
      Object.entries(values).filter(([, v]) => String(v).trim() !== '')
    );
    try {
      const result = await submitManualEntry(payload);
      setStatus({
        kind: 'done',
        period: result.period,
        verb: result.periodsUpdated ? 'Updated' : 'Added',
        warnings: result.warnings || [],
      });
      setValues({});
      onEntered(result);
    } catch (err) {
      setStatus({ kind: 'error', message: err.message });
    }
  }

  const required = (fields || []).filter((f) => f.required);
  const optional = (fields || []).filter((f) => !f.required);
  const byCategory = {};
  for (const f of optional) (byCategory[f.category] ||= []).push(f);

  const input =
    'mt-1 w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none';
  const inputStyle = {
    borderColor: 'var(--border)',
    background: 'var(--page)',
    color: 'var(--text-primary)',
  };

  return (
    <section
      className="rounded-xl border p-4"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-medium"
        style={{ color: 'var(--text-primary)' }}
      >
        {open ? '▾' : '▸'} Add a single period manually
      </button>

      {open && !fields && (
        <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading fields…
        </p>
      )}

      {open && fields && (
        <form onSubmit={submit} className="mt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {required.map((f) => (
              <label key={f.name} className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                {f.name} <span style={{ color: 'var(--status-critical)' }}>*</span>
                <input
                  className={input}
                  style={inputStyle}
                  placeholder={f.type === 'date' ? 'YYYY-MM-DD' : ''}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  required
                />
              </label>
            ))}
          </div>

          {Object.entries(byCategory).map(([cat, fs]) => (
            <fieldset key={cat} className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {cat} — optional
              </legend>
              <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {fs.map((f) => (
                  <label key={f.name} className="block text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {f.name}
                    <input
                      className={input}
                      style={inputStyle}
                      value={values[f.name] ?? ''}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={status.kind === 'busy'}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--series-1)' }}
            >
              {status.kind === 'busy' ? 'Saving…' : 'Add period'}
            </button>
            {status.kind === 'done' && (
              <span className="text-sm" style={{ color: 'var(--delta-up)' }}>
                {status.verb} {status.period}
                {status.warnings.length ? ` (${status.warnings.length} warning${status.warnings.length === 1 ? '' : 's'})` : ''}.
              </span>
            )}
            {status.kind === 'error' && (
              <span role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
                {status.message}
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
