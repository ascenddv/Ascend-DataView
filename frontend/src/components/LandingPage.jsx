import Logo from './Logo.jsx';
import { Button } from './ui/primitives.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { IconCheck } from '../lib/icons.jsx';

/**
 * Public marketing page, shown at "/" to logged-out visitors (AuthGate routes
 * it before the sign-in card). Layout follows the Ascend marketing site
 * (bordered nav, headline hero with a product plate, divided sections, accent
 * CTA band); the copy stays grounded in the real product: graceful
 * degradation, "AI narrates, code computes", tool-grounded AscendAI.
 */

const SIGN_IN = '/login';
const GET_STARTED = '/login?mode=signup';

const shell = 'mx-auto max-w-6xl px-5 sm:px-8';
const h2 = 'headline text-[1.75rem] leading-[1.15] sm:text-[2.25rem]';
const muted = { color: 'var(--text-secondary)' };
const faint = { color: 'var(--text-muted)' };

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#principle', label: 'Principles' },
  { href: '#ai', label: 'AscendAI' },
  { href: '#product', label: 'Product' },
];

const PRINCIPLES = [
  ['Calculates only what it can', 'Each metric runs only when the underlying data is sufficient to stand behind the number.'],
  ['Shows only what it can defend', 'A card appears when its metric is eligible and backed by real data, otherwise it is simply not there.'],
  ['Degrades, never errors', 'Sparse data or an unavailable AI provider produces a smaller coherent view, not a broken one.'],
];

const FEATURES = [
  ['Health scores you can trust', 'A 0–100 score per dimension with a qualitative band, each backed by its sub-metrics and a confidence indicator.'],
  ['KPIs & trends without the fiction', 'Headline numbers with period-over-period change. One period of data? You see “no change yet”, never a fabricated zero.'],
  ['Risks & opportunities, surfaced', 'Rule-driven callouts point at what is moving against you and what is worth pressing on.'],
  ['Plain-language export', 'A clean PDF of the dashboard for a board pack or a funder update, generated from exactly what is on screen.'],
];

const COMPARE = [
  ['Assumes clean, complete data', 'Works with patchy exports'],
  ['Guesses when data is missing', 'Hides what it cannot support'],
  ['AI that invents numbers', 'AI that narrates computed values'],
  ['A wall of charts', 'Only the cards the data backs'],
];

const STEPS = [
  ['Upload a CSV', 'Bring whatever you have, exports from your accounting tool, a spreadsheet, a CRM dump. Patchy is fine.'],
  ['AscendDV maps & validates', 'Columns are matched to a standard schema and checked. You confirm anything ambiguous once.'],
  ['Your dashboard appears', 'Only the cards your data can support, with confidence indicators, trends, risks, and AscendAI ready to answer questions.'],
];

function Sparkline() {
  return (
    <svg
      viewBox="0 0 400 140"
      className="h-32 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Cash on hand climbing over six months"
    >
      <g stroke="var(--gridline)">
        <line x1="0" x2="400" y1="35" y2="35" />
        <line x1="0" x2="400" y1="80" y2="80" />
        <line x1="0" x2="400" y1="125" y2="125" />
      </g>
      <path
        d="M0 104 L50 96 L100 100 L150 78 L200 84 L250 60 L300 66 L350 38 L400 26"
        fill="none"
        stroke="var(--series-1)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The dashboard in miniature: a plate with headline figures and a chart. */
function ProductVignette() {
  return (
    <div
      className="border p-5 sm:p-6"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-lg)' }}
    >
      <div className="flex items-baseline justify-between">
        <Logo size={18} />
        <p className="text-sm" style={faint}>
          Health{' '}
          <span className="text-lg font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
            78
          </span>
        </p>
      </div>
      <div className="-mx-1 mt-4 flex gap-1">
        <div className="flex-1 rounded-lg px-3 py-2" style={{ background: 'var(--surface-sunken)' }}>
          <span className="block text-xs font-medium" style={muted}>Finance health</span>
          <span className="mt-0.5 block text-xl font-semibold tabular-nums">
            78<span className="text-xs font-normal" style={faint}> / 100</span>
          </span>
          <span className="block text-xs font-medium" style={muted}>Stable</span>
        </div>
        <div className="flex-1 rounded-lg px-3 py-2">
          <span className="block text-xs" style={faint}>Monthly revenue</span>
          <span className="mt-0.5 block text-xl font-semibold tabular-nums">$48.2k</span>
          <span className="block text-xs font-medium" style={{ color: 'var(--delta-up)' }}>&#9650; 12% vs last month</span>
        </div>
      </div>
      <div className="mt-5">
        <Sparkline />
      </div>
      <p className="mt-4 border-t pt-4 text-sm" style={{ borderColor: 'var(--border)', ...muted }}>
        <span className="font-medium" style={{ color: 'var(--accent)' }}>Insight:</span> runway fell to 5.1 months as
        expenses rose 14%.
      </p>
    </div>
  );
}

function Stage({ title, text, strong = false }) {
  return (
    <div
      className="border p-5"
      style={{
        background: 'var(--surface-1)',
        borderColor: strong ? 'var(--accent)' : 'var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed" style={muted}>{text}</p>
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="mx-auto rotate-90 text-xl lg:rotate-0" style={{ color: 'var(--accent)' }}>
      &rarr;
    </span>
  );
}

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--page)', color: 'var(--text-primary)' }}>
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: 'var(--border)', background: 'var(--page)' }}>
        <div className={`${shell} flex h-16 items-center justify-between`}>
          <Logo size={24} />
          <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
            {NAV.map((l) => (
              <a key={l.href} href={l.href} className="text-sm transition-opacity hover:opacity-70" style={faint}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button as="a" href={SIGN_IN} variant="ghost" size="sm">Sign in</Button>
            <Button as="a" href={GET_STARTED} size="sm">Get started</Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section>
          <div className={`${shell} grid items-center gap-12 pb-20 pt-14 md:pt-20 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pb-28`}>
            <div className="settle">
              <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={faint}>
                Analytics for real-world data
              </p>
              <h1 className="headline mt-3 text-[2.25rem] leading-[1.08] sm:text-[3.25rem]">
                Understand what your data is telling you.
              </h1>
              <p className="mt-6 max-w-md text-lg leading-relaxed" style={muted}>
                AscendDV reads whatever data you already have, even patchy exports, and turns it into health
                scores, trends, risks, and plain-language insight. When the data is thin, the picture gets smaller,
                never wrong.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button as="a" href={GET_STARTED} size="lg">Get started</Button>
                <Button as="a" href="#how" variant="secondary" size="lg">See how it works</Button>
              </div>
            </div>
            <div className="settle [animation-delay:150ms]">
              <ProductVignette />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          id="how"
          className="scroll-mt-16 border-y"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        >
          <div className={`${shell} grid gap-12 py-20 sm:py-24 lg:grid-cols-[1fr_1.2fr]`}>
            <h2 className={h2}>Messy data in. Only trustworthy answers out.</h2>
            <dl className="divide-y self-center border-y" style={{ borderColor: 'var(--border)' }}>
              {STEPS.map(([name, text], i) => (
                <div
                  key={name}
                  className="grid gap-1 py-5 sm:grid-cols-[190px_1fr] sm:gap-6"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <dt className="text-lg font-semibold">
                    <span className="tabular-nums" style={{ color: 'var(--accent)' }}>{i + 1}.</span> {name}
                  </dt>
                  <dd style={muted}>{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Principles */}
        <section id="principle" className="scroll-mt-16" style={{ background: 'var(--accent-weak)' }}>
          <div className={`${shell} py-20 sm:py-24`}>
            <h2 className={`${h2} max-w-2xl`}>Insight you can actually trust</h2>
            <p className="mt-5 max-w-xl text-lg" style={muted}>
              Most analytics tools assume clean, complete data and break, or worse, guess, when they don&rsquo;t get
              it. AscendDV is built the other way around, so every number on screen is one it can stand behind.
            </p>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {PRINCIPLES.map(([t, d]) => (
                <Stage key={t} title={t} text={d} />
              ))}
            </div>
          </div>
        </section>

        {/* AscendAI */}
        <section id="ai" className="scroll-mt-16">
          <div className={`${shell} py-20 sm:py-24`}>
            <h2 className={`${h2} max-w-2xl`}>Ask AscendAI</h2>
            <p className="mt-5 max-w-xl text-lg" style={muted}>
              Ask questions about your dashboard in plain language. AscendAI decides what to look up; the app
              computes the real value. It narrates the answer, it never invents a number, and it only ever sees your
              organization&rsquo;s data.
            </p>
            <div className="mt-12 grid items-center gap-3 lg:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
              <Stage title="Your question" text="“Why did the finance score drop?”" />
              <Arrow />
              <Stage strong title="Deterministic metrics layer" text="Real functions compute every figure, scoped to your organization." />
              <Arrow />
              <Stage title="Plain-language answer" text="Runway fell from 7.2 to 5.1 months as expenses rose 14% while revenue held flat." />
            </div>
          </div>
        </section>

        {/* Product */}
        <section id="product" className="scroll-mt-16 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className={`${shell} py-20 sm:py-24`}>
            <h2 className={`${h2} max-w-2xl`}>What you get on day one</h2>
            <dl className="mt-12 grid gap-x-12 gap-y-8 sm:grid-cols-2">
              {FEATURES.map(([t, d]) => (
                <div key={t}>
                  <dt className="text-lg font-semibold">{t}</dt>
                  <dd className="mt-1" style={muted}>{d}</dd>
                </div>
              ))}
            </dl>

            <div
              className="mt-16 overflow-hidden border"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-lg)' }}
            >
              <div className="grid grid-cols-2 border-b text-sm font-semibold" style={{ borderColor: 'var(--border-strong)' }}>
                <div className="px-5 py-3" style={faint}>Typical analytics tools</div>
                <div className="px-5 py-3" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>AscendDV</div>
              </div>
              {COMPARE.map(([a, b], i) => (
                <div
                  key={a}
                  className="grid grid-cols-2"
                  style={i < COMPARE.length - 1 ? { borderBottom: '1px solid var(--border)' } : undefined}
                >
                  <div className="flex items-center gap-2.5 px-5 py-3.5" style={muted}>
                    <span aria-hidden="true" style={faint}>&times;</span> {a}
                  </div>
                  <div className="flex items-center gap-2.5 px-5 py-3.5 font-medium" style={{ background: 'var(--accent-weak)' }}>
                    <span aria-hidden="true" style={{ color: 'var(--accent)' }}><IconCheck size={15} /></span> {b}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className={`${shell} py-12 sm:py-14`}>
          <div
            className="flex flex-col items-start justify-between gap-6 px-8 py-10 sm:flex-row sm:items-center sm:px-12"
            style={{ background: 'var(--accent)', color: 'var(--accent-contrast)', borderRadius: 'var(--radius-xl)' }}
          >
            <h2 className="headline text-[1.75rem] leading-[1.15] sm:text-[2.25rem]">
              See what your data can actually tell you.
            </h2>
            <Button
              as="a"
              href={GET_STARTED}
              size="lg"
              variant="secondary"
              className="shrink-0"
              style={{ borderColor: 'transparent' }}
            >
              Get started
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t" style={{ borderColor: 'var(--border)' }}>
        <div
          className={`${shell} flex flex-col items-start justify-between gap-5 py-8 text-sm sm:flex-row sm:items-center`}
          style={faint}
        >
          <Logo size={20} />
          <nav aria-label="Footer" className="flex gap-6">
            <a href={SIGN_IN} className="hover:opacity-70">Sign in</a>
            <a href="/legal/terms" className="hover:opacity-70">Terms</a>
            <a href="/legal/privacy" className="hover:opacity-70">Privacy</a>
          </nav>
          <p className="text-xs">&copy; {new Date().getFullYear()} AscendDV</p>
        </div>
      </footer>
    </div>
  );
}
