/** Phase 20 UI walkthrough: the AscendAI chat panel.
 *  node scripts/screenshot-phase20.mjs <appUrl> <outDir> <repoRoot>
 *
 * Manages the :3001 backend itself so it can swap in a bad DeepSeek key to
 * force the "unavailable" state, then restores a healthy backend on exit.
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { resolve } from 'node:path';

const [appUrl, outDir, repoRoot] = process.argv.slice(2);
const BACKEND_DIR = `${repoRoot}/backend`;
const PORT = 3001;
const stamp = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  try {
    const out = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`, { encoding: 'utf8' });
    const pids = [...new Set(out.trim().split('\n').map((l) => l.trim().split(/\s+/).pop()))];
    for (const pid of pids) try { execSync(`taskkill /PID ${pid} /F`); } catch { /* gone */ }
  } catch { /* nothing listening */ }
}
async function startBackend(extraEnv = {}, { detached = false } = {}) {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: String(PORT), ...extraEnv },
    stdio: 'ignore',
    detached,
  });
  if (detached) child.unref();
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return child; } catch { /* wait */ }
    await sleep(250);
  }
  throw new Error('backend did not become healthy');
}
async function stopBackend(child) {
  child.kill();
  freePort();
  await sleep(500);
}

const errors = [];
let browser;
let backend;
let sparseOrgId;

try {
  freePort();
  await sleep(400);
  backend = await startBackend(); // real DEEPSEEK_API_KEY comes from backend/.env via dotenv

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  { const w = await browser.newPage(); await w.goto(appUrl, { waitUntil: 'networkidle' }); await w.waitForTimeout(1000); await w.close(); }

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1200 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/api/auth/me') && !r.url().endsWith('favicon.ico') && !r.url().includes('/api/insight'))
      errors.push(`http ${r.status()}: ${r.url()}`);
  });

  // --- sign up + get past onboarding -----------------------------------
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Create one/ }).click();
  await page.getByLabel('Organization name').fill(`Phase 20 Demo ${stamp}`);
  await page.getByLabel('Email').fill(`p20_${stamp}@demo.test`);
  await page.getByLabel('Password').fill('password123');
  const [signupResp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.status() === 201),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
  sparseOrgId = (await signupResp.json()).org.id;
  await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 20000 });

  await page.getByRole('button', { name: 'Get started' }).click();
  await page.setInputFiles('input[type="file"]', resolve(repoRoot, 'data', 'fixture_rich_v2.csv'));
  await page.getByRole('dialog', { name: 'Dashboard tour' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await page.getByRole('dialog', { name: 'Dashboard tour' }).waitFor({ state: 'detached', timeout: 8000 });

  const metrics = await (await ctx.request.get(`${appUrl}/api/metrics`)).json();
  const cashLatest = metrics.kpis.find((k) => k.key === 'cash_balance').latest;
  const cashPrev = metrics.kpis.find((k) => k.key === 'cash_balance').previous;

  // --- open the panel from a dashboard view --------------------------
  await page.getByRole('button', { name: 'Ask AscendAI' }).click();
  const panel = page.getByRole('dialog', { name: 'AscendAI chat' });
  await panel.waitFor({ timeout: 8000 });
  await page.screenshot({ path: `${outDir}/p20_panel.png`, fullPage: true });
  console.log('  panel opened');

  const send = async (text) => {
    const before = await panel.locator('.whitespace-pre-wrap, [class*="border-l-2"]').count();
    await panel.getByPlaceholder('Ask about your data…').fill(text);
    await panel.getByRole('button', { name: 'Send' }).click();
    await panel.getByText('Thinking', { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await panel.getByText('Thinking', { exact: false }).first().waitFor({ state: 'detached', timeout: 45000 }).catch(() => {});
    // wait until a new message/notice block has actually landed
    for (let i = 0; i < 60; i += 1) {
      if ((await panel.locator('.whitespace-pre-wrap, [class*="border-l-2"]').count()) > before + 1) break;
      await page.waitForTimeout(500);
    }
  };
  const fmt = (n) => n.toLocaleString('en-US');

  // --- multi-turn, real traceable answers ---------------------------
  await send('What is my current cash balance?');
  const afterT1 = await panel.innerText();
  const t1ok = afterT1.includes(String(cashLatest)) || afterT1.includes(fmt(cashLatest));
  console.log(`  turn 1 cites latest cash (${cashLatest}): ${t1ok}`);

  await send('What about last month?');
  const afterT2 = await panel.innerText();
  const t2ok = afterT2.includes(String(cashPrev)) || afterT2.includes(fmt(cashPrev));
  console.log(`  turn 2 ("what about last month?") cites prior period (${cashPrev}): ${t2ok}`);
  await page.screenshot({ path: `${outDir}/p20_conversation.png`, fullPage: true });

  // --- clear conversation -----------------------------------------
  await panel.getByRole('button', { name: 'Clear', exact: true }).click();
  await panel.getByRole('button', { name: 'Clear conversation?' }).click();
  await page.waitForTimeout(500);
  const afterClear = await panel.innerText();
  const clearedUi = !afterClear.includes('What about last month?');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ask AscendAI' }).click();
  await panel.waitFor();
  await page.waitForTimeout(800);
  const afterReload = await panel.innerText();
  const clearedPersisted = !afterReload.includes('What about last month?') && !afterReload.includes('cash balance');
  console.log(`  clear conversation — UI emptied: ${clearedUi}, persisted after reload: ${clearedPersisted}`);

  // --- unavailable state (swap in a bad DeepSeek key + dead base URL) ----
  // Done BEFORE the rate-limit test: once an org is at the daily cap the route
  // short-circuits to rate_limited and never reaches the provider.
  await stopBackend(backend);
  backend = await startBackend({
    DEEPSEEK_API_KEY: 'sk-deliberately-invalid-key-000',
    DEEPSEEK_BASE_URL: 'http://127.0.0.1:9',
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ask AscendAI' }).click();
  await panel.waitFor();
  await send('How is my Financial health?');
  const un = await panel.innerText();
  const unavailableOk = /temporarily unavailable/i.test(un);
  await page.screenshot({ path: `${outDir}/p20_unavailable.png`, fullPage: true });
  console.log(`  unavailable renders friendly notice: ${unavailableOk}`);

  // --- rate_limited state (restore a healthy backend, seed usage to the cap) --
  await stopBackend(backend);
  backend = await startBackend();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ask AscendAI' }).click();
  await panel.waitFor();
  execSync(`node scripts/seed-ascendai-usage.mjs ${sparseOrgId} 50`, { cwd: BACKEND_DIR, stdio: 'ignore' });
  await send('Are you still there?');
  const rl = await panel.innerText();
  const rateLimitedOk = /message limit/i.test(rl) && /resets at 00:00 UTC/i.test(rl);
  await page.screenshot({ path: `${outDir}/p20_rate_limited.png`, fullPage: true });
  console.log(`  rate_limited renders friendly notice: ${rateLimitedOk}`);

  const dashboardStillFine = await page.getByRole('heading', { name: 'Overview' }).isVisible();
  console.log(`  dashboard still intact behind the panel: ${dashboardStillFine}`);

  console.log(`\n  console/page errors: ${errors.length}`);
  errors.forEach((e) => console.log('   ' + e));

  const pass = t1ok && t2ok && clearedUi && clearedPersisted && rateLimitedOk && unavailableOk && dashboardStillFine && errors.length === 0;
  await browser.close();
  await stopBackend(backend);
  await startBackend({}, { detached: true }); // leave a healthy backend running
  console.log(pass ? '\nPHASE 20 WALKTHROUGH PASSED' : '\nPHASE 20 WALKTHROUGH FAILED');
  process.exit(pass ? 0 : 1);
} catch (err) {
  console.error('walkthrough error:', err.message);
  try { await browser?.close(); } catch { /* */ }
  try { if (backend) await stopBackend(backend); } catch { /* */ }
  try { await startBackend({}, { detached: true }); } catch { /* */ }
  process.exit(1);
}
