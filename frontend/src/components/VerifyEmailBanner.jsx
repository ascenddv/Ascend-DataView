import { useState } from 'react';
import { resendVerification } from '../lib/api.js';

/**
 * Persistent notice shown across the app while the signed-in user's email is
 * unverified. Uploads, AscendAI, invites and export are blocked server-side
 * (requireVerified) until they follow the link; this explains why and lets
 * them re-send it.
 */
export default function VerifyEmailBanner({ email }) {
  const [state, setState] = useState('idle'); // idle | sending | sent | error

  async function resend() {
    setState('sending');
    try {
      await resendVerification();
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <div
      role="status"
      className="adv-fade-down flex flex-wrap items-center justify-between gap-3 border px-4 py-3 text-sm"
      style={{
        borderColor: 'var(--status-warning)',
        background: 'color-mix(in srgb, var(--status-warning) 12%, var(--surface-1))',
        color: 'var(--text-primary)',
        borderRadius: 'var(--radius)',
      }}
    >
      <span>
        Verify your email{email ? ` (${email})` : ''} to enable uploads, AscendAI and team invites.
        Check your inbox for the link.
      </span>
      <span className="flex items-center gap-2">
        {state === 'sent' ? (
          <span style={{ color: 'var(--text-secondary)' }}>New link sent — check your inbox.</span>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={state === 'sending'}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {state === 'sending' ? 'Sending…' : 'Resend verification email'}
          </button>
        )}
        {state === 'error' && (
          <span role="alert" style={{ color: 'var(--status-critical)' }}>
            Couldn’t send — try again shortly.
          </span>
        )}
      </span>
    </div>
  );
}
