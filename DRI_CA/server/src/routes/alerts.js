// ============================================================
// Alerts Route — /api/v1/alerts
// ============================================================
// POST   /             — Create a new community alert
// GET    /             — List active alerts (filterable)
// GET    /:id          — Get specific alert detail
// PATCH  /:id/verify   — Mark an alert as verified
//
// Community-sourced alerts for floods, landslides, road blocks,
// evacuation notices, and relief camp info.
// ============================================================

import { Router } from 'express';
import pool from '../config/db.js';
import { validate } from '../middleware/validate.js';
import * as response from '../utils/apiResponse.js';
import { ALERT_TYPES, ALERT_SEVERITIES, KERALA_DISTRICTS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

const router = Router();
const TAG = 'Alerts';

// ──────────────────────────────────────────────────────────────
// Validation Schema
// ──────────────────────────────────────────────────────────────

const createAlertSchema = {
  title:        { type: 'string', required: true, min: 5, max: 200, label: 'Title' },
  description:  { type: 'string', required: true, min: 10, max: 2000, label: 'Description' },
  alert_type:   { type: 'string', required: true, enum: ALERT_TYPES, label: 'Alert Type' },
  severity:     { type: 'string', required: true, enum: ALERT_SEVERITIES, label: 'Severity' },
  district:     { type: 'string', required: true, label: 'District' },
  latitude:     { type: 'number', required: false, min: -90, max: 90, label: 'Latitude' },
  longitude:    { type: 'number', required: false, min: -180, max: 180, label: 'Longitude' },
};

// ──────────────────────────────────────────────────────────────
// SQL Queries
// ──────────────────────────────────────────────────────────────

const CREATE_ALERT = `
  INSERT INTO community_alerts
    (title, description, alert_type, severity, district, latitude, longitude, reported_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING *;
`;

const LIST_ALERTS = `
  SELECT * FROM community_alerts
  WHERE is_active = true
    AND ($1::text IS NULL OR alert_type = $1)
    AND ($2::text IS NULL OR district = $2)
    AND ($3::text IS NULL OR severity = $3)
  ORDER BY
    CASE severity
      WHEN 'critical' THEN 1
      WHEN 'warning' THEN 2
      WHEN 'advisory' THEN 3
      WHEN 'info' THEN 4
    END,
    created_at DESC
  LIMIT $4 OFFSET $5;
`;

const COUNT_ALERTS = `
  SELECT COUNT(*) AS total FROM community_alerts
  WHERE is_active = true
    AND ($1::text IS NULL OR alert_type = $1)
    AND ($2::text IS NULL OR district = $2)
    AND ($3::text IS NULL OR severity = $3);
`;

const GET_ALERT = `SELECT * FROM community_alerts WHERE id = $1;`;

const VERIFY_ALERT = `
  UPDATE community_alerts
  SET is_verified = true, verified_at = NOW()
  WHERE id = $1
  RETURNING *;
`;

// ──────────────────────────────────────────────────────────────
// POST / — Create alert
// ──────────────────────────────────────────────────────────────

router.post('/', validate(createAlertSchema), async (req, res, next) => {
  try {
    const { title, description, alert_type, severity, district, latitude, longitude, reported_by } = req.body;

    const result = await pool.query(CREATE_ALERT, [
      title, description,
      alert_type.toLowerCase(), severity.toLowerCase(),
      district,
      latitude || null, longitude || null,
      reported_by || 'anonymous',
    ]);

    logger.info(TAG, `Alert created: ${title} (${severity})`);
    return response.created(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// GET / — List alerts (filterable)
// ──────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { type, district, severity } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      pool.query(LIST_ALERTS, [type || null, district || null, severity || null, limit, offset]),
      pool.query(COUNT_ALERTS, [type || null, district || null, severity || null]),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return response.success(res, dataResult.rows, 200, {
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      filters: { type: type || 'all', district: district || 'all', severity: severity || 'all' },
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// GET /:id — Single alert detail
// ──────────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.validationError(res, ['ID must be a valid integer']);

    const result = await pool.query(GET_ALERT, [id]);
    if (result.rows.length === 0) return response.notFound(res, 'Alert');

    return response.success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// PATCH /:id/verify — Mark alert as verified
// ──────────────────────────────────────────────────────────────

router.patch('/:id/verify', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.validationError(res, ['ID must be a valid integer']);

    const result = await pool.query(VERIFY_ALERT, [id]);
    if (result.rows.length === 0) return response.notFound(res, 'Alert');

    logger.info(TAG, `Alert #${id} verified`);
    return response.success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
