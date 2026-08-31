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
