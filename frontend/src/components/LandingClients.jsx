import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "Businesses We've Helped" carousel for the public landing page. Scroll-snap
 * track with prev/next buttons and page dots, split into Businesses and
 * Nonprofits. Logos are placeholders (initials tile) until real artwork lands:
 * set `logo` (`logoBg` for a white-on-transparent logo, `logoFit: 'avatar'` for a photo) on a CLIENTS entry to an image path and the tile renders it.
 */

const CLIENTS = [
  // Businesses
  { name: 'Gurudatta Tiles', kind: 'business', logo: '/logos/gurudatta.svg', blurb: "Tile shop serving customers in Katraj, Pune.", url: 'https://www.justdial.com/Pune/Gurudatta-Tiles-Near-Raviraj-Tarace-Katraj/020P2300617_BZDET' },
  { name: 'Lenity Infotech', kind: 'business', logo: '/logos/lenity.svg', blurb: "Pune-based IT and software services company.", url: 'https://www.zaubacorp.com/LENITY-INFOTECH-PRIVATE-LIMITED-U72200PN2022PTC214564' },
  { name: 'Iquore Innovations', kind: 'business', logo: '/logos/iquore.png', blurb: "Application identity specialists helping enterprises modernize identity and access management across cloud platforms.", url: 'https://iquoreinnovations.com/' },
  { name: "I Can't Believe it's Bread!", kind: 'business', logo: '/logos/bread.png', blurb: "A dedicated gluten-free bakery.", url: 'https://www.icantbelieveitsbread.com/' },
  { name: 'Bear King Seafood', kind: 'business', logo: '/logos/bearking.png', blurb: "Seafood seller focused on fresh, never frozen, product.", url: 'https://www.instagram.com/bearking_seafood/' },
  { name: 'Arpina Solar Energies', kind: 'business', logo: '/logos/arpina.svg', blurb: "Solar energy solutions provider.", url: 'https://www.indiamart.com/arpinasolarenergies/profile.html' },
  { name: 'WhoIAm', kind: 'business', logo: '/logos/whoiam.png', blurb: "Identity and access management services for enterprises, from digital identity architecture to identity verification.", url: 'https://whoiam.ai/' },
  { name: 'India Supermarket', kind: 'business', logo: '/logos/indiasupermarket.svg', blurb: "Neighborhood supermarket in Bellevue, WA.", url: 'https://www.facebook.com/IndiaSupermarketBellevue/' },
  { name: 'Keaganinthecut', kind: 'business', logo: '/logos/keagan.png', logoFit: 'avatar', blurb: "Mukilteo barber specializing in fades, tapers and lineups, with online booking.", url: 'https://www.instagram.com/keaganinthecut/' },
  { name: 'PIT Solutions', kind: 'business', logo: '/logos/pits.png', blurb: "Software company offering custom development, AI, testing, ERP, cybersecurity and managed IT services.", url: 'https://www.pitsolutions.com/' },
  { name: 'Starintra IT Services', kind: 'business', logo: '/logos/starintra.svg', blurb: "IT services firm doing computer programming and consultancy.", url: 'https://www.falconebiz.com/LLP/STARINTRA-IT-SERVICES-LLP-ADB-7445' },
  { name: 'Titan Robotics Club', kind: 'business', logo: '/logos/titan.png', blurb: "Middle and high school program in Bellevue running FIRST robotics teams in FRC, FTC and FLL.", url: 'https://www.titanrobotics.com/' },
  { name: 'Gene The Plumber', kind: 'business', logo: '/logos/geneplumber.svg', blurb: "Bothell, WA plumber offering leak detection, repairs and HVAC maintenance for homes and businesses.", url: 'https://www.eventeny.com/company/?c=297995' },
  { name: 'Padmashree Residence', kind: 'business', logo: '/logos/padmashree.svg', blurb: "Residential property project in Katraj, Pune.", url: 'https://www.99acres.com/padmashree-katraj-pune-npxid-r406234' },
  { name: 'Kari Art', kind: 'business', logo: '/logos/kari.svg', blurb: "Seattle artist creating custom handcrafted paintings of people’s pets.", url: 'https://www.karikoleva.com' },
  { name: 'Kkaylakwon Art', kind: 'business', logo: '/logos/kkaylakwon.svg', blurb: "Art prints by a Bellevue high school artist, sold to fund her artistic pursuits.", url: 'https://kkaylakwon-shop.fourthwall.com/' },
  { name: 'Maester.dev', kind: 'business', logo: '/logos/maester.png', blurb: "Open source framework that turns Microsoft 365 security best practices into runnable tests.", url: 'https://maester.dev' },
  // Nonprofits
  { name: 'MediGuard Health', kind: 'nonprofit', logo: '/logos/mediguard.png', blurb: "Medication safety companion that scans labels, flags drug interactions and keeps doses on schedule.", url: 'https://mediguardhealth.app/' },
  { name: 'Sewa Greentech', kind: 'nonprofit', logo: '/logos/sewa.png', blurb: "Youth-led team collecting unwanted electronics across Greater Seattle for free and recycling them responsibly.", url: 'https://www.sewagreentech.org/' },
  { name: 'Chessmasti', kind: 'nonprofit', logo: '/logos/chessmasti.png', blurb: "Free chess coaching with Masti, a friendly monkey coach, to help people play and learn.", url: 'https://www.chessmasti.com/' },
  { name: 'The Science Behind', kind: 'nonprofit', logo: '/logos/sciencebehind.png', blurb: "Passion project exploring the science behind people’s favorite things.", url: 'https://www.instagram.com/thesciencebehind.co/' },
  { name: 'Cureosity Files', kind: 'nonprofit', logo: '/logos/cureosity.png', blurb: "Youth-led initiative where medicine meets creativity, through research and design.", url: 'https://www.instagram.com/cureosityfiles/' },
  { name: 'Flashforward Foundation', kind: 'nonprofit', logo: '/logos/bulb.png', blurb: "Student-run nonprofit building solar study lights for students without electricity after dark.", url: 'https://flashforwardfoundation.org/' },
  { name: 'Bothell Hindu Temple', kind: 'nonprofit', logo: '/logos/htcc.png', blurb: "Bothell, WA temple fostering cultural, religious and spiritual understanding through pujas, classes and events.", url: 'https://htccwa.org/index.html' },
  { name: 'Bellevue Hindu Temple', kind: 'nonprofit', logo: '/logos/bellevuetemple.png', blurb: "Temple promoting Hindu spiritual and cultural understanding, with education, food and community programs.", url: 'https://bellevuehindutemple.com/' },
  { name: 'Seattle Gurdwara', kind: 'nonprofit', logo: '/logos/sikhcentre.png', blurb: "Non-profit Sikh centre offering free community kitchens, medical camps and disaster relief.", url: 'https://www.sikhcentreofseattle.org/' },
  { name: 'Gurudwara Singh Sabha of Washington', kind: 'nonprofit', logo: '/logos/gsswa.png', logoBg: '#10261d', blurb: "Sikh congregation serving as a hub for the community across Greater Seattle and the Pacific Northwest.", url: 'https://www.gsswa.org/' },
  { name: 'Pulpo Outreach', kind: 'nonprofit', logo: '/logos/pulpo.png', blurb: "Connects professors and industry experts.", url: 'https://pulporeach.base44.app/' },
  { name: 'Caplet', kind: 'nonprofit', logo: '/logos/caplet.png', blurb: "Supports creating, learning and launching anything.", url: 'https://caplet.org' },
  { name: 'Bright Futures Foundation', kind: 'nonprofit', logo: '/logos/brightfutures.png', blurb: "Youth-run nonprofit repurposing secondhand educational resources.", url: 'https://www.instagram.com/brightfuturesfoundationseattle/' },
  { name: 'Cricket for a Cause', kind: 'nonprofit', logo: '/logos/cricketcause.png', blurb: "Community group using cricket events to improve cricket facilities in Washington State.", url: 'https://www.instagram.com/crick_etforacause/' },
  { name: 'Youth Cricket Initiative', kind: 'nonprofit', logo: '/logos/youthcricket.webp', blurb: "Free, student-led group running cricket matches, coaching and community programs for young players.", url: 'https://youthcricketinitiative.lovable.app' },
  { name: 'Capable3D', kind: 'nonprofit', logo: '/logos/capable3d.png', blurb: "Rethinking waste through 3D printing.", url: 'https://www.instagram.com/capable3d/' },
  { name: 'Careline Foundation', kind: 'nonprofit', logo: '/logos/careline.png', blurb: "Youth group raising awareness of childhood cancer, operating under Bellevue Youthlink.", url: 'https://www.instagram.com/carelinefoundation/' },
  { name: 'Strokes of Young Minds', kind: 'nonprofit', logo: '/logos/strokes.svg', blurb: "Youth-led digital gallery using art to uplift young people facing mental health struggles.", url: 'https://kkaylakwon.wixsite.com/stroke-of-youngminds' },
];

const TABS = [
  { id: 'business', label: 'Businesses' },
  { id: 'nonprofit', label: 'Nonprofits' },
];

const faint = { color: 'var(--text-muted)' };

function displayHost(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const social = /(instagram|facebook)\.com$/.test(host);
    const first = u.pathname.split('/').filter(Boolean)[0];
    return social && first ? `${host}/${first}` : host;
  } catch {
    return url;
  }
}

function initials(name) {
  return (
    name
      .replace(/[^A-Za-z0-9 ]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?'
  );
}

function ClientCard({ client }) {
  return (
    <li className="w-[17.5rem] shrink-0 snap-start sm:w-[19rem]">
      <a
        href={client.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block h-full overflow-hidden border transition-colors hover:border-[var(--accent)]"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-lg)' }}
      >
        {/* Logo placeholder band */}
        <div className="flex h-28 items-center justify-center border-b" style={{ background: client.logo ? client.logoBg || '#ffffff' : '#10261d', borderColor: 'var(--border)' }}>
          {client.logo ? (
            <img
              src={client.logo}
              alt={`${client.name} logo`}
              className={client.logoFit === 'avatar' ? 'h-[5.5rem] w-[5.5rem] rounded-full object-cover object-top' : 'max-h-[5.75rem] max-w-[85%] object-contain'}
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid h-14 w-14 place-items-center rounded-xl border text-lg font-semibold"
              style={{ borderColor: 'rgba(255,255,255,0.25)', color: '#7fd1ad', letterSpacing: '0.02em' }}
            >
              {initials(client.name)}
            </span>
          )}
        </div>
        <div className="p-5">
          <h3 className="text-base font-semibold leading-snug">{client.name}</h3>
          <p className="mt-1 truncate text-sm" style={{ color: 'var(--accent)' }}>
            {displayHost(client.url)}
          </p>
          {client.blurb && (
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '4.1em' }}
            >
              {client.blurb}
            </p>
          )}
          <div className="mt-4 flex items-center justify-between">
            <span
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
            >
              {client.kind === 'nonprofit' ? 'Nonprofit' : 'Business'}
            </span>
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--accent)' }}>
              &rarr;
            </span>
          </div>
        </div>
      </a>
    </li>
  );
}

function NavButton({ dir, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir < 0 ? 'Previous' : 'Next'}
      className="grid h-10 w-10 place-items-center rounded-full border transition-opacity disabled:opacity-35"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
    >
      <span aria-hidden="true">{dir < 0 ? '←' : '→'}</span>
    </button>
  );
}

export default function LandingClients() {
  const [tab, setTab] = useState('business');
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const trackRef = useRef(null);
  const items = CLIENTS.filter((c) => c.kind === tab);

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const per = Math.max(el.clientWidth, 1);
    setPages(Math.max(1, Math.ceil(el.scrollWidth / per - 0.05)));
    setPage(Math.min(Math.round(el.scrollLeft / per), Math.max(0, Math.ceil(el.scrollWidth / per - 0.05) - 1)));
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    el.scrollLeft = 0;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [tab, measure]);

  const go = (delta) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: delta * el.clientWidth * 0.9, behavior: 'smooth' });
  };
  const goPage = (i) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <section id="clients" className="scroll-mt-16 border-t" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
            Real businesses. Real impact.
          </p>
          <h2 className="headline mt-3 text-[1.75rem] leading-[1.15] sm:text-[2.5rem]">Businesses We&rsquo;ve Helped</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg" style={{ color: 'var(--text-secondary)' }}>
            From local startups to community organizations, we partner with mission-driven teams to turn messy data
            into clear answers.
          </p>

          <div
            role="tablist"
            aria-label="Client type"
            className="mt-8 inline-flex rounded-lg p-1"
            style={{ background: 'var(--surface-sunken)' }}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
                style={
                  tab === t.id
                    ? { background: 'var(--surface-1)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-sm)' }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative mt-10">
          <ul
            ref={trackRef}
            onScroll={measure}
            aria-label={tab === 'nonprofit' ? 'Nonprofits we have helped' : 'Businesses we have helped'}
            className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-3"
            style={{ scrollbarWidth: 'none' }}
          >
            {items.map((c) => (
              <ClientCard key={c.name} client={c} />
            ))}
          </ul>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4">
          <NavButton dir={-1} onClick={() => go(-1)} disabled={page <= 0} />
          <div className="flex items-center gap-2" role="group" aria-label="Carousel pages">
            {Array.from({ length: pages }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goPage(i)}
                aria-label={`Page ${i + 1}`}
                aria-current={i === page ? 'true' : undefined}
                className="h-2 w-2 rounded-full transition-colors"
                style={{ background: i === page ? 'var(--accent)' : 'var(--border-strong)' }}
              />
            ))}
          </div>
          <NavButton dir={1} onClick={() => go(1)} disabled={page >= pages - 1} />
        </div>
        <p className="mt-4 text-center text-xs" style={faint}>
          {items.length} {tab === 'nonprofit' ? 'nonprofits' : 'businesses'}
        </p>
      </div>
    </section>
  );
}
