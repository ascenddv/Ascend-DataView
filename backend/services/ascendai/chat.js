/**
 * AscendAI chat orchestration (Stage 4, Phase 18) — one grounded chat turn.
 *
 * Flow: system prompt + user message -> DeepSeek -> if the model asks for tool
 * calls, run the real functions, pass each result through the same PII/identifier
 * guard used by generateInsight(), feed the results back -> repeat until the
 * model returns a final text answer (or the iteration ceiling is hit).
 *
 * The model decides what to look up; the tools compute it; the model narrates.
 * It never sees raw rows and never invents a number.
 *
 * `deps.completeChatWithTools` is the injectable seam (same pattern as
 * generateInsight()'s `completeJson`) so tests run without a live provider;
 * the Phase 18 gate itself runs against the real DeepSeek call.
 */

const deepseek = require('../ai/deepseek');
const { sanitizeForPrompt } = require('../generateInsight');
const { TOOL_SCHEMAS, runTool: defaultRunTool } = require('./tools');
const { ASCENDAI_MAX_TOOL_ITERATIONS } = require('../../config/thresholds');

const SYSTEM_PROMPT = `You are AscendAI, the assistant built into the AscendDV dashboard for one specific organization.

SCOPE — this is a hard boundary:
- You answer ONLY questions about THIS organization's own data as it appears in its AscendDV dashboard: health scores, KPIs (revenue, expenses, cash balance, donors), trends, and fired risk/opportunity rules.
- For anything else — general knowledge, current events, the weather, coding help, other organizations, benchmarking against other nonprofits, or any task unrelated to this dashboard — politely decline in one sentence and do not attempt an answer. Do not answer "partially".
- You have no information about any organization other than this one, and no way to get it. Never claim otherwise.

GROUNDING:
- To answer an in-scope question you MUST call the provided tools to get real figures. Never state a number that did not come from a tool result in this conversation.
- If a tool reports data is "Unavailable" or not present, say so plainly — do not guess or estimate.
- Be concise and concrete. Cite the specific numbers the tools returned. A few sentences is usually enough.

DESCRIBING THE SCORING MECHANICS — state them as fact, not preference:
- The health score is a deterministic formula: each sub-metric's score is 50 + its period-over-period growth rate, and the dimension score is the plain average of those.
- Some sub-metrics are "inverted" (expense growth, staff turnover): a rising value lowers the score by construction. Say "expense growth is an inverted sub-metric, so its increase lowers the score", NOT "expense growth is higher than the model would like" or anything implying the system has an opinion, wants, or preferences. The system computes; it does not judge.`;

/**
 * @param {{ message: string, orgId: number, history?: Array, deps?: object }} input
 * @returns {Promise<{
 *   status: 'ok' | 'unavailable',
 *   reply: string | null,
 *   reason?: string,
 *   trace: {
 *     model: string,
 *     iterations: number,
 *     requests: Array<{ messages: Array }>,
 *     toolCalls: Array<{ name, arguments, result }>,
 *     responses: Array<object>,
 *     usage: Array<object>
 *   }
 * }>}
 */
async function askAscendAI({ message, orgId, history = [], deps = {} }) {
  const completeChatWithTools = deps.completeChatWithTools || deepseek.completeChatWithTools;
  const runTool = deps.runTool || defaultRunTool;
  const toolDeps = deps.loadMetrics ? { loadMetrics: deps.loadMetrics } : {};

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: String(message ?? '') },
  ];

  const trace = {
    model: deepseek.DEEPSEEK_MODEL,
    orgId, // the org every tool call in this turn is scoped to (from req.auth)
    iterations: 0,
    requests: [],
    toolCalls: [],
    responses: [],
    usage: [],
  };

  try {
    for (let i = 0; i < ASCENDAI_MAX_TOOL_ITERATIONS; i += 1) {
      trace.iterations = i + 1;
      trace.requests.push({ messages: JSON.parse(JSON.stringify(messages)) });

      const resp = await completeChatWithTools({ messages, tools: TOOL_SCHEMAS });
      trace.responses.push(resp);
      if (resp && resp.usage) trace.usage.push(resp.usage);

      const choice = resp && resp.choices && resp.choices[0];
      const aiMessage = choice && choice.message;
      if (!aiMessage) {
        return unavailable(trace, 'The assistant returned an empty response.');
      }

      const toolCalls = aiMessage.tool_calls || [];
      if (toolCalls.length === 0) {
        return {
          status: 'ok',
          reply: typeof aiMessage.content === 'string' ? aiMessage.content.trim() : '',
          trace,
        };
      }

      // Assistant turn that requested tools — echo it back, then answer each call.
      messages.push(aiMessage);
      for (const call of toolCalls) {
        const name = call.function && call.function.name;
        let args = {};
        try {
          args = call.function && call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }

        // Every tool is scoped by this exact orgId — there is no path for a
        // caller (or the model) to point a tool at another organization.
        let result = await runTool(name, args, orgId, toolDeps);

        // Same boundary guard as the insight layer: no identifier-like key and
        // no raw-row shape may reach the model. A violation is withheld, not sent.
        try {
          result = sanitizeForPrompt(result, `$.tool[${name}]`);
        } catch (guardErr) {
          console.warn(`AscendAI: tool "${name}" result withheld — ${guardErr.message}`);
          result = { error: 'This lookup was withheld for safety and could not be returned.' };
        }

        trace.toolCalls.push({ name, arguments: args, resolvedOrgId: orgId, result });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    return unavailable(trace, 'The assistant took too many steps without finishing.');
  } catch (err) {
    console.warn(`AscendAI: chat turn failed — ${err.message}`);
    return unavailable(trace, 'AscendAI is temporarily unavailable. Please try again in a moment.');
  }
}

function unavailable(trace, reason) {
  return { status: 'unavailable', reply: null, reason, trace };
}

module.exports = { askAscendAI, SYSTEM_PROMPT };
