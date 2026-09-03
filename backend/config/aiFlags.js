/**
 * Global kill-switches for the two AI features (Phase 28).
 *
 * Both default ON. Set INSIGHT_ENABLED / ASCENDAI_ENABLED to a falsey word
 * (0, false, off, no) to disable the feature deployment-wide — the endpoints
 * then return the same clean "unavailable" shape a provider outage produces, so
 * the dashboard degrades instead of erroring. The per-organization AscendAI
 * toggle (organizations.ascendai_enabled) is enforced separately, in the chat
 * route.
 */

const isOff = (v) => /^(0|false|off|no)$/i.test(String(v ?? '').trim());

const insightEnabled = () => !isOff(process.env.INSIGHT_ENABLED);
const ascendaiEnabled = () => !isOff(process.env.ASCENDAI_ENABLED);

module.exports = { insightEnabled, ascendaiEnabled };
