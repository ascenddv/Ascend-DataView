/** Phase 16 UI walkthrough: the Overview "Download PDF" control.
 *  node scripts/screenshot-phase16.mjs <appUrl> <outDir> <repoRoot>
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { statSync } from 'node:fs';

const [appUrl, outDir, repoRoot] = process.argv.slice(2);
const stamp = Date.now();
const b = await chromium.launch({ channel: 'chrome', headless: true });
{ const w = await b.newPage(); await w.goto(appUrl, { waitUntil: 'networkidle' }); await w.waitForTimeout(1000); await w.close(); }

const ctx = await b.newContext({ viewport: { width: 1280, height: 1300 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('/api/insight') && !r.url().endsWith('/api/auth/me') && !r.url().endsWith('favicon.ico'))
    errors.push(`http ${r.status()}: ${r.url()}`);
});

const orgName = `Phase 16 Demo ${stamp}`;
await page.goto(appUrl, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Create one/ }).click();
await page.getByLabel('Organization name').fill(orgName);
await page.getByLabel('Email').fill(`p16demo_${stamp}@demo.test`);
await page.getByLabel('Password').fill('password123');
await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.status() === 201),
  page.getByRole('button', { name: 'Create account' }).click(),
]);
await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 20000 });

// no data yet -> the button should be absent
const beforeData = await page.getByRole('button', { name: 'Download PDF' }).count();

await page.setInputFiles('input[type="file"]', resolve(repoRoot, 'data', 'fixture_rich_v2.csv'));
await page.getByRole('heading', { name: /Loaded fixture_rich_v2\.csv/ }).waitFor({ timeout: 30000 });
await page.getByText('12 monthly periods').waitFor({ timeout: 15000 });
await page.getByText('Generating insight…').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(300);

const pdfBtn = page.getByRole('button', { name: 'Download PDF' });
await pdfBtn.waitFor({ timeout: 10000 });
await pdfBtn.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${outDir}/p16_dashboard.png`, fullPage: true });

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  pdfBtn.click(),
]);
const savedPath = `${outDir}/p16_overview.pdf`;
await download.saveAs(savedPath);
const size = statSync(savedPath).size;
const suggested = download.suggestedFilename();
console.log(`  downloaded ${suggested} (${size} bytes)`);

const ok = errors.length === 0 && beforeData === 0 && /^ascenddv-overview-\d{4}-\d{2}-\d{2}\.pdf$/.test(suggested) && size > 3000;
console.log(`  button hidden before data: ${beforeData === 0}`);
console.log(`\n  console/page errors: ${errors.length}`);
errors.forEach((e) => console.log('   ' + e));
await b.close();
process.exit(ok ? 0 : 1);
