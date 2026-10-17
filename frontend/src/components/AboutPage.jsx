import Logo from './Logo.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { Button } from './ui/primitives.jsx';
import { FOUNDERS, initials } from '../lib/founders.js';

/**
 * Public About page at /about (AuthGate routes it by pathname, no session
 * required).
 */



const shell = 'mx-auto max-w-6xl px-5 sm:px-8';
const muted = { color: 'var(--text-secondary)' };
const faint = { color: 'var(--text-muted)' };


function Founder({ person }) {
  return (
    <li
      className="overflow-hidden border"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-lg)' }}
    >
      <div className="aspect-square w-full" style={{ background: 'var(--surface-sunken)' }}>
        {person.photo ? (
          <img src={person.photo} alt={person.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <span
              aria-hidden="true"
              className="grid h-24 w-24 place-items-center rounded-full text-3xl font-semibold"
              style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
            >
              {initials(person.name)}
            </span>
          </div>
        )}
      </div>
      <div className="p-5">
        <h3 className="text-lg font-semibold leading-snug">{person.name}</h3>
        <p className="mt-1 text-sm font-medium" style={{ color: 'var(--accent)' }}>
          {person.role} &middot; {person.focus}
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={muted}>{person.bio}</p>
      </div>
    </li>
  );
}

export default function AboutPage() {
  return (
    <div style={{ background: 'var(--page)', color: 'var(--text-primary)', minHeight: '100vh' }}>
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: 'var(--border)', background: 'var(--page)' }}>
        <div className={`${shell} flex h-16 items-center justify-between`}>
          <a href="/" aria-label="AscendDV home">
            <Logo size={24} />
          </a>
          <div className="flex items-center gap-2">
            <a href="/" className="mr-2 hidden text-sm hover:opacity-70 sm:inline" style={faint}>
              Home
            </a>
            <ThemeToggle />
            <Button as="a" href="/login" variant="ghost" size="sm">Sign in</Button>
            <Button as="a" href="/login?mode=signup" size="sm">Get started</Button>
          </div>
        </div>
      </header>

      <main className={`${shell} py-16 sm:py-24`}>
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--accent)' }}>
            About us
          </p>
          <h1 className="headline mt-3 text-[2.25rem] leading-[1.08] sm:text-[3.25rem]">The team behind AscendDV.</h1>
          <p className="mt-6 text-lg leading-relaxed" style={muted}>
            AscendDV is analytics for organizations with messy or incomplete data. We are four co-founders based in
            Bellevue, Washington, and we built it together.
          </p>
        </div>

        <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FOUNDERS.map((p) => (
            <Founder key={p.name} person={p} />
          ))}
        </ul>

        <p className="mt-14 text-sm" style={faint}>
          Want to work with us? Write to{' '}
          <a href="mailto:ascenddv@gmail.com" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            ascenddv@gmail.com
          </a>
          .
        </p>
      </main>

      <footer className="border-t" style={{ borderColor: 'var(--border)' }}>
        <div className={`${shell} flex flex-col items-start justify-between gap-3 py-8 text-sm sm:flex-row sm:items-center`} style={faint}>
          <Logo size={20} />
          <nav aria-label="Footer" className="flex gap-6">
            <a href="/" className="hover:opacity-70">Home</a>
            <a href="/legal/terms" className="hover:opacity-70">Terms</a>
            <a href="/legal/privacy" className="hover:opacity-70">Privacy</a>
          </nav>
          <p className="text-xs">&copy; {new Date().getFullYear()} AscendDV</p>
        </div>
      </footer>
    </div>
  );
}
