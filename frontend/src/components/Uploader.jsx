import { useRef, useState } from 'react';

/**
 * CSV upload control. POSTs multipart to /api/upload and reports the outcome:
 *   onResult(responseJson)  — a 2xx ingestion report (may still contain skipped
 *                             rows / warnings — that's a successful upload)
 *   onError(message)        — wrong file type, unparseable file, or server error
 */
export default function Uploader({ onResult, onError }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | uploading | done
  const [filename, setFilename] = useState(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file) {
    if (!file) return;
    setFilename(file.name);
    setStatus('uploading');

    const body = new FormData();
    body.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body,
        credentials: 'include',
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* non-JSON error body */
      }

      if (!res.ok || !json || json.ok === false) {
        const msg =
          (json && json.error) ||
          (res.status === 415
            ? 'That doesn’t look like a CSV file. Upload a .csv export.'
            : `Upload failed (HTTP ${res.status}).`);
        setStatus('idle');
        onError(msg);
        return;
      }

      setStatus('done');
      onError(null);
      onResult(json);
    } catch (err) {
      setStatus('idle');
      onError(`Couldn’t reach the server: ${err.message}`);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files?.[0]);
  }

  const busy = status === 'uploading';

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4"
      style={{
        background: 'var(--surface-1)',
        borderColor: dragging ? 'var(--series-1)' : 'var(--border)',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
      >
        {busy ? 'Analyzing…' : 'Upload CSV'}
      </button>

      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {busy && (
          <>
            <span
              className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]"
              aria-hidden="true"
            />
            Parsing, mapping columns, and validating <b>{filename}</b>…
          </>
        )}
        {status === 'done' && (
          <>
            Loaded <b>{filename}</b>. Drop another CSV here to replace it.
          </>
        )}
        {status === 'idle' && 'Drop a CSV here, or choose a file. Only the latest upload is shown.'}
      </span>
    </div>
  );
}
