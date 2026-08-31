/** Phase 17 UI walkthrough: onboarding wizard -> auto tour -> no-repeat -> replay.
 *  node scripts/screenshot-phase17.mjs <appUrl> <outDir> <repoRoot>
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { statSync } from 'node:fs';

const [appUrl, outDir, repoRoot] = process.argv.slice(2);
const stamp = Date.now();
const b = await chromium.launch({ channel: 'chrome', headless: true });
{ const w = await b.newPage(); await w.goto(appUrl, { waitUntil: 'networkidle' }); await w.waitForTimeout(1000); await w.close(); }

const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('/api/insight') && !r.url().endsWith('/api/auth/me') && !r.url().endsWith('favicon.ico'))
    errors.push(`http ${r.status()}: ${r.url()}`);
});
let onboardingCompleteCalls = 0;
page.on('response', (r) => {
  if (r.url().includes('/onboarding-complete') && r.ok()) onboardingCompleteCalls += 1;
});

const orgName = `Phase 17 Demo ${stamp}`;
await page.goto(appUrl, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Create one/ }).click();
await page.getByLabel('Organization name').fill(orgName);
await page.getByLabel('Email').fill(`p17demo_${stamp}@demo.test`);
await page.getByLabel('Password').fill('password123');
await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/auth/signup') && r.status() === 201),
  page.getByRole('button', { name: 'Create account' }).click(),
]);

// 1) the wizard appears for a fresh signup
await page.getByRole('heading', { name: 'Welcome to AscendDV' }).waitFor({ timeout: 20000 });
const uploaderBeforeWizardDone = await page.getByRole('button', { name: 'Upload CSV' }).count();
await page.screenshot({ path: `${outDir}/p17_wizard.png`, fullPage: true });
console.log('  wizard shown on first run');

// 2) the CSV template download path works
await page.getByRole('button', { name: 'Get started' }).click();
await page.getByRole('heading', { name: 'Add your first data' }).waitFor();
const [tpl] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.getByRole('button', { name: 'Download the CSV template' }).click(),
]);
const tplPath = `${outDir}/ascenddv-template.csv`;
await tpl.saveAs(tplPath);
console.log(`  template downloaded: ${tpl.suggestedFilename()} (${statSync(tplPath).size} bytes)`);

// 3) upload path -> ingestion -> tour auto-starts on the real dashboard
await page.setInputFiles('input[type="file"]', resolve(repoRoot, 'data', 'fixture_rich_v2.csv'));
const tour = page.getByRole('dialog', { name: 'Dashboard tour' });
await tour.waitFor({ timeout: 30000 });
await tour.getByText('Health scores').waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/p17_tour.png`, fullPage: true });
console.log('  tour auto-started after first ingestion');

// step through to the end
for (let i = 0; i < 8; i += 1) {
  const done = page.getByRole('button', { name: 'Done' });
  if (await done.count()) { await done.click(); break; }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(150);
}
await tour.waitFor({ state: 'detached', timeout: 8000 });
console.log('  tour completed and closed');

// 4) a reload in the same session does NOT re-show the wizard or auto-tour
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Upload CSV' }).waitFor({ timeout: 15000 });
const wizardAfterReload = await page.getByRole('heading', { name: 'Welcome to AscendDV' }).count();
const tourAfterReload = await page.getByRole('dialog', { name: 'Dashboard tour' }).count();
console.log(`  after reload — wizard: ${wizardAfterReload}, auto-tour: ${tourAfterReload}`);

// 5) the on-demand replay control re-opens the tour
await page.getByRole('button', { name: 'Take a tour' }).click();
await page.getByRole('dialog', { name: 'Dashboard tour' }).waitFor({ timeout: 8000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/p17_replay.png`, fullPage: true });
console.log('  replay control re-opened the tour');

const ok =
  errors.length === 0 &&
  uploaderBeforeWizardDone === 0 &&
  onboardingCompleteCalls >= 1 &&
  wizardAfterReload === 0 &&
  tourAfterReload === 0;
console.log(`\n  onboarding-complete calls: ${onboardingCompleteCalls}`);
console.log(`  console/page errors: ${errors.length}`);
errors.forEach((e) => console.log('   ' + e));
await b.close();
process.exit(ok ? 0 : 1);
