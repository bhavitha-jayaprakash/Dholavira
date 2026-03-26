// ============================================================
// Remediation Route — /api/v1/remediation
// ============================================================
// POST /              — Generate XAI remediation recommendations
// GET  /guidelines    — Return the full knowledge base
//
// The XAI engine produces transparent, explainable structural
// recommendations with reasoning chains and source citations.
// ============================================================

import { Router } from 'express';
import pool from '../config/db.js';
import { validate } from '../middleware/validate.js';
import * as response from '../utils/apiResponse.js';
import { generateRemediation, getGuidelinesKnowledgeBase } from '../services/xaiEngine.js';
import { BUILDING_TYPES } from '../config/constants.js';
import { logger } from '../utils/logger.js';

const router = Router();
const TAG = 'Remediation';

// ──────────────────────────────────────────────────────────────
// POST / — Generate remediation from a feasibility check
// ──────────────────────────────────────────────────────────────
// Accepts either:
//   (a) { checkId: number }  — looks up a past feasibility check
//   (b) { latitude, longitude, buildingType, overallRisk, floodRisk, landslideRisk }
//       — direct input (for use without a prior check)
// ──────────────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    let input;

    // ── Mode A: From a stored feasibility check ──
    if (req.body.checkId) {
      const id = parseInt(req.body.checkId, 10);
      if (isNaN(id)) {
        return response.validationError(res, ['checkId must be a valid integer']);
      }

      const result = await pool.query(
        'SELECT * FROM feasibility_checks WHERE id = $1', [id]
      );
      if (result.rows.length === 0) {
        return response.notFound(res, 'Feasibility check');
      }

      const check = result.rows[0];
      input = {
        buildingType: check.building_type,
        overallRisk: check.overall_risk,
        floodRisk: {
          found: check.flood_risk && check.flood_risk.length > 0,
          zones: check.flood_risk || [],
        },
        landslideRisk: {
          found: check.landslide_risk && check.landslide_risk.length > 0,
          zones: check.landslide_risk || [],
        },
        coordinates: {
          latitude: parseFloat(check.latitude),
          longitude: parseFloat(check.longitude),
        },
      };

      logger.info(TAG, `Generating remediation from check #${id}`);

    // ── Mode B: Direct input ──
    } else {
      const { latitude, longitude, buildingType, overallRisk, floodRisk, landslideRisk } = req.body;

      if (!buildingType) {
        return response.validationError(res, ['buildingType is required']);
      }
      if (!overallRisk) {
        return response.validationError(res, ['overallRisk is required']);
      }

      input = {
        buildingType: buildingType.toLowerCase(),
        overallRisk,
        floodRisk: floodRisk || { found: false, zones: [] },
        landslideRisk: landslideRisk || { found: false, zones: [] },
        coordinates: {
          latitude: parseFloat(latitude) || 0,
          longitude: parseFloat(longitude) || 0,
        },
      };

      logger.info(TAG, `Generating remediation from direct input`);
    }

    // ── Generate XAI report ──
    const report = generateRemediation(input);

    return response.success(res, report);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// GET /guidelines — Full knowledge base (for audit/reference)
// ──────────────────────────────────────────────────────────────

router.get('/guidelines', (_req, res) => {
  const kb = getGuidelinesKnowledgeBase();
  return response.success(res, kb);
});

export default router;
