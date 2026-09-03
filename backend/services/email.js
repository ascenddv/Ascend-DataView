/**
 * Transactional email (Stage 5, Phase 25).
 *
 * One entry point — `sendEmail({ to, subject, html, text })`. With RESEND_API_KEY
 * set it goes out through Resend's REST API; otherwise it drops to a dev logger
 * that prints the message (and any link inside it) to the console so local runs
 * and the phase gate can complete the verify / reset flows without real mail.
 *
 * `EMAIL_FROM` is the sender ("AscendDV <noreply@yourdomain>"); `APP_BASE_URL`
 * is the origin used to build links (falls back to localhost for dev).
 *
 * A send failure never throws into a request handler — the caller decides
 * whether a missing email is fatal (it generally is not: the user can re-request
 * a verification or reset link). `sendEmail` returns { ok, id?, error?, dev? }.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 8000;

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
}
function emailFrom() {
  return process.env.EMAIL_FROM || 'AscendDV <onboarding@resend.dev>';
}
function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

const LINK_RE = /https?:\/\/[^\s"'<>)]+/g;

async function sendViaResend({ to, subject, html, text }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: emailFrom(), to: [to], subject, html, text }),
      signal: ac.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`EMAIL_SEND_FAILURE resend ${res.status}: ${body && body.message ? body.message : 'unknown'}`);
      return { ok: false, error: `email provider returned ${res.status}` };
    }
    return { ok: true, id: body.id };
  } catch (err) {
    console.error(`EMAIL_SEND_FAILURE resend: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function sendViaDevLogger({ to, subject, text, html }) {
  const links = String(text || html || '').match(LINK_RE) || [];
  const lines = [
    '',
    '  ┌─ DEV EMAIL (no RESEND_API_KEY set) ────────────────────────',
    `  │ to:      ${to}`,
    `  │ subject: ${subject}`,
    ...links.map((l) => `  │ link:    ${l}`),
    '  └───────────────────────────────────────────────────────────',
    '',
  ];
  console.log(lines.join('\n'));
  return { ok: true, dev: true, links };
}

async function sendEmail({ to, subject, html, text }) {
  if (!to || !subject) return { ok: false, error: 'sendEmail requires `to` and `subject`' };
  return isConfigured()
    ? sendViaResend({ to, subject, html, text })
    : sendViaDevLogger({ to, subject, html, text });
}

/* -- ready-made messages ------------------------------------------------- */

function verificationEmail(email, token) {
  const link = `${appBaseUrl()}/verify-email?token=${token}`;
  return {
    to: email,
    subject: 'Verify your email for AscendDV',
    text:
      `Welcome to AscendDV.\n\nConfirm this email address to unlock uploads, AscendAI and team invites:\n${link}\n\n` +
      `This link expires in 24 hours. If you didn't create an account, you can ignore this message.`,
    html:
      `<p>Welcome to AscendDV.</p><p>Confirm this email address to unlock uploads, AscendAI and team invites:</p>` +
      `<p><a href="${link}">${link}</a></p><p>This link expires in 24 hours. If you didn't create an account, you can ignore this message.</p>`,
  };
}

function passwordResetEmail(email, token) {
  const link = `${appBaseUrl()}/reset-password?token=${token}`;
  return {
    to: email,
    subject: 'Reset your AscendDV password',
    text:
      `A password reset was requested for your AscendDV account.\n\nSet a new password:\n${link}\n\n` +
      `This link expires in 1 hour and can be used once. If you didn't ask for this, ignore this message — your password is unchanged.`,
    html:
      `<p>A password reset was requested for your AscendDV account.</p><p>Set a new password:</p>` +
      `<p><a href="${link}">${link}</a></p><p>This link expires in 1 hour and can be used once. ` +
      `If you didn't ask for this, ignore this message — your password is unchanged.</p>`,
  };
}

module.exports = {
  sendEmail,
  isConfigured,
  appBaseUrl,
  verificationEmail,
  passwordResetEmail,
};
