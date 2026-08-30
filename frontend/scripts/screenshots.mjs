/**
 * Real browser screenshots of the full walkthrough for all 3 fixtures.
 * Uses the system Chrome (Playwright `channel: 'chrome'`), drives the actual
 * upload UI, waits for the dashboard + insight fetch to settle, and records any
 * console / page errors.
 *
 *   node scripts/screenshots.mjs <appUrl> <outDir> <repoRoot>
 */

import { chromium } from 'playwright';
import { resolve } from 'node:path';

const [appUrl, outDir, repoRoot] = process.argv.slice(2);
if (!appUrl || !outDir || !repoRoot) {
  console.error('usage: node scripts/screenshots.mjs <appUrl> <outDir> <repoRoot>');
  process.exit(1);
}

const FIXTURES = ['rich', 'sparse', 'messy'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failures = 0;

// Warm up the dev server (first hit triggers Vite dep pre-bundling).
{
  const warm = await browser.newPage();
  await warm.goto(appUrl, { waitUntil: 'networkidle' });
  await warm.waitForTimeout(1500);
  await warm.close();
}

for (const name of FIXTURES) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes('/api/insight') && !u.endsWith('favicon.ico')) {
      errors.push(`http ${r.status()}: ${u}`);
    }
  });
  page.on('requestfailed', (r) => {
    // ERR_ABORTED = React cleanup aborting an in-flight fetch on unmount; benign.
    if ((r.failure()?.errorText || '').includes('ERR_ABORTED')) return;
    errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });

  await page.goto(appUrl, { waitUntil: 'networkidle' });
  // Let the initial dashboard settle before uploading, so nothing is in flight.
  await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 30000 });
  await page.waitForLoadState('networkidle');

  // Drive the real upload control.
  await page.setInputFiles('input[type="file"]', resolve(repoRoot, `data/fixture_${name}.csv`));

  // Wait for the ingestion summary heading and the refreshed dashboard.
  await page.getByRole('heading', { name: /Loaded fixture_/ }).waitFor({ timeout: 30000 });
  await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 30000 });

  // Let the insight fetch fully settle so the final frame is stable — either the
  // narrative card appears, or (under quota) the "Generating insight…" line
  // disappears as it degrades to no card.
  await page
    .getByText('Generating insight…')
    .waitFor({ state: 'detached', timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  const file = `${outDir}/dashboard_${name}.png`;
  await page.screenshot({ path: file, fullPage: true });

  const insightCardVisible = await page.getByText('What to do').isVisible().catch(() => false);
  console.log(
    `${name.padEnd(6)} -> ${file}  | console errors: ${errors.length}  | insight card: ${
      insightCardVisible ? 'shown' : 'absent (degraded)'
    }`
  );
  for (const e of errors) console.log(`   ${e}`);
  failures += errors.length;

  await context.close();
}

await browser.close();
console.log(failures === 0 ? '\nNo console/page errors across all 3 walkthroughs.' : `\n${failures} error line(s) — see above.`);
process.exit(failures === 0 ? 0 : 1);
