/** Thin client for the AscendDV backend. Every call carries the auth cookie. */

const opts = (extra = {}) => ({ credentials: 'include', ...extra });

async function asJson(res, label) {
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json body */
  }
  if (!res.ok) {
    const msg = (json && json.error) || `${label} failed: HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

/* --- data ------------------------------------------------------------- */

export async function fetchMetrics(signal) {
  return asJson(await fetch('/api/metrics', opts({ signal })), 'GET /api/metrics');
}

export async function fetchInsight(signal) {
  return asJson(await fetch('/api/insight', opts({ signal })), 'GET /api/insight');
}

/** Point-in-time Overview snapshot as a PDF blob (scoped to the session's org). */
export async function downloadOverviewPdf() {
  const res = await fetch('/api/report.pdf', opts());
  if (!res.ok) {
    const err = new Error(`PDF export failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename="([^"]+)"/.exec(cd);
  return { blob, filename: m ? m[1] : 'ascenddv-overview.pdf' };
}

/* --- AscendAI chat (Stage 4) --------------------------------------- */

export async function fetchChatHistory() {
  return asJson(await fetch('/api/ascendai/chat', opts()), 'GET /api/ascendai/chat');
}

export async function fetchAscendaiUsage() {
  return asJson(await fetch('/api/ascendai/usage', opts()), 'GET /api/ascendai/usage');
}

/**
 * Send one chat turn. Resolves to { status, reply, reason } where status is
 * 'ok' | 'unavailable' | 'rate_limited' — the degraded statuses are a normal
 * 200 response the caller renders, not an error.
 */
export async function sendChatMessage(message) {
  return asJson(
    await fetch('/api/ascendai/chat', opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })),
    'AscendAI chat'
  );
}

export async function clearChat() {
  return asJson(
    await fetch('/api/ascendai/chat', opts({ method: 'DELETE' })),
    'clear AscendAI chat'
  );
}

export async function submitManualEntry(values) {
  return asJson(
    await fetch('/api/manual-entry', opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    })),
    'manual entry'
  );
}

/**
 * Finish an upload that paused on the column-mapping confirmation step.
 * `corrections` is { [header]: canonicalFieldName | null } for each flagged header.
 */
export async function confirmUpload(pendingId, corrections) {
  return asJson(
    await fetch('/api/upload/confirm', opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingId, corrections }),
    })),
    'confirm upload'
  );
}

/** The canonical field dictionary (used by manual entry and the CSV template). */
export async function fetchSchema() {
  return asJson(await fetch('/api/schema', opts()), 'GET /api/schema');
}

/** Phase 17: mark the first-run wizard + tour as done for this org. Idempotent. */
export async function completeOnboarding(orgId) {
  return asJson(
    await fetch(`/api/organizations/${orgId}/onboarding-complete`, opts({ method: 'POST' })),
    'complete onboarding'
  );
}

/** Destructive: wipe all of the acting org's data. `confirm` must be the org name. */
export async function resetOrgData(orgId, confirm) {
  return asJson(
    await fetch(`/api/organizations/${orgId}/data`, opts({
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    })),
    'reset data'
  );
}

/* --- auth ----------------------------------------------------------- */

export async function getMe() {
  const res = await fetch('/api/auth/me', opts());
  if (res.status === 401) return null; // defensive; the endpoint normally 200s
  const json = await asJson(res, 'GET /api/auth/me');
  return json && json.authenticated ? json : null;
}

export async function login({ email, password }) {
  return asJson(
    await fetch('/api/auth/login', opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })),
    'login'
  );
}

export async function signup({ email, password, orgName }) {
  return asJson(
    await fetch('/api/auth/signup', opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, orgName }),
    })),
    'signup'
  );
}

export async function logout() {
  return asJson(await fetch('/api/auth/logout', opts({ method: 'POST' })), 'logout');
}

export async function logoutAll() {
  return asJson(await fetch('/api/auth/logout-all', opts({ method: 'POST' })), 'logout-all');
}

export async function verifyEmail(token) {
  return asJson(
    await fetch('/api/auth/verify-email', opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })),
    'verify email'
  );
}

export async function resendVerification() {
  return asJson(await fetch('/api/auth/resend-verification', opts({ method: 'POST' })), 'resend verification');
}

export async function forgotPassword(email) {
  return asJson(
    await fetch('/api/auth/forgot-password', opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })),
    'forgot password'
  );
}

export async function resetPassword(token, password) {
  return asJson(
    await fetch('/api/auth/reset-password', opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })),
    'reset password'
  );
}

export async function acceptInvite(token, password) {
  return asJson(
    await fetch('/api/auth/accept-invite', opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })),
    'accept invite'
  );
}

/* --- team (Phase 26) --------------------------------------------------- */

export async function listMembers(orgId) {
  return asJson(await fetch(`/api/organizations/${orgId}/members`, opts()), 'list members');
}

export async function removeMember(orgId, userId) {
  return asJson(
    await fetch(`/api/organizations/${orgId}/members/${userId}`, opts({ method: 'DELETE' })),
    'remove member'
  );
}

export async function listInvitations(orgId) {
  return asJson(await fetch(`/api/organizations/${orgId}/invitations`, opts()), 'list invitations');
}

export async function createInvitation(orgId, { email, role }) {
  return asJson(
    await fetch(`/api/organizations/${orgId}/invitations`, opts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })),
    'create invitation'
  );
}

export async function revokeInvitation(orgId, token) {
  return asJson(
    await fetch(`/api/organizations/${orgId}/invitations/${token}`, opts({ method: 'DELETE' })),
    'revoke invitation'
  );
}

/* --- account lifecycle (Phase 27) ----------------------------------- */

/** Full JSON export of the org's data as a downloadable blob. */
export async function exportAccount() {
  const res = await fetch('/api/account/export', opts());
  if (!res.ok) {
    const err = new Error(`Export failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename="([^"]+)"/.exec(cd);
  return { blob, filename: m ? m[1] : 'ascenddv-export.json' };
}

export async function setOrgAscendaiEnabled(orgId, ascendaiEnabled) {
  return asJson(
    await fetch(`/api/organizations/${orgId}`, opts({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ascendaiEnabled }),
    })),
    'update org settings'
  );
}

export async function deleteOrganization(orgId, confirm) {
  return asJson(
    await fetch(`/api/organizations/${orgId}`, opts({
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    })),
    'delete organization'
  );
}
