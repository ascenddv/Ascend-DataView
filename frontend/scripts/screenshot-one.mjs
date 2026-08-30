/** Screenshot one org's dashboard after signing up + uploading a fixture.
 *  node scripts/screenshot-one.mjs <appUrl> <outFile> <repoRoot> <fixtureFile>
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const [appUrl, outFile, repoRoot, fixture] = process.argv.slice(2);
const stamp = Date.now();

const browser = await chromium.launch({ channel: 'chrome', headless: true });
{
  const warm = await browser.newPage();
  await warm.goto(appUrl, { waitUntil: 'networkidle' });
  await warm.waitForTimeout(1200);
  await warm.close();
}
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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
await page.getByLabel('Organization name').fill(`Phase 9 Demo ${stamp}`);
await page.getByLabel('Email').fill(`p9demo_${stamp}@demo.test`);
await page.getByLabel('Password').fill('password123');
await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.status() === 201),
  page.getByRole('button', { name: 'Create account' }).click(),
]);
await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 20000 });
await page.setInputFiles('input[type="file"]', resolve(repoRoot, 'data', fixture));
await page.getByRole('heading', { name: /Loaded/ }).waitFor({ timeout: 30000 });
await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 30000 });
await page.getByText('Generating insight…').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: outFile, fullPage: true });

const healthCards = await page.getByText(/ HEALTH$/i).count().catch(() => 0);
console.log(`${outFile}  | health cards: ${healthCards}  | console errors: ${errors.length}`);
errors.forEach((e) => console.log('  ' + e));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
