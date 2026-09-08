/**
 * Visual pass for the Stage 5 UI overhaul. Runs the real Vite dev server and
 * the real React app, but fulfils every /api/* call from test fixtures via
 * Playwright routing — no backend, no DB, no email verification needed.
 *
 *   node scripts/screenshot-uioverhaul.mjs [outDir]
 *
 * Captures: auth page, dashboard (light/dark, 3 widths), a dimension view,
 * the Data section, Settings (Appearance / Team), and AscendAI open.
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const outDir = process.argv[2] || here('../.uioverhaul-shots');
const PORT = 5273;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fx = (name) => JSON.parse(readFileSync(here(`../test/fixtures/${name}.json`)));

mkdirSync(outDir, { recursive: true });

function freePort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
    const pids = [...new Set(out.trim().split('\n').map((l) => l.trim().split(/\s+/).pop()))];
    for (const pid of pids) try { execSync(`taskkill /PID ${pid} /F`); } catch { /* gone */ }
  } catch { /* nothing listening */ }
}

const SESSION = {
  ok: true,
  authenticated: true,
  user: { id: 1, email: 'founder@meridian.org', role: 'owner', emailVerified: true },
  org: { id: 1, name: 'Meridian Foundation', onboardingCompleted: true, ascendaiEnabled: true },
};

const ROUTES = {
  'GET /api/auth/me': () => SESSION,
  'GET /api/metrics': () => fx('metrics_rich_v2'),
  'GET /api/insight': () => fx('insight_rich'),
  'GET /api/ascendai/usage': () => ({ ok: true, enabled: true, today: { count: 2, limit: 50 } }),
  'GET /api/ascendai/chat': () => ({
    ok: true,
    messages: [
      { role: 'user', content: 'Which dimension is strongest right now?' },
      {
        role: 'assistant',
        content:
          'Growth leads with a health score of 58 — revenue rose 10.9% to 34,600 last period, outpacing a 9.4% rise in expenses.',
      },
    ],
  }),
  'GET /api/schema': () => ({
    ok: true,
    fields: [
      { name: 'period', type: 'date', required: true, category: 'Core' },
      { name: 'revenue', type: 'number', required: true, category: 'Financial' },
      { name: 'expenses', type: 'number', required: true, category: 'Financial' },
      { name: 'cash_balance', type: 'number', required: false, category: 'Financial' },
      { name: 'donors_total', type: 'number', required: false, category: 'Community' },
      { name: 'volunteers_active', type: 'number', required: false, category: 'Community' },
    ],
  }),
  'GET /api/organizations/1/members': () => ({
    ok: true,
    members: [
      { id: 1, email: 'founder@meridian.org', role: 'owner', isYou: true, emailVerified: true },
      { id: 2, email: 'analyst@meridian.org', role: 'member', isYou: false, emailVerified: true },
    ],
  }),
  'GET /api/organizations/1/invitations': () => ({ ok: true, invitations: [] }),
};

async function fulfil(route, request) {
  const key = `${request.method()} ${new URL(request.url()).pathname}`;
  const body = ROUTES[key] ? ROUTES[key]() : { ok: true };
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

let vite;
let browser;
try {
  freePort(PORT);
  vite = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    cwd: here('..'),
    stdio: 'ignore',
    shell: true,
  });
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch { /* wait */ }
    await sleep(250);
  }

  browser = await chromium.launch({ channel: 'chrome', headless: true });

  const shot = async (name, { width = 1440, theme = 'system', prep } = {}) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript((t) => {
      try {
        localStorage.setItem('ascenddv.prefs', JSON.stringify({ theme: t }));
      } catch { /* ignore */ }
    }, theme);
    await context.route('**/api/**', fulfil);
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    try {
      if (prep) await prep(page);
    } catch (e) {
      console.warn(`  prep for ${name} failed: ${e.message}`);
    }
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
    await context.close();
  };

  // Auth (no session)
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/api/**', (route, request) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, authenticated: false }),
      })
    );
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${outDir}/01-auth-light.png`, fullPage: true });
    await context.close();
  }

  await shot('02-dashboard-light-1440', { theme: 'light' });
  await shot('03-dashboard-dark-1440', { theme: 'dark' });
  await shot('04-dashboard-1024', { width: 1024, theme: 'light' });
  await shot('05-dashboard-375', { width: 375, theme: 'light' });
  await shot('06-dimension-people', {
    theme: 'light',
    prep: async (page) => {
      await page.getByRole('button', { name: 'People', exact: true }).click();
      await page.waitForTimeout(400);
    },
  });
  await shot('07-data-section', {
    theme: 'light',
    prep: async (page) => {
      await page.getByRole('button', { name: 'Data', exact: true }).click();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add a single period manually/i }).click();
      await page.waitForTimeout(400);
    },
  });
  await shot('08-settings-appearance', {
    theme: 'light',
    prep: async (page) => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.waitForTimeout(400);
    },
  });
  await shot('09-settings-appearance-dark', {
    theme: 'dark',
    prep: async (page) => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.waitForTimeout(400);
    },
  });
  await shot('10-settings-team', {
    theme: 'light',
    prep: async (page) => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Team', exact: true }).click();
      await page.waitForTimeout(300);
      await page.getByText('Manage', { exact: true }).click();
      await page.waitForTimeout(500);
    },
  });
  await shot('11-ascendai-open', {
    theme: 'dark',
    prep: async (page) => {
      await page.getByRole('button', { name: 'Ask AscendAI' }).first().click();
      await page.waitForTimeout(500);
    },
  });

  console.log(`\nScreenshots written to ${outDir}`);
} finally {
  if (browser) await browser.close();
  if (vite) vite.kill();
  freePort(PORT);
}
