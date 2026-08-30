/**
 * POST /api/upload        — CSV or .xlsx upload (multipart).
 * POST /api/manual-entry  — a single period entered by hand.
 * GET  /api/data          — the current standardized dataset (for inspection).
 *
 * All three route through the one ingestion pipeline in services/ingest.js and
 * are scoped by req.auth.orgId.
 */

const express = require('express');
const multer = require('multer');

const {
  ingestCsv,
  ingestXlsx,
  ingestManualEntry,
} = require('../services/ingest');
const {
  replaceStandardizedData,
  upsertStandardizedRow,
  getStandardizedData,
} = require('../db');

const router = express.Router();

const XLSX_EXT = /\.xlsx$/i;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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

router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file received. Send a CSV or .xlsx as form field "file".' });
      return;
    }

    const orgId = req.auth.orgId;
    const isXlsx =
      XLSX_EXT.test(req.file.originalname) || req.file.mimetype === XLSX_MIME;

    const { report, rows } = isXlsx
      ? await ingestXlsx(req.file.buffer, { filename: req.file.originalname, orgId })
      : await ingestCsv(req.file.buffer.toString('utf8'), {
          filename: req.file.originalname,
          orgId,
        });

    const stored = await replaceStandardizedData(orgId, rows);
    res.json({ ok: true, stored, ...report });
  } catch (err) {
    next(err);
  }
});

router.post('/manual-entry', async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;
    const values = (req.body && req.body.values) || req.body || {};
    const { row, warnings } = ingestManualEntry(values, { orgId });
    await upsertStandardizedRow(orgId, row);
    res.json({ ok: true, stored: 1, period: row.period_date, warnings });
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
