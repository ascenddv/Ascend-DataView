/** Phase 13 UI walkthrough: upload merge summary + the danger-zone reset.
 *  node scripts/screenshot-phase13.mjs <appUrl> <outDir> <repoRoot>
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const [appUrl, outDir, repoRoot] = process.argv.slice(2);
const stamp = Date.now();
const b = await chromium.launch({ channel: 'chrome', headless: true });
{ const w = await b.newPage(); await w.goto(appUrl, { waitUntil: 'networkidle' }); await w.waitForTimeout(1200); await w.close(); }

const ctx = await b.newContext({ viewport: { width: 1280, height: 1200 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('/api/insight') && !r.url().endsWith('/api/auth/me') && !r.url().endsWith('favicon.ico'))
    errors.push(`http ${r.status()}: ${r.url()}`);
});

const orgName = `Phase 13 Demo ${stamp}`;
await page.goto(appUrl, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Create one/ }).click();
await page.getByLabel('Organization name').fill(orgName);
await page.getByLabel('Email').fill(`p13demo_${stamp}@demo.test`);
await page.getByLabel('Password').fill('password123');
await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.status() === 201),
  page.getByRole('button', { name: 'Create account' }).click(),
]);
await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 20000 });

// 1) initial upload
await page.setInputFiles('input[type="file"]', resolve(repoRoot, 'data', 'fixture_rich_v2.csv'));
await page.getByRole('heading', { name: /Loaded fixture_rich_v2\.csv — 12 periods added/ }).waitFor({ timeout: 30000 });

// 2) merge upload
await page.setInputFiles('input[type="file"]', resolve(repoRoot, 'data', 'fixture_rich_v2_delta.csv'));
await page.getByRole('heading', { name: /2 periods added, 3 updated/ }).waitFor({ timeout: 30000 });
await page.getByText('14 monthly periods').waitFor({ timeout: 15000 });
await page.getByText('Generating insight…').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/p13_merge.png`, fullPage: true });
console.log('  merge summary captured (14 periods)');

// 3) danger zone
await page.getByRole('button', { name: /Danger zone/ }).click();
await page.getByText(`Reset all data for ${orgName}`).waitFor({ timeout: 10000 });
const resetBtn = page.getByRole('button', { name: 'Reset data' });
const disabledBefore = await resetBtn.isDisabled();
await page.locator('label:has-text("to confirm") input').fill(orgName);
const disabledAfter = await resetBtn.isDisabled();
console.log(`  reset button — disabled before typing name: ${disabledBefore}, after: ${disabledAfter}`);
await page.screenshot({ path: `${outDir}/p13_dangerzone.png`, fullPage: true });

await resetBtn.click();
await page.getByText(/Deleted 14 periods/).waitFor({ timeout: 15000 });
await page.getByText('No data yet').waitFor({ timeout: 15000 });
console.log('  reset confirmed — dashboard shows "No data yet"');

console.log(`\n  console/page errors: ${errors.length}`);
errors.forEach((e) => console.log('   ' + e));
await b.close();
process.exit(errors.length === 0 && disabledBefore === true && disabledAfter === false ? 0 : 1);
