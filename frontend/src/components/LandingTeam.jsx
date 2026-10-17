import { FOUNDERS, initials } from '../lib/founders.js';

/**
 * Compact "Meet the team" strip for the landing page: the founders' photos in
 * a row, with a link through to the full About page.
 */

const muted = { color: 'var(--text-secondary)' };
const faint = { color: 'var(--text-muted)' };

function Face({ person }) {
  return (
    <li className="flex flex-col items-center text-center">
      <div
        className="h-24 w-24 overflow-hidden rounded-full border sm:h-28 sm:w-28"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-sunken)' }}
      >
        {person.photo ? (
          <img src={person.photo} alt={person.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-full w-full place-items-center text-2xl font-semibold"
            style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
          >
            {initials(person.name)}
          </span>
        )}
      </div>
      <p className="mt-3 text-sm font-semibold">{person.name}</p>
      <p className="text-xs" style={faint}>{person.focus}</p>
    </li>
  );
}

export default function LandingTeam() {
  return (
    <section id="team" className="scroll-mt-16 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="mx-auto max-w-6xl px-5 py-16 text-center sm:px-8 sm:py-20">
        <h2 className="headline text-[1.5rem] leading-[1.15] sm:text-[2rem]">Meet the team</h2>
        <p className="mx-auto mt-3 max-w-md text-base" style={muted}>
          Four co-founders, based in Bellevue, Washington.
        </p>

        <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          {FOUNDERS.map((p) => (
            <Face key={p.name} person={p} />
          ))}
        </ul>

        <a
          href="/about"
          className="mt-10 inline-block text-sm font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          More about us &rarr;
        </a>
      </div>
    </section>
  );
}
