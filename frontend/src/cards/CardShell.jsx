/** Shared visual shell for every dashboard card. */
export default function CardShell({ children, accent = null, tint = false, className = '' }) {
  const style = {
    background: tint && accent
      ? `color-mix(in srgb, ${accent} 5%, var(--surface-1))`
      : 'var(--surface-1)',
    borderColor: 'var(--border)',
    ...(accent ? { borderLeftColor: accent, borderLeftWidth: '3px' } : null),
  };

  return (
    <div className={`flex h-full flex-col rounded-xl border p-4 ${className}`} style={style}>
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
