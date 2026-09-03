/**
 * One convention for "defaults-on" boolean env flags, so INSIGHT_ENABLED /
 * ASCENDAI_ENABLED (config/aiFlags.js) and HIBP_CHECK_ENABLED
 * (services/passwordCheck.js) parse their values identically.
 *
 * A flag is OFF only when its value — trimmed, case-insensitive — is one of
 * `0`, `false`, `off`, `no`. Anything else, including unset and empty string,
 * leaves it ON.
 */

const OFF_WORDS = /^(0|false|off|no)$/i;

const flagIsOff = (value) => OFF_WORDS.test(String(value ?? '').trim());
const flagIsOn = (value) => !flagIsOff(value);

module.exports = { flagIsOff, flagIsOn };
