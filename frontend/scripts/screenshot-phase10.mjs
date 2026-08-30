/** Phase 10 screenshot: sign up, upload the .xlsx, then add a period via the
 *  manual-entry form. Confirms both new ingestion paths in the real UI.
 *  node scripts/screenshot-phase10.mjs <appUrl> <outFile> <repoRoot>
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const [appUrl, outFile, repoRoot] = process.argv.slice(2);
const stamp = Date.now();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
{
  const w = await browser.newPage();
  await w.goto(appUrl, { waitUntil: 'networkidle' });
  await w.waitForTimeout(1200);
  await w.close();
}
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('/api/insight') && !r.url().endsWith('/api/auth/me') && !r.url().endsWith('favicon.ico'))
    errors.push(`http ${r.status()}: ${r.url()}`);
});

await page.goto(appUrl, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Create one/ }).click();
await page.getByLabel('Organization name').fill(`Phase 10 Demo ${stamp}`);
await page.getByLabel('Email').fill(`p10demo_${stamp}@demo.test`);
await page.getByLabel('Password').fill('password123');
await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.status() === 201),
  page.getByRole('button', { name: 'Create account' }).click(),
]);
await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 20000 });

// 1) upload the .xlsx through the same control the CSV uses
await page.setInputFiles('input[type="file"]', resolve(repoRoot, 'data', 'fixture_rich_v2.xlsx'));
await page.getByRole('heading', { name: /Loaded fixture_rich_v2\.xlsx/ }).waitFor({ timeout: 30000 });
await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 30000 });

// 2) add a new period via the manual-entry form
await page.getByRole('button', { name: /Add a single period manually/ }).click();
await page.getByText('Loading fields…').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
const fill = async (name, val) => {
  await page.locator(`label:has-text("${name}") input`).first().fill(val);
};
await fill('period_date', '2026-01-31');
await fill('revenue', '$36,900');
await fill('expenses', '32100');
await fill('cash_balance', '124000');
await page.getByRole('button', { name: 'Add period' }).click();
await page.getByText(/Added 2026-01-31/).waitFor({ timeout: 15000 });
await page.getByText('13 monthly periods').waitFor({ timeout: 15000 });
await page.getByText('Generating insight…').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(400);

await page.screenshot({ path: outFile, fullPage: true });
console.log(`${outFile}  | console errors: ${errors.length}`);
errors.forEach((e) => console.log('  ' + e));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
