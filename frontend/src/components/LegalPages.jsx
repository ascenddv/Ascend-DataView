/**
 * Public legal pages, reachable at /legal/terms and /legal/privacy (AuthGate
 * routes them by pathname — no session required). The copy is a DRAFT and must
 * be reviewed by counsel before launch.
 */

const UPDATED = '2 September 2026';

const shell = {
  wrap: 'mx-auto max-w-3xl px-6 py-12',
  h1: 'text-2xl font-semibold tracking-tight',
  h2: 'mt-8 text-base font-semibold',
  p: 'mt-3 text-sm leading-relaxed',
  li: 'mt-1.5 text-sm leading-relaxed',
};

function DraftBanner() {
  return (
    <div
      role="note"
      className="rounded-lg border px-4 py-3 text-xs font-medium"
      style={{ borderColor: 'var(--status-warning, #b45309)', background: 'var(--surface-2, #fffbeb)', color: 'var(--text-primary)' }}
    >
      DRAFT — NOT LEGAL ADVICE — needs review by counsel before this product is offered commercially.
    </div>
  );
}

function Page({ title, children }) {
  return (
    <div style={{ background: 'var(--page)', minHeight: '100vh', color: 'var(--text-primary)' }}>
      <div className={shell.wrap}>
        <a href="/" className="text-xs" style={{ color: 'var(--text-muted)' }}>← Back to AscendDV</a>
        <h1 className={shell.h1} style={{ marginTop: '0.75rem' }}>{title}</h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Last updated {UPDATED}</p>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

const SUBPROCESSORS = [
  ['Google (Gemini, paid AI Studio tier)', 'Generates the dashboard "insight" narrative and assists column mapping.', 'Computed metric aggregates only — never raw uploaded rows, never personal identifiers. Commercial-licensed tier; inputs are not used to train Google’s models.'],
  ['DeepSeek', 'Powers the AscendAI chat assistant.', 'The chat messages you send and computed metric values returned by tools. Separate prepaid account from Gemini.'],
  ['Supabase', 'Managed PostgreSQL database hosting.', 'All application data at rest: organizations, users (email + hashed password), uploaded/standardized metrics, chat history, usage logs.'],
  ['Vercel', 'Static frontend hosting and the serverless API runtime.', 'Request metadata and traffic in transit; no separate data store.'],
  ['Resend', 'Sends transactional email (verification, password reset, team invites).', 'Recipient email address and the message content of those emails.'],
  ['Sentry (optional, if configured)', 'Aggregates backend errors and frontend crashes for reliability monitoring.', 'Error messages and stack traces with secrets and identifiers redacted before transmission.'],
];

export function PrivacyPage() {
  return (
    <Page title="Privacy Policy">
      <DraftBanner />

      <h2 className={shell.h2}>What this covers</h2>
      <p className={shell.p}>
        AscendDV (“the Service”) is an analytics tool for organizations with incomplete data. This
        policy describes what the Service collects, why, who processes it on our behalf, how long it
        is kept, and how to have it deleted or exported.
      </p>

      <h2 className={shell.h2}>Data we collect</h2>
      <ul>
        <li className={shell.li}><b>Account data:</b> your email address, a bcrypt hash of your password (never the password itself), your organization name, and your role (owner or member).</li>
        <li className={shell.li}><b>Data you upload:</b> the CSV/spreadsheet figures you import and the standardized metrics derived from them. Uploads are expected to be organizational figures, not personal data; the ingestion layer rejects rows that look like they contain identifiers.</li>
        <li className={shell.li}><b>AscendAI chat:</b> the messages you send to the assistant and its replies, stored per user so your conversation persists.</li>
        <li className={shell.li}><b>Operational logs:</b> one line per API request (method, path, status, timing, organization id) and error reports. Secrets, cookies and tokens are redacted before anything is logged.</li>
      </ul>

      <h2 className={shell.h2}>Sub-processors</h2>
      <p className={shell.p}>We use the following third parties to operate the Service. Each receives only the data category listed.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="py-1 pr-4 font-medium">Sub-processor</th>
              <th className="py-1 pr-4 font-medium">Purpose</th>
              <th className="py-1 font-medium">Data category</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map(([name, purpose, data]) => (
              <tr key={name} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="py-2 pr-4 align-top">{name}</td>
                <td className="py-2 pr-4 align-top" style={{ color: 'var(--text-secondary)' }}>{purpose}</td>
                <td className="py-2 align-top" style={{ color: 'var(--text-secondary)' }}>{data}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className={shell.h2}>Cookies</h2>
      <p className={shell.p}>
        The Service sets exactly one cookie: a first-party, HTTP-only session cookie
        (<code>ascenddv_token</code>) that keeps you signed in. It is not used for advertising or
        cross-site tracking, and there are no third-party cookies.
      </p>

      <h2 className={shell.h2}>Retention</h2>
      <ul>
        <li className={shell.li}>Account and uploaded metric data: kept until you delete the record or the organization.</li>
        <li className={shell.li}>AscendAI chat messages: pruned after 90 days.</li>
        <li className={shell.li}>AscendAI usage counters: kept ~400 days for year-over-year cost visibility.</li>
        <li className={shell.li}>Verification, reset and invitation tokens: deleted within ~7 days of use or expiry.</li>
      </ul>

      <h2 className={shell.h2}>Your rights</h2>
      <ul>
        <li className={shell.li}><b>Export:</b> an owner can download a full JSON copy of the organization’s data from Settings → Danger zone (or <code>GET /api/account/export</code>).</li>
        <li className={shell.li}><b>Deletion:</b> an owner can permanently delete the organization and every associated record from the same place. This cascades to all users, datasets, chat history and usage logs and cannot be undone.</li>
        <li className={shell.li}><b>Correction:</b> re-upload corrected figures (uploads merge by period) or contact us.</li>
      </ul>

      <h2 className={shell.h2}>Contact</h2>
      <p className={shell.p}>Add a contact address here before launch.</p>
    </Page>
  );
}

export function TermsPage() {
  return (
    <Page title="Terms of Service">
      <DraftBanner />

      <h2 className={shell.h2}>1. The Service</h2>
      <p className={shell.p}>
        AscendDV ingests the data you provide, computes only the metrics that data can support, and
        renders only the dashboard elements it can substantiate. AI-generated narratives and the
        AscendAI assistant describe your data; they do not compute figures and may be unavailable
        without affecting the rest of the dashboard.
      </p>

      <h2 className={shell.h2}>2. Accounts</h2>
      <p className={shell.p}>
        You must provide a valid email address, verify it to use uploads / AscendAI / invitations,
        and keep your password confidential. You are responsible for activity under your account.
        The organization owner controls membership and can remove members or delete the organization.
      </p>

      <h2 className={shell.h2}>3. Acceptable use</h2>
      <ul>
        <li className={shell.li}>Do not upload personal data of individuals where you lack a lawful basis to process it. The Service is designed for organizational figures.</li>
        <li className={shell.li}>Do not attempt to access another organization’s data, probe for vulnerabilities without authorization, or use automated clients to exceed the published rate limits.</li>
        <li className={shell.li}>Do not use AscendAI for purposes unrelated to understanding your own dashboard data.</li>
      </ul>

      <h2 className={shell.h2}>4. AI features and third parties</h2>
      <p className={shell.p}>
        Insight generation uses Google’s Gemini (commercial tier) and AscendAI uses DeepSeek, each
        receiving only computed values as described in the Privacy Policy. These features are
        provided “as is”; narratives may be incomplete or, despite guardrails, imperfect. Verify
        anything material against the underlying figures.
      </p>

      <h2 className={shell.h2}>5. Availability</h2>
      <p className={shell.p}>
        The Service is offered without an uptime commitment during this phase. A provider outage
        (database or an AI vendor) degrades gracefully: the dashboard continues to render the data
        it has.
      </p>

      <h2 className={shell.h2}>6. Data ownership</h2>
      <p className={shell.p}>
        You retain all rights to the data you upload. You grant us a limited licence to process it
        solely to operate the Service for you, including transmitting the computed values described
        in the Privacy Policy to the listed sub-processors.
      </p>

      <h2 className={shell.h2}>7. Termination</h2>
      <p className={shell.p}>
        You may delete your organization at any time. We may suspend an account that violates these
        terms. On deletion, data is removed as described in the Privacy Policy.
      </p>

      <h2 className={shell.h2}>8. Liability</h2>
      <p className={shell.p}>
        To the extent permitted by law, the Service is provided “as is” without warranties, and our
        liability is limited. Final limitation and indemnity language is to be set by counsel.
      </p>

      <h2 className={shell.h2}>9. Changes</h2>
      <p className={shell.p}>
        We may update these terms. The version in effect is the one published on this page, and the
        “Last updated” date above reflects the most recent change. Your continued use of the Service
        after a change constitutes acceptance of the updated terms.
      </p>
    </Page>
  );
}
