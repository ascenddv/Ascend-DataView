/** Friendly, non-technical error for a failed upload (wrong file type, etc.). */
export default function UploadErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-4 rounded-xl border p-4"
      style={{
        borderColor: 'var(--status-critical)',
        background: 'color-mix(in srgb, var(--status-critical) 6%, var(--surface-1))',
      }}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" style={{ color: 'var(--status-critical)' }}>
          ▲
        </span>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            That upload didn’t work
          </p>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {message} The dashboard below still shows the last dataset that loaded successfully.
          </p>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
