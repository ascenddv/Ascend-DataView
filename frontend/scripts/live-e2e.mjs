/**
 * Live end-to-end verification against the deployed site (DEPLOY_CHECKLIST §4).
 * Signs up a fresh org with a yopmail address, verifies via the real email,
 * uploads data, runs one AscendAI turn, and downloads the PDF + JSON exports —
 * asserting zero console/page errors throughout.
 *
 *   cd frontend && node <this file>
 *
 * If the yopmail auto-fetch can't get the verification link, the run pauses and
 * polls scratchpad/verify-link.txt — drop the link there and it continues.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';

const APP = 'https://ascenddv.app';
const REPO = 'C:/Ascend-DataView';
const OUT = 'C:/Users/kaiya/AppData/Local/Temp/claude/c--Ascend-DataView/c8d092e2-5214-4c0a-8bf0-9afb991cf43e/scratchpad/e2e';
const LINKFILE = 'C:/Users/kaiya/AppData/Local/Temp/claude/c--Ascend-DataView/c8d092e2-5214-4c0a-8bf0-9afb991cf43e/scratchpad/verify-link.txt';
mkdirSync(OUT, { recursive: true });

const stamp = Date.now();
const INBOX = `ascenddv-e2e-${stamp}`;
const EMAIL = `${INBOX}@yopmail.com`;
const PW = `Ascend-E2E-${stamp}-Qx9`;
const ORG = `E2E ${stamp}`;
const TOKEN_RE = /https:\/\/ascenddv\.app\/verify-email\?token=[A-Za-z0-9]+/;

const errors = [];
const results = [];
const rec = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`email:    ${EMAIL}`);
console.log(`password: ${PW}`);
console.log(`yopmail:  https://yopmail.com/en/?login=${INBOX}\n`);

async function fetchVerifyLink(ctx) {
  const yp = await ctx.newPage();
  try {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      if (existsSync(LINKFILE)) {
        const m = readFileSync(LINKFILE, 'utf8').match(TOKEN_RE);
        if (m) return m[0];
      }
      try {
        await yp.goto(`https://yopmail.com/en/?login=${INBOX}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        for (const sel of ['.fc-cta-consent', 'button[aria-label*="Consent" i]', '.fc-button-label', 'button:has-text("Accept")']) {
          await yp.locator(sel).first().click({ timeout: 1500 }).catch(() => {});
        }
        await sleep(1500);
        const inboxFrame = yp.frameLocator('#ifinbox');
        const msg = inboxFrame.locator('button.lm, .lm, div.m').first();
        if (await msg.count().catch(() => 0)) {
          await msg.click({ timeout: 3000 }).catch(() => {});
          await sleep(1500);
          const mail = yp.frameLocator('#ifmail').locator('body');
          const blob = `${await mail.innerHTML().catch(() => '')}\n${await mail.innerText().catch(() => '')}`;
          const m = blob.match(TOKEN_RE);
          if (m) return m[0];
        }
      } catch (e) {
        if (attempt === 0) console.log(`  (yopmail probe: ${e.message.split('\n')[0]})`);
      }
      if (attempt === 6) console.log(`  still waiting for the email… drop the link in ${LINKFILE} to skip yopmail`);
      await sleep(5000);
    }
    return null;
  } finally {
    await yp.screenshot({ path: `${OUT}/yopmail.png` }).catch(() => {});
    await yp.close();
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.includes('ascenddv.app') && !u.includes('favicon')) errors.push(`requestfailed: ${r.method()} ${u} — ${r.failure()?.errorText}`);
});

try {
  /* 1. signup ---------------------------------------------------------- */
  await page.goto(APP, { waitUntil: 'networkidle', timeout: 45000 });
  const toSignup = page.getByRole('button', { name: /create one/i });
  if (await toSignup.isVisible().catch(() => false)) await toSignup.click();
  await page.getByLabel('Organization name').fill(ORG);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /create account/i }).click();
  await page.getByText(/verify your email/i).waitFor({ timeout: 25000 });
  rec('signup lands on the dashboard with the verify-email banner', true, EMAIL);
  await page.screenshot({ path: `${OUT}/01-signup.png`, fullPage: true });

  /* 2. verification email ------------------------------------------------ */
  const link = await fetchVerifyLink(ctx);
  rec('verification email arrived and carried a verify link', Boolean(link), link ? `${link.slice(0, 55)}…` : 'not retrieved');
  if (!link) throw new Error('no verification link — see yopmail.png / drop it in verify-link.txt and re-run');

  /* 3. verify --------------------------------------------------------- */
  await page.goto(link, { waitUntil: 'networkidle', timeout: 30000 });
  await page.getByText(/your email is verified/i).waitFor({ timeout: 20000 });
  rec('the verify link confirms the address', true);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await sleep(1500);
  rec('verify-email banner is gone after verification',
    !(await page.getByText(/verify your email/i).isVisible().catch(() => false)));

  /* 4. upload ------------------------------------------------------------ */
  // onboarding wizard: step 1 is a "Welcome / Get started" screen; the file
  // input only exists on step 2.
  await page.getByRole('button', { name: /get started/i }).click({ timeout: 8000 }).catch(() => {});
  await sleep(600);
  await page.locator('input[type="file"]').first().setInputFiles(`${REPO}/data/fixture_rich_v2.csv`);
  // clean fixture usually maps without confirmation; click through if it appears
  const confirmBtn = page.getByRole('button', { name: /confirm|looks right|use these|apply|save mapping/i });
  if (await confirmBtn.isVisible({ timeout: 6000 }).catch(() => false)) await confirmBtn.click().catch(() => {});
  await page.locator('[data-testid="onboarding-wizard"]').waitFor({ state: 'detached', timeout: 45000 }).catch(() => {});
  await sleep(3000);
  const body1 = (await page.locator('body').innerText()).toLowerCase();
  rec('CSV upload renders the dashboard (health score + revenue/cash visible)',
    body1.includes('health') && (body1.includes('revenue') || body1.includes('cash')));
  await page.screenshot({ path: `${OUT}/02-dashboard.png`, fullPage: true });

  // the first-run guided tour auto-opens as a modal over the dashboard and
  // blocks every other click until dismissed.
  await page.getByText(/skip tour/i).first().click({ timeout: 10000 }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(1000);
  rec('first-run tour dismissed', !(await page.getByText(/skip tour/i).isVisible().catch(() => false)));

  /* 5. AscendAI — one real turn -------------------------------------- */
  const launcher = page.getByRole('button', { name: 'Ask AscendAI' });
  if (await launcher.isVisible().catch(() => false)) {
    await launcher.click();
    await page.getByPlaceholder('Ask about your data…').fill('What is my most recent cash balance?');
    await page.getByRole('button', { name: 'Send' }).click();
    let reply = '';
    for (let i = 0; i < 40; i += 1) {
      await sleep(1500);
      const t = await page.locator('[aria-label="AscendAI chat"]').innerText().catch(() => '');
      if (t.length > 160 && /\d[\d,]{2,}/.test(t)) { reply = t; break; }
    }
    rec('AscendAI answered with a figure', /\d[\d,]{2,}/.test(reply),
      reply.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 140));
    await page.screenshot({ path: `${OUT}/03-ascendai.png` });
    await page.getByRole('button', { name: 'Close AscendAI' }).click().catch(() => {});
  } else {
    rec('AscendAI launcher present', false, 'not visible — AI disabled or usage endpoint failed');
  }

  /* 6. PDF export ---------------------------------------------------- */
  try {
    const [pdf] = await Promise.all([
      page.waitForEvent('download', { timeout: 40000 }),
      page.getByRole('button', { name: /download pdf/i }).click(),
    ]);
    const p = `${OUT}/report.pdf`;
    await pdf.saveAs(p);
    const head = readFileSync(p).subarray(0, 5).toString('latin1');
    rec('PDF export downloads a real %PDF file', head.startsWith('%PDF'), `${head} (${readFileSync(p).length} bytes)`);
  } catch (e) {
    rec('PDF export downloads a real %PDF file', false, e.message.split('\n')[0]);
  }

  /* 7. data export ------------------------------------------------------ */
  try {
    await page.getByRole('button', { name: /danger zone/i }).click();
    const [exp] = await Promise.all([
      page.waitForEvent('download', { timeout: 40000 }),
      page.getByRole('button', { name: /download export/i }).click(),
    ]);
    const p = `${OUT}/export.json`;
    await exp.saveAs(p);
    const raw = readFileSync(p, 'utf8');
    const bundle = JSON.parse(raw);
    const noHashes = !/password_hash|\$2[aby]\$[0-9]{2}\$/.test(raw);
    const rows = bundle.standardizedData?.length || 0;
    rec("data export is JSON with this org's data and no password hashes",
      noHashes && rows > 0, `rows=${rows} org=${bundle.organization?.name} members=${bundle.members?.length}`);
  } catch (e) {
    rec('data export downloads a JSON bundle', false, e.message.split('\n')[0]);
  }

  /* 8. errors -------------------------------------------------------- */
  rec('zero console / page / network errors across the whole run', errors.length === 0,
    errors.slice(0, 6).join('  |  '));
} catch (err) {
  rec('run completed without an unhandled exception', false, err.message.split('\n')[0]);
} finally {
  await page.screenshot({ path: `${OUT}/99-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  console.log('\n──────── SUMMARY ────────');
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  console.log(errors.length ? `\n${errors.length} ERROR(S):\n${errors.join('\n')}` : '\nno console/page/network errors');
  console.log(`\nscreenshots: ${OUT}`);
}
