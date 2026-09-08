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
      ? `color-mix(in srgb, ${accent} 6%, var(--surface-1))`
      : 'var(--surface-1)',
    borderColor: 'var(--border)',
    borderRadius: 'var(--radius)',
    padding: 'var(--card-pad)',
    ...(accent ? { borderLeftColor: accent, borderLeftWidth: '3px' } : null),
  };

  const hasChrome = Boolean(confidence || definition);

  return (
    <div
      className={`relative flex h-full flex-col border ${hasChrome ? 'pr-16' : ''} ${className}`}
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
      className="text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </div>
  );
}
