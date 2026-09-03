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

const { flagIsOn } = require('./envFlags');

const insightEnabled = () => flagIsOn(process.env.INSIGHT_ENABLED);
const ascendaiEnabled = () => flagIsOn(process.env.ASCENDAI_ENABLED);

module.exports = { insightEnabled, ascendaiEnabled };
