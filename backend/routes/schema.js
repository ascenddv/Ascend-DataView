/**
 * GET /api/schema — the canonical field dictionary, so the frontend
 * (manual-entry form) never hardcodes a second copy of the field list.
 */

const express = require('express');
const { FIELDS } = require('../config/schema');

const router = express.Router();

router.get('/schema', (_req, res) => {
  res.json({
    fields: FIELDS.map((f) => ({
      name: f.name,
      required: f.required,
      category: f.category,
      type: f.type,
    })),
  });
});

module.exports = router;
