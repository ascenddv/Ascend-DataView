/**
 * AscendDV logo, the "signal steps" glyph (three climbing bars whose left-to-right
 * fade encodes graceful degradation, under a fixed top rule) plus the Geist wordmark.
 *
 *   variant  'lockup' (glyph + wordmark, default) | 'glyph'
 *   tone     'solid' , filled #10261D slate tile, for light surfaces (default)
 *            'onDark', outlined tile + mint marks, for dark surfaces / hero art
 *   size     glyph edge length in px; the wordmark scales from it
 *
 * The mark is self-contained (its own colours), so it does not inherit theme text
 * colour, only the wordmark does, and only in the 'solid' tone.
 */

const BARS = [
  { x: 23, y: 58, h: 21, opacity: 0.5 },
  { x: 44, y: 46, h: 33, opacity: 0.75 },
  { x: 65, y: 29, h: 50, opacity: 1 },
];

function Glyph({ size, tone }) {
  const onDark = tone === 'onDark';
  const mark = '#B0E4CC';
  const rule = '#408A71';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      {onDark ? (
        <rect x="5" y="5" width="90" height="90" rx="12" fill="none" stroke="#B0E4CC" strokeOpacity="0.32" strokeWidth="4" />
      ) : (
        <rect x="4" y="4" width="92" height="92" rx="12" fill="#10261D" />
      )}
      {BARS.map((b) => (
        <rect key={b.x} x={b.x} y={b.y} width="13" height={b.h} fill={mark} opacity={b.opacity} />
      ))}
      <rect x="23" y="19" width="54" height="6" fill={rule} />
    </svg>
  );
}

export default function Logo({ size = 22, variant = 'lockup', tone = 'solid', className }) {
  if (variant === 'glyph') {
    return (
      <span className={className} style={{ display: 'inline-flex' }}>
        <Glyph size={size} tone={tone} />
      </span>
    );
  }
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.36) }}
    >
      <Glyph size={size} tone={tone} />
      <span
        style={{
          fontFamily: '"Geist", "Inter", ui-sans-serif, system-ui, sans-serif',
          fontWeight: 600,
          fontSize: Math.round(size * 0.82),
          letterSpacing: '-0.02em',
          lineHeight: 1,
          color: tone === 'onDark' ? '#F4F7F5' : 'var(--text-primary)',
        }}
      >
        AscendDV
      </span>
    </span>
  );
}
