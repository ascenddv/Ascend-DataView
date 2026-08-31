import { useState } from 'react';
import { downloadOverviewPdf } from '../lib/api.js';

/**
 * Downloads a point-in-time PDF snapshot of the current Overview. The file is
 * whatever the backend renders for the session's own org — no parameters.
 */
export default function PdfExportButton() {
  const [status, setStatus] = useState('idle'); // idle | busy | error

  async function run() {
    setStatus('busy');
    try {
      const { blob, filename } = await downloadOverviewPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={status === 'busy'}
      className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
    >
      {status === 'busy'
        ? 'Preparing PDF…'
        : status === 'error'
          ? 'Export failed — retry'
          : 'Download PDF'}
    </button>
  );
}
