/** Phase 11 walkthrough: every view for a rich org + an empty dimension view
 *  for a sparse org. Clicks each tab, records console errors, screenshots a few.
 *  node scripts/screenshot-phase11.mjs <appUrl> <outDir> <repoRoot>
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const [appUrl, outDir, repoRoot] = process.argv.slice(2);
const DIMS = ['Financial', 'Growth', 'Community', 'People', 'Marketing', 'Fundraising', 'Impact', 'Strategic'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let errorCount = 0;

async function newOrg(fixture) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/api/insight') && !r.url().endsWith('/api/auth/me') && !r.url().endsWith('favicon.ico'))
      errors.push(`http ${r.status()}: ${r.url()}`);
  });
  const stamp = Date.now() + Math.floor(Math.random() * 1e4);
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Create one/ }).click();
  await page.getByLabel('Organization name').fill(`P11 ${stamp}`);
  await page.getByLabel('Email').fill(`p11_${stamp}@demo.test`);
  await page.getByLabel('Password').fill('password123');
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.status() === 201),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
  await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 20000 });
  await page.setInputFiles('input[type="file"]', resolve(repoRoot, 'data', fixture));
  await page.getByRole('heading', { name: /Loaded/ }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Overview' }).waitFor({ timeout: 30000 });
  await page.getByText('Generating insight…').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}

// warm the dev server
{ const w = await browser.newPage(); await w.goto(appUrl, { waitUntil: 'networkidle' }); await w.waitForTimeout(1200); await w.close(); }

/* ---- rich org: click through every view ---- */
const rich = await newOrg('fixture_rich_v2.csv');
for (const v of ['Overview', ...DIMS]) {
  await rich.page.getByRole('button', { name: v, exact: true }).click();
  await rich.page.waitForTimeout(250);
  const cardCount = await rich.page.locator('main .grid > div').count();
  const emptyState = await rich.page.getByText(/Nothing to show for/).isVisible().catch(() => false);
  console.log(`  rich/${v.padEnd(11)}  cards: ${String(cardCount).padStart(2)}   ${emptyState ? '(empty-state shown)' : ''}`);
  if (['Overview', 'Financial', 'People'].includes(v)) {
    await rich.page.screenshot({ path: `${outDir}/p11_rich_${v.toLowerCase()}.png`, fullPage: true });
  }
}
errorCount += rich.errors.length;
rich.errors.forEach((e) => console.log('   rich ' + e));
await rich.ctx.close();

/* ---- sparse org: an empty dimension view ---- */
const sparse = await newOrg('fixture_sparse.csv');
await sparse.page.getByRole('button', { name: 'Marketing', exact: true }).click();
await sparse.page.waitForTimeout(250);
const marketingEmpty = await sparse.page.getByText('Nothing to show for Marketing yet').isVisible();
const marketingHasScore = await sparse.page.getByText('/ 100').isVisible().catch(() => false);
console.log(`\n  sparse/Marketing  empty-state: ${marketingEmpty}   fabricated-score: ${marketingHasScore}`);
await sparse.page.screenshot({ path: `${outDir}/p11_sparse_marketing.png`, fullPage: true });
errorCount += sparse.errors.length;
sparse.errors.forEach((e) => console.log('   sparse ' + e));
await sparse.ctx.close();

await browser.close();
console.log(`\n${errorCount === 0 ? 'No console/page errors across all views.' : `${errorCount} error line(s).`}`);
process.exit(errorCount === 0 && marketingEmpty && !marketingHasScore ? 0 : 1);
