/**
 * Shows the ingestion report from POST /api/upload in the UI — so skipped rows,
 * duplicate handling, column mapping, and subcategory warnings are visible to
 * the user, not just in the API response.
 */

function Chip({ label, value, tone = 'neutral' }) {
  const color =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'warn'
        ? 'var(--status-warning)'
        : tone === 'bad'
          ? 'var(--status-critical)'
          : 'var(--text-secondary)';
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <div className="text-lg font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
    </div>
  );
}

function List({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3">
      <h4
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: 'var(--text-secondary)' }}
      >
        {title}
      </h4>
      <ul className="mt-1 space-y-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {items.map((line, i) => (
          <li key={i}>• {line}</li>
        ))}
      </ul>
    </div>
  );
}

export default function IngestionSummary({ report, onDismiss }) {
  if (!report) return null;

  const {
    filename,
    rowsProcessed = 0,
    rowsStored = 0,
    rowsSkipped = 0,
    validPeriods = 0,
    dateGranularity,
    duplicatesFlagged = [],
    skippedReasons = [],
    revenueSubcategoryWarnings = [],
    valueWarnings = [],
    parseErrors = [],
    fieldsNeedingConfirmation = [],
    unmappedHeaders = [],
    columnMapping = {},
    llmUsed,
    llmError,
    mappingFromCache,
  } = report;

  const hasIssues =
    rowsSkipped > 0 ||
    revenueSubcategoryWarnings.length > 0 ||
    valueWarnings.length > 0 ||
    parseErrors.length > 0 ||
    fieldsNeedingConfirmation.length > 0 ||
    unmappedHeaders.length > 0 ||
    Boolean(llmError);

  const tone = hasIssues ? 'var(--status-warning)' : 'var(--status-good)';
  const headline = hasIssues
    ? `Loaded ${filename} with ${rowsSkipped} row${rowsSkipped === 1 ? '' : 's'} skipped and some notes`
    : `Loaded ${filename} — all ${rowsStored} rows imported cleanly`;

  const mappingRows = Object.entries(columnMapping);
  const renamed = mappingRows.filter(([h, m]) => m.field && m.field !== h);

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" style={{ color: tone }}>
            {hasIssues ? '▲' : '✓'}
          </span>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {headline}
          </h3>
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

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Chip label="Rows read" value={rowsProcessed} />
        <Chip label="Imported" value={rowsStored} tone={rowsStored > 0 ? 'good' : 'neutral'} />
        <Chip
          label="Skipped"
          value={rowsSkipped}
          tone={rowsSkipped > 0 ? 'warn' : 'neutral'}
        />
        <Chip
          label="Duplicates"
          value={duplicatesFlagged.length}
          tone={duplicatesFlagged.length > 0 ? 'warn' : 'neutral'}
        />
        <Chip label={`${dateGranularity || 'unknown'} periods`} value={validPeriods} />
      </div>

      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        Column mapping:{' '}
        {mappingFromCache
          ? 'reused from a previous upload with the same headers'
          : llmError
            ? 'name-matching only — the AI assist was unavailable'
            : llmUsed
              ? 'AI-assisted for renamed headers'
              : 'exact name match'}
        {renamed.length > 0 && (
          <>
            {' — '}
            {renamed
              .map(([h, m]) => `“${h}” → ${m.field}`)
              .join(', ')}
          </>
        )}
      </p>

      <List title="Skipped rows" items={skippedReasons} />
      <List
        title="Fields needing review"
        items={fieldsNeedingConfirmation.map(
          (f) => `“${f.header}” → ${f.field} (confidence ${(f.confidence * 100).toFixed(0)}%)`
        )}
      />
      <List title="Unmapped columns (ignored)" items={unmappedHeaders} />
      <List title="Revenue subcategory warnings" items={revenueSubcategoryWarnings} />
      <List title="Value warnings" items={valueWarnings} />
      <List title="Parse errors" items={parseErrors} />
    </section>
  );
}
