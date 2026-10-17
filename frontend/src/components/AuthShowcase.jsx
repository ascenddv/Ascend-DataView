/**
 * Product preview shown beside the sign-in / sign-up form on large screens.
 * A deep-forest panel with mint accents (ported from the Ascend auth layout).
 * Decorative only, hidden from assistive tech.
 */

const FIGURES = [
  ['Revenue', '$48.2k', '+12%', false],
  ['Expenses', '$31.4k', '+14%', true],
  ['Runway', '5.1 mo', '-2.1 mo', true],
];

const MINT = '#7fd1ad';
const HAIRLINE = 'rgba(255,255,255,0.15)';

export default function AuthShowcase() {
  return (
    <aside
      aria-hidden="true"
      className="hidden lg:flex lg:items-center lg:justify-center lg:p-12 xl:p-16"
      style={{ background: '#10261d', color: '#fff' }}
    >
      <div className="w-full max-w-xl">
        <h2 className="headline text-3xl leading-[1.1] xl:text-[2.5rem]">
          Only the metrics
          <br />
          <span style={{ color: MINT }}>your data can support.</span>
        </h2>

        <div className="mt-12 rounded-xl border p-6" style={{ borderColor: HAIRLINE }}>
          <div className="flex items-baseline justify-between text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
            <p>Overview</p>
            <p>
              Health{' '}
              <span className="text-lg font-semibold tabular-nums" style={{ color: MINT }}>
                78
              </span>
            </p>
          </div>

          <div className="mt-5 flex">
            {FIGURES.map(([label, value, delta, bad], i) => (
              <div
                key={label}
                className="flex-1 px-4 first:pl-0 last:pr-0"
                style={i ? { borderLeft: `1px solid ${HAIRLINE}` } : undefined}
              >
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                <p className="text-xs font-medium tabular-nums" style={{ color: bad ? '#f2a49a' : MINT }}>
                  {delta}
                </p>
              </div>
            ))}
          </div>

          <svg viewBox="0 0 400 140" className="mt-7 h-auto w-full" role="presentation">
            <g stroke="white" strokeOpacity="0.1">
              <line x1="0" x2="400" y1="35" y2="35" />
              <line x1="0" x2="400" y1="80" y2="80" />
              <line x1="0" x2="400" y1="125" y2="125" />
            </g>
            <path
              d="M0 104 L50 96 L100 100 L150 78 L200 84 L250 60 L300 66 L350 38 L400 26"
              fill="none"
              stroke={MINT}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <p className="mt-5 border-t pt-4 text-sm" style={{ borderColor: HAIRLINE, color: 'rgba(255,255,255,0.75)' }}>
            <span className="font-medium" style={{ color: MINT }}>Insight:</span> runway fell to 5.1 months as
            expenses rose 14%.
          </p>
        </div>
      </div>
    </aside>
  );
}
