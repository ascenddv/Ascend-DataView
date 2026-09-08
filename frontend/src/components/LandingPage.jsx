import { useEffect, useRef, useState } from 'react';
import Logo from './Logo.jsx';
import { Button } from './ui/primitives.jsx';
import { IconSparkles, IconCheck } from '../lib/icons.jsx';
import { prefersReducedMotion } from '../lib/motion.js';

/**
 * Public marketing page, shown at "/" to logged-out visitors (AuthGate routes
 * it before the sign-in card). Copy is grounded in the real product: graceful
 * degradation, "AI narrates, code computes", tool-grounded AscendAI.
 */

const SIGN_IN = '/login';
const GET_STARTED = '/login?mode=signup';

function Reveal({ children, as: Tag = 'div', className = '', delay = 0 }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return undefined;
    }
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(14px)',
        transition: 'opacity .55s var(--ease-out), transform .55s var(--ease-out)',
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </Tag>
  );
}

function Sparkline() {
  return (
    <svg viewBox="0 0 120 40" className="h-10 w-full" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M2 34 L20 30 L38 32 L56 22 L74 24 L92 12 L118 6"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A restrained, non-interactive vignette of the product. */
function ProductVignette() {
  return (
    <div
      className="overflow-hidden border"
      style={{
        background: 'var(--surface-2)',
        borderColor: 'var(--border)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div className="flex">
        <div
          className="hidden w-40 shrink-0 flex-col gap-1 border-r p-3 sm:flex"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        >
          <div className="mb-2 px-1">
            <Logo size={18} />
          </div>
          {['Dashboard', 'Data', 'Settings'].map((l, i) => (
            <div
              key={l}
              className="rounded-md px-2 py-1.5 text-xs font-medium"
              style={
                i === 0
                  ? { background: 'var(--accent-weak)', color: 'var(--accent)' }
                  : { color: 'var(--text-muted)' }
              }
            >
              {l}
            </div>
          ))}
        </div>
        <div className="flex-1 p-4">
          <div className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Overview
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div
              className="border p-3"
              style={{ borderColor: 'var(--border)', borderRadius: 'var(--radius)', borderLeft: '3px solid var(--border-strong)' }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Finance health
              </div>
              <div className="mt-1 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                78<span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}> / 100</span>
              </div>
              <div className="mt-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Stable</div>
            </div>
            <div className="border p-3" style={{ borderColor: 'var(--border)', borderRadius: 'var(--radius)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Monthly revenue
              </div>
              <div className="mt-1 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>$48.2k</div>
              <div className="mt-1 text-xs" style={{ color: 'var(--delta-up)' }}>▲ 12% vs last month</div>
            </div>
            <div className="col-span-2 border p-3" style={{ borderColor: 'var(--border)', borderRadius: 'var(--radius)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Cash on hand — 6 months
              </div>
              <div className="mt-2"><Sparkline /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ title, children }) {
  return (
    <div
      className="border p-5"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', borderRadius: 'var(--radius-lg)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {children}
      </p>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ background: 'var(--text-primary)', color: 'var(--surface-2)' }}
      >
        {n}
      </span>
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{children}</p>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--page)', color: 'var(--text-primary)' }}>
      {/* Nav */}
      <header
        className="adv-frost sticky top-0 z-30 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Logo size={24} />
          <nav className="flex items-center gap-2">
            <Button as="a" href={SIGN_IN} variant="ghost" size="sm">Sign in</Button>
            <Button as="a" href={GET_STARTED} size="sm">Get started</Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-5 pb-16 pt-16 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-[0.14em]"
              style={{ color: 'var(--text-muted)' }}
            >
              Analytics for real-world data
            </p>
            <h1
              className="mt-3 text-4xl font-bold leading-[1.08] sm:text-5xl"
              style={{ color: 'var(--text-primary)' }}
            >
              Understand what your data is telling you.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              AscendDV reads whatever data you already have — even patchy exports —
              and turns it into health scores, trends, risks, and plain-language
              insight you can act on. When the data is thin, the picture gets
              smaller, never wrong.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button as="a" href={GET_STARTED} size="lg">Get started</Button>
              <Button as="a" href="#how" variant="secondary" size="lg">See how it works</Button>
            </div>
          </div>
          <Reveal delay={80}>
            <ProductVignette />
          </Reveal>
        </div>
      </section>

      {/* Principle */}
      <section className="border-y" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
        <div className="mx-auto max-w-5xl px-5 py-14">
          <Reveal>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Insight you can actually trust
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Most analytics tools assume clean, complete data and break — or worse,
              guess — when they don&rsquo;t get it. AscendDV is built the other way
              around, so every number on screen is one it can stand behind.
            </p>
          </Reveal>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ['Calculates only what it can', 'Each metric runs only when the underlying data is sufficient to stand behind the number.'],
              ['Shows only what it can defend', 'A card appears when its metric is eligible and backed by real data — otherwise it is simply not there.'],
              ['Degrades, never errors', 'Sparse data or an unavailable AI provider produces a smaller coherent view, not a broken one.'],
            ].map(([t, d], i) => (
              <Reveal key={t} delay={i * 70}>
                <div className="flex gap-2.5">
                  <span style={{ color: 'var(--text-primary)' }} className="mt-0.5 shrink-0">
                    <IconCheck size={16} />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t}</h3>
                    <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-5 py-16">
        <Reveal>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            What you get on day one
          </h2>
        </Reveal>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Reveal delay={0}>
            <Feature title="Health scores you can trust">
              A 0–100 score per dimension with a qualitative band, each backed by
              its sub-metrics — and a confidence indicator so you know how much
              data is behind it.
            </Feature>
          </Reveal>
          <Reveal delay={60}>
            <Feature title="KPIs &amp; trends without the fiction">
              Headline numbers with period-over-period change. One period of data?
              You see &ldquo;no change yet&rdquo;, never a fabricated zero.
            </Feature>
          </Reveal>
          <Reveal delay={120}>
            <Feature title="Risks &amp; opportunities, surfaced">
              Rule-driven callouts point at what is moving against you and what is
              worth pressing on — drawn from the same deterministic metrics.
            </Feature>
          </Reveal>
          <Reveal delay={180}>
            <Feature title="Plain-language export">
              A clean PDF of the dashboard for a board pack or a funder update,
              generated from exactly what is on screen.
            </Feature>
          </Reveal>
        </div>
      </section>

      {/* AscendAI */}
      <section className="border-y" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-14 sm:flex-row sm:items-center">
          <Reveal className="sm:flex-1">
            <span
              className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'var(--surface-sunken)', color: 'var(--text-secondary)' }}
            >
              <IconSparkles size={20} />
            </span>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Ask AscendAI
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Ask questions about your dashboard in plain language. AscendAI decides
              what to look up; the app computes the real value from the same
              metrics layer everything else uses. It narrates the answer — it never
              invents a number, and it only ever sees your organization&rsquo;s data.
            </p>
          </Reveal>
          <Reveal
            delay={80}
            className="sm:w-80"
          >
            <div
              className="border p-4 text-sm"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', borderRadius: 'var(--radius-lg)' }}
            >
              <p style={{ color: 'var(--text-muted)' }}>&ldquo;Why did the finance score drop?&rdquo;</p>
              <p className="mt-2 leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                Runway fell from 7.2 to 5.1 months as expenses rose 14% while
                revenue held flat. The reserve ratio is the sub-metric pulling
                the score down.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-5xl px-5 py-16">
        <Reveal>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>How it works</h2>
        </Reveal>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <Reveal delay={0}>
            <Step n={1} title="Upload a CSV">
              Bring whatever you have — exports from your accounting tool, a
              spreadsheet, a CRM dump. Patchy is fine.
            </Step>
          </Reveal>
          <Reveal delay={70}>
            <Step n={2} title="AscendDV maps &amp; validates">
              Columns are matched to a standard schema and checked. You confirm
              anything ambiguous once.
            </Step>
          </Reveal>
          <Reveal delay={140}>
            <Step n={3} title="Your dashboard appears">
              Only the cards your data can support — with confidence indicators,
              trends, risks, and AscendAI ready to answer questions.
            </Step>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-5 py-16 text-center">
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            See what your data can actually tell you.
          </h2>
          <Button as="a" href={GET_STARTED} size="lg">Get started</Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t" style={{ borderColor: 'var(--border)' }}>
        <div
          className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-5 py-8 text-xs sm:flex-row"
          style={{ color: 'var(--text-muted)' }}
        >
          <Logo size={18} />
          <div className="flex items-center gap-4">
            <a href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</a>
            <a href="/legal/privacy" style={{ textDecoration: 'underline' }}>Privacy</a>
            <span>&copy; {new Date().getFullYear()} AscendDV</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
