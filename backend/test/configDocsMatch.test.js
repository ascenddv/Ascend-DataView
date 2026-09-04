/**
 * Guard against drift between the production config guard and the docs.
 *
 * config/productionGuard.js's CHECKED_VARS and the README "Environment
 * variables" table must agree: every var the guard inspects has to be
 * documented, or a deploy could satisfy the guard yet still be misconfigured in
 * a way nobody wrote down (the Phase 30 audit found exactly this — APP_BASE_URL
 * and CRON_SECRET were documented but unchecked). A manual checklist note is
 * not enough; this fails the build.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const { CHECKED_VARS } = require('../config/productionGuard');

const README = readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8');

/** Var names (in `backticks`) from the rows of the "## Environment variables" table. */
function documentedEnvVars(md) {
  const start = md.indexOf('## Environment variables');
  assert.notEqual(start, -1, 'README has no "## Environment variables" section');
  const section = md.slice(start, md.indexOf('\n## ', start + 1));
  const names = new Set();
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const firstCell = line.split('|')[1] || '';
    for (const m of firstCell.matchAll(/`([A-Z][A-Z0-9_]+)`/g)) names.add(m[1]);
  }
  return names;
}

test('every var productionGuard checks is documented in the README env-var table', () => {
  const documented = documentedEnvVars(README);
  const undocumented = CHECKED_VARS.filter((v) => !documented.has(v));
  assert.deepEqual(undocumented, [], `undocumented but guarded: ${undocumented.join(', ')}`);
});

test('the README env-var table marks every guarded var as required in production', () => {
  const start = README.indexOf('## Environment variables');
  const section = README.slice(start, README.indexOf('\n## ', start + 1));
  for (const v of CHECKED_VARS) {
    const row = section.split('\n').find((l) => l.includes(`\`${v}\``));
    assert.ok(row, `no README row for ${v}`);
    const requiredCell = (row.split('|')[2] || '').trim().toLowerCase();
    assert.ok(
      /^(yes|prod|phase \d+)$/.test(requiredCell),
      `${v} is guarded but its README "Required" cell is "${requiredCell}" (expected yes/prod/phase N)`
    );
  }
});
