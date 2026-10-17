import { useState } from 'react';
import { Button, Input, Field } from './ui/primitives.jsx';

/**
 * Contact section for the public landing page: heading and details on the
 * left, a form card on the right. There is no public contact endpoint (it
 * would be an unauthenticated spam vector), so the form composes a prefilled
 * email to the team address via mailto:.
 */

export const CONTACT_EMAIL = 'ascenddv@gmail.com';
const LOCATION = 'Bellevue, Washington';

const muted = { color: 'var(--text-secondary)' };
const faint = { color: 'var(--text-muted)' };

function buildMailto({ name, email, org, message }) {
  const subject = `AscendDV inquiry from ${name}${org ? ` (${org})` : ''}`;
  const body = `${message}\n\n--\n${name}${org ? `\n${org}` : ''}\n${email}`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em]" style={faint}>{label}</dt>
      <dd className="mt-1 text-lg font-medium">{children}</dd>
    </div>
  );
}

export default function LandingContact() {
  const [form, setForm] = useState({ name: '', email: '', org: '', message: '' });
  const [opened, setOpened] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function onSubmit(e) {
    e.preventDefault();
    window.location.href = buildMailto({
      name: form.name.trim(),
      email: form.email.trim(),
      org: form.org.trim(),
      message: form.message.trim(),
    });
    setOpened(true);
  }

  return (
    <section id="contact" className="scroll-mt-16 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
        <div>
          <span className="block h-1 w-12 rounded-full" style={{ background: 'var(--accent)' }} />
          <h2 className="headline mt-6 text-[2rem] leading-[1.1] sm:text-[2.75rem]">Let&rsquo;s talk about your data.</h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed" style={muted}>
            Curious about AscendDV, or have data you want help making sense of? Send us a note and we&rsquo;ll write
            back.
          </p>

          <dl className="mt-10 space-y-6">
            <Detail label="Based in">{LOCATION}</Detail>
            <Detail label="Email">
              <a href={`mailto:${CONTACT_EMAIL}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                {CONTACT_EMAIL}
              </a>
            </Detail>
          </dl>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 border p-6 sm:p-8"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-lg)' }}
        >
          <Field label="Your name">
            <Input value={form.name} onChange={set('name')} autoComplete="name" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
            </Field>
            <Field label="Organization (optional)">
              <Input value={form.org} onChange={set('org')} autoComplete="organization" />
            </Field>
          </div>
          <Field label="Message">
            <textarea
              value={form.message}
              onChange={set('message')}
              required
              rows={5}
              className="w-full resize-y rounded-[10px] border px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-[120ms] focus:shadow-[0_0_0_3px_var(--accent-weak)]"
              style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', borderColor: 'var(--border-strong)' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
            />
          </Field>

          <Button type="submit" size="lg" className="w-full">
            Send message
          </Button>

          <p role="status" className="text-center text-xs" style={faint}>
            {opened
              ? `Your email app should have opened. If not, write to ${CONTACT_EMAIL}.`
              : 'This opens your email app with the message ready to send.'}
          </p>
        </form>
      </div>
    </section>
  );
}
