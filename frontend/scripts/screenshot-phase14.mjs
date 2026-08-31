/** Phase 14 UI walkthrough: mapping confirmation -> confidence badges -> (i) definitions.
 *  node scripts/screenshot-phase14.mjs <appUrl> <outDir> <repoRoot>
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [appUrl, outDir, repoRoot] = process.argv.slice(2);
const { hashHeaders } = require(resolve(repoRoot, 'backend/services/mapColumns.js'));
const { putCachedMapping, closeDb } = require(resolve(repoRoot, 'backend/db'));

const MESSY_HEADERS = ['Month', 'Rev ($)', 'Total Expenses', 'Cash on Hand', 'Other Income', 'Total Donors', 'New Donors'];
const MESSY_MAPPING = {
  'Month': { field: 'period_date', confidence: 0.9, source: 'llm' },
  'Rev ($)': { field: 'revenue', confidence: 0.58, source: 'llm' },
  'Total Expenses': { field: 'expenses', confidence: 0.62, source: 'llm' },
  'Cash on Hand': { field: 'cash_balance', confidence: 0.9, source: 'llm' },
  'Other Income': { field: 'revenue_other', confidence: 0.45, source: 'llm' },
  'Total Donors': { field: 'donors_total', confidence: 0.9, source: 'llm' },
  'New Donors': { field: 'donors_new', confidence: 0.9, source: 'llm' },
};

const stamp = Date.now();
const b = await chromium.launch({ channel: 'chrome', headless: true });
{ const w = await b.newPage(); await w.goto(appUrl, { waitUntil: 'networkidle' }); await w.waitForTimeout(1000); await w.close(); }

const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('/api/insight') && !r.url().endsWith('/api/auth/me') && !r.url().endsWith('favicon.ico'))
    errors.push(`http ${r.status()}: ${r.url()}`);
});

const orgName = `Phase 14 Demo ${stamp}`;
await page.goto(appUrl, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Create one/ }).click();
await page.getByLabel('Organization name').fill(orgName);
await page.getByLabel('Email').fill(`p14demo_${stamp}@demo.test`);
await page.getByLabel('Password').fill('password123');
await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.status() === 201),
  page.getByRole('button', { name: 'Create account' }).click(),
]);
await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 20000 });

// seed this org's mapping cache so the messy headers come back low-confidence
const me = await page.evaluate(() => fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()));
await putCachedMapping(me.org.id, hashHeaders(MESSY_HEADERS), MESSY_MAPPING);

// 1) upload the messy file -> mapping confirmation appears BEFORE anything is stored
await page.setInputFiles('input[type="file"]', resolve(repoRoot, 'data', 'fixture_messy.csv'));
await page.getByRole('heading', { name: /Confirm 3 column matches before saving/ }).waitFor({ timeout: 30000 });
await page.getByText('nothing from this file is stored until you confirm').waitFor();
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/p14_mapping.png`, fullPage: true });
console.log('  mapping confirmation step captured');

// 2) correct one mapping (ignore "Other Income"), confirm the rest, save
await page.locator('label:has-text("Field for Other Income") select').selectOption('');
await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/upload/confirm') && r.status() === 200),
  page.getByRole('button', { name: 'Confirm and save' }).click(),
]);
await page.getByText(/applied the matches you confirmed/).waitFor({ timeout: 15000 });
await page.getByText('Generating insight…').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);

// 3) confidence badge -> hover reveals the plain-language "why"
const mediumBadge = page.getByRole('button', { name: /Medium confidence/ }).first();
await mediumBadge.scrollIntoViewIfNeeded();
await mediumBadge.hover();
await page.getByRole('tooltip').filter({ hasText: /matched by name similarity/ }).first().waitFor({ timeout: 8000 });
await page.screenshot({ path: `${outDir}/p14_confidence.png`, fullPage: true });
console.log('  confidence badge + explanation captured');

// 4) (i) affordance -> definition + typical range, sourced from metricDefinitions.js
const infoBtn = page.getByRole('button', { name: /^About / }).first();
await infoBtn.scrollIntoViewIfNeeded();
await infoBtn.hover();
await page.getByRole('tooltip').filter({ hasText: 'Typically:' }).first().waitFor({ timeout: 8000 });
await page.screenshot({ path: `${outDir}/p14_definition.png`, fullPage: true });
console.log('  metric definition popover captured');

console.log(`\n  console/page errors: ${errors.length}`);
errors.forEach((e) => console.log('   ' + e));
await b.close();
await closeDb().catch(() => {});
process.exit(errors.length === 0 ? 0 : 1);
