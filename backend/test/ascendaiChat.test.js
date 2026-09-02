/**
 * AscendAI chat loop (Phase 18) — the model<->tool round-trip, verified with a
 * mocked completion seam (no live provider). Covers: a multi-tool-call turn,
 * the sanitize guard withholding a poisoned tool result, graceful degradation
 * on a provider failure, and the iteration ceiling.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMetrics } = require('../services/buildMetrics');
const { askAscendAI } = require('../services/ascendai/chat');

const ORG = 4242;

const ROWS = [];
for (let i = 0; i < 6; i += 1) {
  ROWS.push({
    period_date: `2025-0${i + 1}-28`,
    revenue: 10000 + i * 500,
    expenses: 9000 + i * 100,
    cash_balance: 30000 + i * 900,
    donors_total: 100 + i * 3,
  });
}
const loadMetrics = async () => buildMetrics(ROWS);

/** A scripted completion seam: yields each queued response in turn. */
function scriptedModel(responses) {
  let i = 0;
  const seen = [];
  const fn = async ({ messages }) => {
    seen.push(JSON.parse(JSON.stringify(messages)));
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r;
  };
  fn.seen = seen;
  return fn;
}
const toolCallMsg = (calls) => ({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: calls.map((c, idx) => ({
          id: `call_${idx}`,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        })),
      },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});
const finalMsg = (content) => ({
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
});

test('a turn needing two lookups: both tools run, scoped to the caller org, then the model answers', async () => {
  const model = scriptedModel([
    toolCallMsg([
      { name: 'getKpi', args: { field: 'revenue' } },
      { name: 'getHealthScore', args: { dimension: 'Financial' } },
    ]),
    finalMsg('Revenue is 12500 and Financial health is Stable.'),
  ]);

  const res = await askAscendAI({
    message: 'How is revenue and how is Financial health?',
    orgId: ORG,
    deps: { completeChatWithTools: model, loadMetrics },
  });

  assert.equal(res.status, 'ok');
  assert.equal(res.reply, 'Revenue is 12500 and Financial health is Stable.');
  assert.equal(res.trace.iterations, 2);
  assert.equal(res.trace.orgId, ORG);

  assert.deepEqual(res.trace.toolCalls.map((t) => t.name).sort(), ['getHealthScore', 'getKpi']);
  assert.ok(res.trace.toolCalls.every((t) => t.resolvedOrgId === ORG));
  assert.equal(res.trace.toolCalls.find((t) => t.name === 'getKpi').result.latest, 12500);

  // second request to the model carried both tool results back
  const secondReqRoles = model.seen[1].map((m) => m.role);
  assert.deepEqual(secondReqRoles, ['system', 'user', 'assistant', 'tool', 'tool']);
});

test('a poisoned tool result is withheld — the model never sees the identifier', async () => {
  const model = scriptedModel([
    toolCallMsg([{ name: 'getKpi', args: { field: 'revenue' } }]),
    finalMsg('done'),
  ]);
  const res = await askAscendAI({
    message: 'revenue?',
    orgId: ORG,
    deps: {
      completeChatWithTools: model,
      loadMetrics,
      runTool: async () => ({ email: 'leak@example.org', org_id: 7, value: 42 }),
    },
  });

  assert.equal(res.status, 'ok');
  assert.deepEqual(res.trace.toolCalls[0].result, {
    error: 'This lookup was withheld for safety and could not be returned.',
  });
  const toolMsg = model.seen[1].find((m) => m.role === 'tool');
  assert.doesNotMatch(toolMsg.content, /leak@example\.org/);
  assert.match(toolMsg.content, /withheld/);
});

test('a provider failure degrades to a clean "unavailable", never throws', async () => {
  const res = await askAscendAI({
    message: 'anything',
    orgId: ORG,
    deps: {
      completeChatWithTools: async () => {
        throw new Error('DeepSeek HTTP 402: Insufficient Balance');
      },
      loadMetrics,
    },
  });
  assert.equal(res.status, 'unavailable');
  assert.equal(res.reply, null);
  assert.match(res.reason, /temporarily unavailable/i);
});

test('the tool loop stops at the iteration ceiling instead of looping forever', async () => {
  const model = scriptedModel([toolCallMsg([{ name: 'getKpi', args: { field: 'revenue' } }])]); // always asks for a tool
  const res = await askAscendAI({
    message: 'loop',
    orgId: ORG,
    deps: { completeChatWithTools: model, loadMetrics },
  });
  assert.equal(res.status, 'unavailable');
  assert.match(res.reason, /too many steps/i);
  const { ASCENDAI_MAX_TOOL_ITERATIONS } = require('../config/thresholds');
  assert.equal(res.trace.iterations, ASCENDAI_MAX_TOOL_ITERATIONS);
});

test('an out-of-scope answer (model declines, no tool calls) passes straight through', async () => {
  const model = scriptedModel([finalMsg("I can only answer questions about this organization's dashboard data.")]);
  const res = await askAscendAI({
    message: "what's the weather?",
    orgId: ORG,
    deps: { completeChatWithTools: model, loadMetrics },
  });
  assert.equal(res.status, 'ok');
  assert.equal(res.trace.toolCalls.length, 0);
  assert.equal(res.trace.iterations, 1);
  assert.match(res.reply, /only answer questions about this organization/i);
});
