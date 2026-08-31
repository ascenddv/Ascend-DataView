import { useId, useState } from 'react';

/**
 * Top-right cluster on every dashboard card (Phase 14): a confidence battery
 * with a text label, and an (i) that opens the metric's plain-language
 * definition. Both explanations are also in the DOM (hidden) so they're
 * available to hover, tap, and assistive tech without color being the only cue.
 */

const TIER_STYLE = {
  High: { fill: 'var(--status-good)', bars: 3, blurb: 'High confidence' },
  Medium: { fill: 'var(--status-warning)', bars: 2, blurb: 'Medium confidence' },
  Low: { fill: 'var(--status-critical)', bars: 1, blurb: 'Low confidence' },
};

function Battery({ bars, fill }) {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-2.5 w-1.5 rounded-[1px]"
          style={{
            background: i < bars ? fill : 'transparent',
            border: `1px solid ${i < bars ? fill : 'var(--border)'}`,
          }}
        />
      ))}
    </span>
  );
}

function Popover({ open, children }) {
  return (
    <div
      role="tooltip"
      hidden={!open}
      className="absolute right-0 top-full z-10 mt-1 w-60 rounded-lg border p-3 text-left text-xs shadow-lg"
      style={{
        background: 'var(--surface-1)',
        borderColor: 'var(--border)',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </div>
  );
}

export function ConfidenceBadge({ tier, reasons = [] }) {
  const [open, setOpen] = useState(false);
  const style = TIER_STYLE[tier];
  if (!style) return null;
  const explanation = reasons.length
    ? reasons.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join('. ') + '.'
    : style.blurb + '.';

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        title={`${style.blurb}. ${explanation}`}
        aria-label={`${style.blurb}. ${explanation}`}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5"
        style={{ color: 'var(--text-muted)' }}
      >
        <Battery bars={style.bars} fill={style.fill} />
        <span className="text-[11px] font-medium">{tier}</span>
      </button>
      <Popover open={open}>
        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {style.blurb}
        </p>
        <p className="mt-1">{explanation}</p>
      </Popover>
    </span>
  );
}

export function MetricInfo({ definition }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!definition) return null;

  return (
    <span className="relative">
      <button
        type="button"
        aria-describedby={id}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-semibold leading-none"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        aria-label={`About ${definition.title}`}
      >
        i
      </button>
      <Popover open={open}>
        <p id={id} className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {definition.title}
        </p>
        <p className="mt-1">{definition.definition}</p>
        {definition.typicalRange && (
          <p className="mt-2">
            <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Typically:{' '}
            </span>
            {definition.typicalRange}
          </p>
        )}
      </Popover>
    </span>
  );
}

export default function CardChrome({ confidence, definition }) {
  if (!confidence && !definition) return null;
  return (
    <div className="absolute right-2 top-2 flex items-center gap-1.5">
      {confidence && <ConfidenceBadge tier={confidence.tier} reasons={confidence.reasons} />}
      {definition && <MetricInfo definition={definition} />}
    </div>
  );
}
