// ============================================================
// Feasibility Route — /api/v1/feasibility
// ============================================================
// POST /              — Run a site feasibility check
// GET  /:id           — Retrieve a past check by ID
// GET  /history       — Paginated list of past checks
//
// Uses PostGIS ST_Intersects to check coordinates against
// Flood, Landslide, Coastal, and Seismic hazard zones.
// Additionally queries proximity to Historic Disasters.
// ============================================================

import { Router } from 'express';
import pool from '../config/db.js';
import { validate } from '../middleware/validate.js';
import * as response from '../utils/apiResponse.js';
import { BUILDING_TYPES, RISK_PRIORITY } from '../config/constants.js';
import { logger } from '../utils/logger.js';

const router = Router();
const TAG = 'Feasibility';

// ──────────────────────────────────────────────────────────────
// Validation Schemas
// ──────────────────────────────────────────────────────────────

const feasibilitySchema = {
  latitude:     { type: 'number', required: true, min: -90,  max: 90,  label: 'Latitude' },
  longitude:    { type: 'number', required: true, min: -180, max: 180, label: 'Longitude' },
  buildingType: { type: 'string', required: true, enum: BUILDING_TYPES, label: 'Building Type' },
};

// ──────────────────────────────────────────────────────────────
// SQL Queries
// ──────────────────────────────────────────────────────────────

/** Check flood zone intersection. ST_MakePoint takes (lon, lat). */
const FLOOD_QUERY = `
  SELECT id, zone_name, district, risk_level, return_period, description
  FROM flood_zones
  WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
  ORDER BY return_period ASC;
`;

/** Check landslide zone intersection. */
const LANDSLIDE_QUERY = `
  SELECT id, zone_name, district, susceptibility_level, soil_type, slope_gradient, description
  FROM landslide_zones
  WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
  ORDER BY susceptibility_level DESC;
`;

/** Check coastal zone intersection. */
const COASTAL_QUERY = `
  SELECT id, zone_name, district, risk_level, hazard_type, description
  FROM coastal_zones
  WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
  ORDER BY risk_level DESC;
`;

/** Check seismic zone intersection. */
const SEISMIC_QUERY = `
  SELECT id, zone_name, district, sensitivity as risk_level, fault_line, description
  FROM seismic_zones
  WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
  ORDER BY sensitivity DESC;
`;

/** Find historic disasters within a 15km radius (~0.135 degrees approximation for speed) */
const HISTORIC_DISASTER_QUERY = `
  SELECT id, event_name, disaster_type, event_year, severity, fatality_est, description,
         Round(CAST(ST_DistanceSphere(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))/1000 AS numeric), 2) as distance_km
  FROM historic_disasters
  WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326), 0.135)
  ORDER BY distance_km ASC;
`;


/** Log the feasibility check. */
const LOG_QUERY = `
  INSERT INTO feasibility_checks
    (latitude, longitude, building_type, flood_risk, landslide_risk, overall_risk)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id, checked_at;
`;

/** Retrieve a check by ID. */
const GET_BY_ID_QUERY = `
  SELECT * FROM feasibility_checks WHERE id = $1;
`;

/** Paginated history. */
const HISTORY_QUERY = `
  SELECT id, latitude, longitude, building_type, overall_risk, checked_at
  FROM feasibility_checks
  ORDER BY checked_at DESC
  LIMIT $1 OFFSET $2;
`;

const HISTORY_COUNT_QUERY = `
  SELECT COUNT(*) AS total FROM feasibility_checks;
`;

// ──────────────────────────────────────────────────────────────
// Risk Computation
// ──────────────────────────────────────────────────────────────

function computeOverallRisk(floodZones, landslideZones, coastalZones, seismicZones) {
  let maxRisk = 0;
  for (const z of floodZones) {
    const p = RISK_PRIORITY[z.risk_level] || 0;
    if (p > maxRisk) maxRisk = p;
  }
  for (const z of landslideZones) {
    const p = RISK_PRIORITY[z.susceptibility_level] || 0;
    if (p > maxRisk) maxRisk = p;
  }
  for (const z of coastalZones) {
    const p = RISK_PRIORITY[z.risk_level] || 0;
    if (p > maxRisk) maxRisk = p;
  }
  for (const z of seismicZones) {
    const p = RISK_PRIORITY[z.risk_level] || 0;
    if (p > maxRisk) maxRisk = p;
  }
  
  const match = Object.entries(RISK_PRIORITY).find(([, v]) => v === maxRisk);
  return match ? match[0] : 'none';
}

// ──────────────────────────────────────────────────────────────
// POST / — Run feasibility check
// ──────────────────────────────────────────────────────────────

router.post('/', validate(feasibilitySchema), async (req, res, next) => {
  try {
    const { latitude, longitude, buildingType } = req.body;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const normalizedType = buildingType.toLowerCase();

    logger.info(TAG, `Check: ${lat}, ${lng}, ${normalizedType}`);

    // Run spatial queries in parallel
    // If DB is not fully seeded yet, gracefully handle missing tables
    let floodResult={rows:[]}, landslideResult={rows:[]}, coastalResult={rows:[]}, seismicResult={rows:[]}, historicResult={rows:[]};
    
    try {
      [floodResult, landslideResult, coastalResult, seismicResult, historicResult] = await Promise.all([
        pool.query(FLOOD_QUERY, [lng, lat]),
        pool.query(LANDSLIDE_QUERY, [lng, lat]),
        pool.query(COASTAL_QUERY, [lng, lat]),
        pool.query(SEISMIC_QUERY, [lng, lat]),
        pool.query(HISTORIC_DISASTER_QUERY, [lng, lat])
      ]);
    } catch (e) {
      logger.warn(TAG, `Note: Spatial query failed (likely tables not spun up): ${e.message}`);
    }

    const floodZones = floodResult.rows;
    const landslideZones = landslideResult.rows;
    const coastalZones = coastalResult.rows;
    const seismicZones = seismicResult.rows;
    const historicDisasters = historicResult.rows;

    const overallRisk = computeOverallRisk(floodZones, landslideZones, coastalZones, seismicZones);

    // Provide a state-wide baseline seismic zone since all of Kerala is Zone III
    const baselineSeismic = seismicZones.length > 0 ? seismicZones : [{
       zone_name: 'Kerala State Seismic Zone III',
       risk_level: 'moderate',
       description: 'All of Kerala falls under Seismic Zone III (moderate damage risk zone) according to IS 1893:2016.'
    }];

    // Log the check
    let checkId = null;
    let checkedAt = null;
    try {
      const logResult = await pool.query(LOG_QUERY, [
        lat, lng, normalizedType,
        JSON.stringify(floodZones),
        JSON.stringify(landslideZones),
        overallRisk,
      ]);
      checkId = logResult.rows[0].id;
      checkedAt = logResult.rows[0].checked_at;
    } catch (logErr) {
      logger.warn(TAG, `Failed to log check: ${logErr.message}`);
    }

    return response.success(res, {
      checkId,
      checkedAt,
      coordinates: { latitude: lat, longitude: lng },
      buildingType: normalizedType,
      floodRisk: {
        found: floodZones.length > 0,
        count: floodZones.length,
        zones: floodZones,
      },
      landslideRisk: {
        found: landslideZones.length > 0,
        count: landslideZones.length,
        zones: landslideZones,
      },
      coastalRisk: {
        found: coastalZones.length > 0,
        count: coastalZones.length,
        zones: coastalZones,
      },
      seismicRisk: {
        found: true,
        count: baselineSeismic.length,
        zones: baselineSeismic,
      },
      historicProximity: {
        found: historicDisasters.length > 0,
        count: historicDisasters.length,
        events: historicDisasters,
      },
      overallRisk,
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// GET /history — Paginated list of past checks
// ──────────────────────────────────────────────────────────────

router.get('/history', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      pool.query(HISTORY_QUERY, [limit, offset]),
      pool.query(HISTORY_COUNT_QUERY),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return response.success(res, dataResult.rows, 200, {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: offset + limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// GET /:id — Retrieve a past check
// ──────────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return response.validationError(res, ['ID must be a valid integer']);
    }

    const result = await pool.query(GET_BY_ID_QUERY, [id]);
    if (result.rows.length === 0) {
      return response.notFound(res, 'Feasibility check');
    }

    return response.success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
