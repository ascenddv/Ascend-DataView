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
