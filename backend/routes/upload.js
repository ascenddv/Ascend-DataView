/**
 * POST /api/upload         — CSV or .xlsx upload (multipart). MERGES into the
 *                            org's history (upsert by period_date); never wipes.
 *                            If any column mapping is low-confidence the upload
 *                            pauses (Phase 14b) and nothing is stored until
 *                            POST /api/upload/confirm.
 * POST /api/upload/confirm — finish a paused upload with confirmed/corrected
 *                            mappings.
 * POST /api/manual-entry   — a single period entered by hand, verified users only (also merges).
 * GET  /api/data           — the current standardized dataset (for inspection).
 *
 * All route through the one ingestion pipeline in services/ingest.js and are
 * scoped by req.auth.orgId.
 */

const express = require('express');
const multer = require('multer');

const { FIELDS } = require('../config/schema');
const {
  parseCsv,
  parseXlsx,
  ingestParsed,
  ingestManualEntry,
} = require('../services/ingest');
const {
  mergeStandardizedData,
  upsertStandardizedRow,
  getStandardizedData,
} = require('../db');
const pendingUploads = require('../services/pendingUploads');
const { uploadLimiter } = require('../middleware/rateLimit');
const { requireVerified } = require('../middleware/requireVerified');

const router = express.Router();

const XLSX_EXT = /\.xlsx$/i;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// 4 MB — Vercel caps a serverless request body at ~4.5 MB, so anything larger
// is rejected at the platform edge with an opaque error before this code runs.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const isXlsx = XLSX_EXT.test(file.originalname) || file.mimetype === XLSX_MIME;
    const isCsv =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream' ||
      /\.csv$/i.test(file.originalname);
    if (!isXlsx && !isCsv) {
      cb(Object.assign(new Error('Please upload a .csv or .xlsx file'), { statusCode: 415 }));
      return;
    }
    cb(null, true);
  },
});

const SCHEMA_FIELD_CHOICES = FIELDS.map((f) => ({
  name: f.name,
  category: f.category,
  required: f.required,
}));

/** Up to 3 non-empty example cell values for a header, to show in the UI. */
function sampleValues(parsed, header) {
  const out = [];
  for (const row of parsed.rows) {
    const v = row[header];
    if (v !== undefined && v !== null && String(v).trim() !== '') out.push(String(v).trim());
    if (out.length === 3) break;
  }
  return out;
}

function mergeResponse(res, report, periodsAdded, periodsUpdated, extra = {}) {
  res.json({
    ok: true,
    stored: periodsAdded + periodsUpdated,
    periodsAdded,
    periodsUpdated,
    ...report,
    ...extra,
  });
}

router.post('/upload', requireVerified, uploadLimiter, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file received. Send a CSV or .xlsx as form field "file".' });
      return;
    }

    const orgId = req.auth.orgId;
    const isXlsx = XLSX_EXT.test(req.file.originalname) || req.file.mimetype === XLSX_MIME;
    const source = isXlsx ? 'xlsx_upload' : 'csv_upload';
    const parsed = isXlsx
      ? parseXlsx(req.file.buffer)
      : parseCsv(req.file.buffer.toString('utf8'));

    const { report, rows } = await ingestParsed(parsed, {
      filename: req.file.originalname,
      orgId,
      source,
    });

    // Phase 14b: a low-confidence mapping pauses the upload before storage.
    if (report.fieldsNeedingConfirmation.length > 0) {
      const pendingId = await pendingUploads.put({
        orgId,
        parsed,
        mapping: report.columnMapping,
        filename: req.file.originalname,
        source,
      });
      res.json({
        ok: true,
        needsConfirmation: true,
        pendingId,
        filename: req.file.originalname,
        headers: report.headers,
        columnMapping: report.columnMapping,
        fieldsNeedingConfirmation: report.fieldsNeedingConfirmation.map((f) => ({
          ...f,
          samples: sampleValues(parsed, f.header),
        })),
        unmappedHeaders: report.unmappedHeaders,
        schemaFields: SCHEMA_FIELD_CHOICES,
      });
      return;
    }

    const { periodsAdded, periodsUpdated } = await mergeStandardizedData(orgId, rows);
    mergeResponse(res, report, periodsAdded, periodsUpdated);
  } catch (err) {
    next(err);
  }
});

router.post('/upload/confirm', requireVerified, uploadLimiter, async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;
    const { pendingId, corrections } = req.body || {};
    const entry = await pendingUploads.take(pendingId, orgId);
    if (!entry) {
      res.status(404).json({
        ok: false,
        error: 'That pending upload expired or was already completed. Please upload the file again.',
      });
      return;
    }

    const validField = new Set(SCHEMA_FIELD_CHOICES.map((f) => f.name));
    const mapping = JSON.parse(JSON.stringify(entry.mapping));
    const confirmedFields = [];

    for (const [header, choiceRaw] of Object.entries(corrections || {})) {
      if (!(header in mapping)) continue;
      const choice = choiceRaw ? String(choiceRaw) : null;
      const prev = mapping[header] || { field: null, confidence: 0 };

      if (!choice) {
        mapping[header] = { field: null, confidence: 0, source: 'user_rejected' };
      } else if (!validField.has(choice)) {
        continue;
      } else if (choice === prev.field) {
        // Confirmed the guess as-is: keep its low confidence so 14a still caps
        // the card at Medium, but record that a human signed off.
        mapping[header] = { ...prev, source: 'user_confirmed' };
        confirmedFields.push(choice);
      } else {
        // Deliberately re-pointed to a different field — treat as authoritative.
        mapping[header] = { field: choice, confidence: 1, source: 'user_corrected' };
      }
    }

    const { report, rows } = await ingestParsed(entry.parsed, {
      filename: entry.filename,
      orgId,
      source: entry.source,
      mapping,
      confirmedFields,
    });

    const { periodsAdded, periodsUpdated } = await mergeStandardizedData(orgId, rows);
    mergeResponse(res, report, periodsAdded, periodsUpdated, {
      confirmedMappingApplied: true,
      // Every low-confidence mapping in this file has now been through the
      // confirmation step — don't re-nag about it in the summary.
      fieldsNeedingConfirmation: [],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/manual-entry', requireVerified, async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;
    const values = (req.body && req.body.values) || req.body || {};
    const { row, warnings } = ingestManualEntry(values, { orgId });
    const { inserted } = await upsertStandardizedRow(orgId, row);
    res.json({
      ok: true,
      stored: 1,
      period: row.period_date,
      periodsAdded: inserted ? 1 : 0,
      periodsUpdated: inserted ? 0 : 1,
      warnings,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/data', async (req, res, next) => {
  try {
    const rows = await getStandardizedData(req.auth.orgId);
    res.json({ count: rows.length, rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
