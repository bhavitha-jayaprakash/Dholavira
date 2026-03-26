// ============================================================
// Tips Route — /api/v1/tips
// ============================================================
// GET /current         — Tips for the current season
// GET /seasons         — Summary of all seasons
// GET /:season         — Tips for a specific season
//
// Seasonal awareness tips from KSDMA, NDMA, and community
// preparedness guidelines.
// ============================================================

import { Router } from 'express';
import * as response from '../utils/apiResponse.js';
import {
  getCurrentSeasonTips,
  getTipsBySeason,
  getAllSeasonsSummary,
} from '../services/seasonalTips.js';

const router = Router();

// ──────────────────────────────────────────────────────────────
// GET /current — Tips based on current date
// ──────────────────────────────────────────────────────────────

router.get('/current', (_req, res) => {
  const data = getCurrentSeasonTips();
  return response.success(res, data);
});

// ──────────────────────────────────────────────────────────────
// GET /seasons — Overview of all seasons
// ──────────────────────────────────────────────────────────────

router.get('/seasons', (_req, res) => {
  const data = getAllSeasonsSummary();
  return response.success(res, data);
});

// ──────────────────────────────────────────────────────────────
// GET /:season — Tips for a specific season
// ──────────────────────────────────────────────────────────────
// Accepts: 'pre_monsoon', 'monsoon', 'post_monsoon', 'dry_season'
// Also works with hyphens: 'pre-monsoon'
// ──────────────────────────────────────────────────────────────

router.get('/:season', (req, res) => {
  const data = getTipsBySeason(req.params.season);

  if (!data) {
    return response.validationError(res, [
      `Invalid season "${req.params.season}". Valid options: pre_monsoon, monsoon, post_monsoon, dry_season`,
    ]);
  }

  return response.success(res, data);
});

export default router;
