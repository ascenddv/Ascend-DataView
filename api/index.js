/**
 * Vercel serverless entry for the AscendDV backend.
 *
 * `vercel.json` rewrites every `/api/*` request to this function. The Express
 * app mounts its routes under `/api`, so we make sure the path it sees carries
 * that prefix regardless of how the rewrite delivers it. Schema bootstrap runs
 * lazily on the first request per cold start (see backend/app.js).
 */
const app = require('../backend/app.js');

module.exports = (req, res) => {
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url === '/' ? '' : req.url);
  }
  return app(req, res);
};
