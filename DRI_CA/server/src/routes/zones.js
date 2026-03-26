// ============================================================
// Zones Route — /api/v1/zones
// ============================================================
// GET /flood           — List all flood hazard zones
// GET /landslide       — List all landslide susceptibility zones
// GET /stats           — Aggregate statistics across all zones
//
// These endpoints return zone data with GeoJSON geometries
// for map rendering in the Flutter client.
// ============================================================

import { Router } from 'express';
import pool from '../config/db.js';
import * as response from '../utils/apiResponse.js';

const router = Router();

// ──────────────────────────────────────────────────────────────
// GET /flood — All flood zones with GeoJSON geometry
// ──────────────────────────────────────────────────────────────

const FLOOD_ZONES_QUERY = `
  SELECT
    id, zone_name, district, risk_level, return_period, description,
    ST_AsGeoJSON(geom)::json AS geometry,
    created_at
  FROM flood_zones
  ORDER BY return_period ASC;
`;

router.get('/flood', async (_req, res, next) => {
  try {
    const result = await pool.query(FLOOD_ZONES_QUERY);
    return response.success(res, result.rows, 200, { count: result.rowCount });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// GET /landslide — All landslide zones with GeoJSON geometry
// ──────────────────────────────────────────────────────────────

const LANDSLIDE_ZONES_QUERY = `
  SELECT
    id, zone_name, district, susceptibility_level, soil_type,
    slope_gradient, description,
    ST_AsGeoJSON(geom)::json AS geometry,
    created_at
  FROM landslide_zones
  ORDER BY susceptibility_level DESC;
`;

router.get('/landslide', async (_req, res, next) => {
  try {
    const result = await pool.query(LANDSLIDE_ZONES_QUERY);
    return response.success(res, result.rows, 200, { count: result.rowCount });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// GET /stats — Aggregate zone statistics
// ──────────────────────────────────────────────────────────────

const FLOOD_STATS_QUERY = `
  SELECT
    COUNT(*) AS total_zones,
    COUNT(*) FILTER (WHERE risk_level = 'very_high') AS very_high,
    COUNT(*) FILTER (WHERE risk_level = 'high') AS high,
    COUNT(*) FILTER (WHERE risk_level = 'moderate') AS moderate,
    COUNT(*) FILTER (WHERE risk_level = 'low') AS low,
    array_agg(DISTINCT district) AS districts
  FROM flood_zones;
`;

const LANDSLIDE_STATS_QUERY = `
  SELECT
    COUNT(*) AS total_zones,
    COUNT(*) FILTER (WHERE susceptibility_level = 'very_high') AS very_high,
    COUNT(*) FILTER (WHERE susceptibility_level = 'high') AS high,
    COUNT(*) FILTER (WHERE susceptibility_level = 'moderate') AS moderate,
    COUNT(*) FILTER (WHERE susceptibility_level = 'low') AS low,
    array_agg(DISTINCT district) AS districts
  FROM landslide_zones;
`;

const CHECKS_STATS_QUERY = `
  SELECT
    COUNT(*) AS total_checks,
    COUNT(*) FILTER (WHERE overall_risk = 'none') AS safe,
    COUNT(*) FILTER (WHERE overall_risk IN ('moderate', 'high', 'very_high')) AS risky,
    MAX(checked_at) AS last_check
  FROM feasibility_checks;
`;

router.get('/stats', async (_req, res, next) => {
  try {
    const [floodStats, landslideStats, checkStats] = await Promise.all([
      pool.query(FLOOD_STATS_QUERY),
      pool.query(LANDSLIDE_STATS_QUERY),
      pool.query(CHECKS_STATS_QUERY),
    ]);

    return response.success(res, {
      flood: floodStats.rows[0],
      landslide: landslideStats.rows[0],
      feasibility_checks: checkStats.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

export default router;
