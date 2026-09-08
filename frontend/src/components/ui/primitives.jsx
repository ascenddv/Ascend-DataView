/**
 * Shared UI primitives for AscendDV — one small, consistent vocabulary of
 * controls used across auth, settings, upload, team, and the AI panel. Styling
 * follows the house pattern: Tailwind for layout, inline `style` bound to the
 * CSS-var tokens for anything themeable.
 */
import { forwardRef } from 'react';

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold ' +
  'transition-[transform,background-color,border-color,box-shadow,opacity] ' +
  'duration-[120ms] ease-out select-none disabled:opacity-55 disabled:pointer-events-none ' +
  'active:scale-[0.98]';

const SIZE = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-4 py-2.5 text-sm',
};

function variantStyle(variant) {
  switch (variant) {
    case 'secondary':
      return { background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' };
    case 'ghost':
      return { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' };
    case 'danger':
      return { background: 'var(--status-critical)', color: '#fff', border: '1px solid transparent' };
    case 'primary':
    default:
      return { background: 'var(--accent)', color: 'var(--accent-contrast)', border: '1px solid transparent' };
  }
}

export const Button = forwardRef(function Button(
  { as: Tag = 'button', variant = 'primary', size = 'md', className = '', style, ...props },
  ref,
) {
  const isHoverGhost = variant === 'ghost' || variant === 'secondary';
  return (
    <Tag
      ref={ref}
      className={`${BTN_BASE} ${SIZE[size]} ${isHoverGhost ? 'hover:bg-[var(--surface-hover)]' : ''} ${className}`}
      style={{ ...variantStyle(variant), ...style }}
      {...props}
    />
  );
});

export const IconButton = forwardRef(function IconButton(
  { className = '', label, style, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-lg p-1.5 transition-colors duration-[120ms] hover:bg-[var(--surface-hover)] ${className}`}
      style={{ color: 'var(--text-secondary)', ...style }}
      {...props}
    />
  );
});

export const Input = forwardRef(function Input({ className = '', style, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`w-full rounded-[10px] border px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-[120ms] focus:shadow-[0_0_0_3px_var(--accent-weak)] ${className}`}
      style={{
        background: 'var(--surface-2)',
        color: 'var(--text-primary)',
        borderColor: invalid ? 'var(--status-critical)' : 'var(--border-strong)',
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = invalid ? 'var(--status-critical)' : 'var(--border-strong)';
        props.onBlur?.(e);
      }}
      {...props}
    />
  );
});

/** Labelled field wrapper: label on top, optional hint/error below. */
export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
      )}
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs" style={{ color: 'var(--status-critical)' }}>
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const BADGE_TONE = {
  neutral: { bg: 'var(--surface-hover)', fg: 'var(--text-secondary)' },
  accent: { bg: 'var(--accent-weak)', fg: 'var(--accent)' },
  good: { bg: 'color-mix(in srgb, var(--status-good) 14%, transparent)', fg: 'var(--status-good)' },
  warning: { bg: 'color-mix(in srgb, var(--status-warning) 18%, transparent)', fg: 'var(--status-warning)' },
  critical: { bg: 'color-mix(in srgb, var(--status-critical) 14%, transparent)', fg: 'var(--status-critical)' },
};

export function Badge({ tone = 'neutral', children, className = '' }) {
  const t = BADGE_TONE[tone] || BADGE_TONE.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}
      style={{ background: t.bg, color: t.fg }}
    >
      {children}
    </span>
  );
}

/** Inline notice block with a left rule — used for degraded/warning states. */
export function Callout({ tone = 'neutral', title, children, className = '' }) {
  const accent =
    tone === 'warning' ? 'var(--status-warning)'
    : tone === 'critical' ? 'var(--status-critical)'
    : tone === 'accent' ? 'var(--accent)'
    : 'var(--border-strong)';
  return (
    <div
      className={`rounded-[10px] border p-3 text-sm ${className}`}
      style={{
        background: 'var(--surface-1)',
        borderColor: 'var(--border)',
        borderLeft: `3px solid ${accent}`,
        color: 'var(--text-secondary)',
      }}
    >
      {title && (
        <p className="mb-0.5 font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
      )}
      {children}
    </div>
  );
}
