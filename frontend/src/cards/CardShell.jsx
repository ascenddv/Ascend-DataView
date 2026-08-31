import CardChrome from './CardChrome.jsx';

/** Shared visual shell for every dashboard card. */
export default function CardShell({
  children,
  accent = null,
  tint = false,
  className = '',
  confidence = null,
  definition = null,
}) {
  const style = {
    background: tint && accent
      ? `color-mix(in srgb, ${accent} 5%, var(--surface-1))`
      : 'var(--surface-1)',
    borderColor: 'var(--border)',
    ...(accent ? { borderLeftColor: accent, borderLeftWidth: '3px' } : null),
  };

  const hasChrome = Boolean(confidence || definition);

  return (
    <div
      className={`relative flex h-full flex-col rounded-xl border p-4 ${
        hasChrome ? 'pr-20' : ''
      } ${className}`}
      style={style}
    >
      <CardChrome confidence={confidence} definition={definition} />
      {children}
    </div>
  );
}

export function CardLabel({ children }) {
  return (
    <div
      className="text-xs font-semibold uppercase tracking-wide"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </div>
  );
}
