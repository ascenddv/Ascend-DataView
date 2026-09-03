import { useCallback, useEffect, useState } from 'react';
import {
  listMembers,
  listInvitations,
  createInvitation,
  revokeInvitation,
  removeMember,
  setOrgAscendaiEnabled,
} from '../lib/api.js';

/**
 * Team roster + (for owners) invite / revoke / remove controls. Members see the
 * roster read-only. The server enforces every owner-only action — this just
 * hides the affordances a member can't use.
 */
export default function TeamPanel({ org, currentUser }) {
  const isOwner = currentUser.role === 'owner';
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(org.ascendaiEnabled !== false);
  const [aiBusy, setAiBusy] = useState(false);

  async function toggleAscendai(next) {
    setAiBusy(true);
    setError(null);
    try {
      const res = await setOrgAscendaiEnabled(org.id, next);
      setAiEnabled(res.ascendaiEnabled);
    } catch (err) {
      setError(err.message);
    } finally {
      setAiBusy(false);
    }
  }

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const m = await listMembers(org.id);
      setMembers(m.members);
      if (isOwner) {
        const inv = await listInvitations(org.id);
        setInvites(inv.invitations);
      }
    } catch (err) {
      setError(err.message);
    }
  }, [org.id, isOwner]);

  useEffect(() => {
    if (open && members === null) refresh();
  }, [open, members, refresh]);

  async function invite(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await createInvitation(org.id, { email: email.trim(), role });
      setNotice(`Invitation sent to ${email.trim()}.`);
      setEmail('');
      setRole('member');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token) {
    setError(null);
    try {
      await revokeInvitation(org.id, token);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(userId) {
    setError(null);
    try {
      await removeMember(org.id, userId);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Team</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{open ? 'Hide' : 'Manage'}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          {error && (
            <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>{error}</p>
          )}

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Members
            </h3>
            <ul className="mt-2 divide-y" style={{ borderColor: 'var(--border)' }}>
              {(members || []).map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <span style={{ color: 'var(--text-primary)' }}>
                    {m.email}{m.isYou ? ' (you)' : ''}
                    <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>{m.role}</span>
                    {!m.emailVerified && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--status-warning, #b45309)' }}>unverified</span>
                    )}
                  </span>
                  {isOwner && !m.isYou && m.role !== 'owner' && (
                    <button
                      type="button"
                      onClick={() => remove(m.id)}
                      className="text-xs underline"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
              {members === null && (
                <li className="py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</li>
              )}
            </ul>
          </div>

          {isOwner && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    AscendAI for this organization
                  </h3>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {aiEnabled
                      ? 'Members can ask AscendAI about this org’s data.'
                      : 'AscendAI is turned off for everyone in this organization.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAscendai(!aiEnabled)}
                  disabled={aiBusy}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  {aiBusy ? '…' : aiEnabled ? 'Turn off' : 'Turn on'}
                </button>
              </div>

              <form onSubmit={invite} className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Invite someone
                </h3>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="email"
                    required
                    placeholder="teammate@example.org"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: 'var(--border)', background: 'var(--page)', color: 'var(--text-primary)' }}
                  />
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="rounded-lg border px-2 py-2 text-sm"
                    style={{ borderColor: 'var(--border)', background: 'var(--page)', color: 'var(--text-primary)' }}
                  >
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: 'var(--series-1)' }}
                  >
                    {busy ? 'Sending…' : 'Send invite'}
                  </button>
                </div>
                {notice && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{notice}</p>
                )}
              </form>

              {invites.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    Pending invitations
                  </h3>
                  <ul className="mt-2 divide-y" style={{ borderColor: 'var(--border)' }}>
                    {invites.map((i) => (
                      <li key={i.token} className="flex items-center justify-between py-2 text-sm">
                        <span style={{ color: 'var(--text-primary)' }}>
                          {i.email}
                          <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>{i.role}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => revoke(i.token)}
                          className="text-xs underline"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
