/**
 * Phase 8 gate screenshots: two organizations, isolated dashboards, side by side.
 * Each org signs up through the real UI, uploads its own fixture, and its
 * dashboard is captured in a separate browser context (separate cookie jar).
 *
 *   node scripts/screenshots-tenancy.mjs <appUrl> <outDir> <repoRoot>
 */

import { chromium } from 'playwright';
import { resolve } from 'node:path';

const [appUrl, outDir, repoRoot] = process.argv.slice(2);
const stamp = Date.now();

const ORGS = [
  { key: 'orgA', orgName: `Org Alpha ${stamp}`, email: `alpha_${stamp}@demo.test`, fixture: 'rich' },
  { key: 'orgB', orgName: `Org Beta ${stamp}`, email: `beta_${stamp}@demo.test`, fixture: 'sparse' },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let errorCount = 0;

// Warm the Vite dev server (first hit triggers dep pre-bundling / a stray 404).
{
  const warm = await browser.newPage();
  await warm.goto(appUrl, { waitUntil: 'networkidle' });
  await warm.waitForTimeout(1500);
  await warm.close();
}

for (const org of ORGS) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/api/insight') && !r.url().endsWith('favicon.ico')) {
      // 401 on /api/auth/me before login is the expected "no session" probe.
      if (!r.url().endsWith('/api/auth/me')) errors.push(`http ${r.status()}: ${r.url()}`);
    }
  });

  await page.goto(appUrl, { waitUntil: 'networkidle' });

  // Sign up through the UI.
  await page.getByRole('button', { name: /Create one/ }).click();
  await page.getByLabel('Organization name').fill(org.orgName);
  await page.getByLabel('Email').fill(org.email);
  await page.getByLabel('Password').fill('password123');
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.status() === 201),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);

  // Land in the workspace, then upload this org's fixture.
  await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 20000 });
  await page.setInputFiles('input[type="file"]', resolve(repoRoot, `data/fixture_${org.fixture}.csv`));
  await page.getByRole('heading', { name: /Loaded fixture_/ }).waitFor({ timeout: 30000 });
  await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 30000 });
  await page.getByText('Generating insight…').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);

  const file = `${outDir}/tenancy_${org.key}.png`;
  await page.screenshot({ path: file, fullPage: true });

  const periods = await page.getByText(/monthly periods/).first().innerText().catch(() => '?');
  console.log(`${org.key} (${org.orgName}) -> ${file}  | ${periods.trim()}  | console errors: ${errors.length}`);
  errors.forEach((e) => console.log(`   ${e}`));
  errorCount += errors.length;
  await context.close();
}

await browser.close();
console.log(errorCount === 0 ? '\nNo console/page errors.' : `\n${errorCount} error line(s).`);
process.exit(errorCount === 0 ? 0 : 1);
