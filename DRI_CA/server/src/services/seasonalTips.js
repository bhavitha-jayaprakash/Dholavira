// ============================================================
// Seasonal Awareness Tips Service
// ============================================================
// Provides context-aware disaster preparedness tips based on
// Kerala's seasonal calendar. Each tip is sourced from KSDMA
// IEC materials and community preparedness handbooks.
//
// Seasons:
//   PRE_MONSOON  : March – May
//   MONSOON      : June – September
//   POST_MONSOON : October – November
//   DRY_SEASON   : December – February
// ============================================================

import { SEASONS, getSeasonForMonth } from '../config/constants.js';

// ──────────────────────────────────────────────────────────────
// Seasonal Tips Knowledge Base
// ──────────────────────────────────────────────────────────────

const TIPS_DATABASE = {
  PRE_MONSOON: {
    label: SEASONS.PRE_MONSOON.label,
    urgency: 'preparatory',
    overview: 'The pre-monsoon period is critical for disaster preparedness. Use this time to inspect, repair, and prepare before the rains arrive.',
    tips: [
      {
        id: 'PM-001',
        title: 'Clear All Drainage Channels',
        priority: 'high',
        description: 'Inspect and clear all surface drainage channels, gutters, and culverts around your property. Remove debris, soil deposits, and vegetation that may obstruct water flow during heavy rainfall.',
        source: 'KSDMA Pre-Monsoon Preparedness Checklist',
      },
      {
        id: 'PM-002',
        title: 'Inspect Roof Integrity',
        priority: 'high',
        description: 'Check roof tiles, sheets, and waterproofing membranes for cracks, displacement, or deterioration. Repair or replace damaged sections before the monsoon. Ensure roof drainage is connected and unblocked.',
        source: 'KSDMA Building Safety Guidelines',
      },
      {
        id: 'PM-003',
        title: 'Check Retaining Wall Condition',
        priority: 'medium',
        description: 'If you live on a hillside, visually inspect all retaining walls for cracks, bulging, tilting, or water seepage. Report any damage to local authorities immediately.',
        source: 'KSDMA Landslide Preparedness',
      },
      {
        id: 'PM-004',
        title: 'Prepare Emergency Kit',
        priority: 'high',
        description: 'Assemble an emergency kit with: drinking water (4L per person per day for 3 days), non-perishable food, first-aid supplies, battery-powered radio, flashlights, important documents in waterproof bags, and charged power banks.',
        source: 'NDMA Emergency Kit Guidelines',
      },
      {
        id: 'PM-005',
        title: 'Identify Evacuation Routes',
        priority: 'medium',
        description: 'Know at least two evacuation routes from your home to the nearest designated relief camp or safe high ground. Ensure all family members know these routes. Mark them on a map.',
        source: 'KSDMA Community Preparedness Handbook',
      },
      {
        id: 'PM-006',
        title: 'Check Slope Drainage (Hill Residents)',
        priority: 'high',
        description: 'For properties on slopes: ensure subsurface drainage pipes are clear and functional. Check for new cracks in the ground, tilting trees, or unusual water seepage — early signs of slope instability.',
        source: 'KSDMA Landslide Early Warning Signs',
      },
      {
        id: 'PM-007',
        title: 'Trim Overhanging Trees',
        priority: 'low',
        description: 'Cut back branches that overhang your roof, power lines, or evacuation paths. Strong winds during monsoon storms can turn these into dangerous projectiles.',
        source: 'KSDMA Wind Damage Prevention',
      },
    ],
  },

  MONSOON: {
    label: SEASONS.MONSOON.label,
    urgency: 'active_alert',
    overview: 'The monsoon is the highest-risk period. Stay alert to weather warnings, monitor water levels, and be ready to evacuate at short notice.',
    tips: [
      {
        id: 'MN-001',
        title: 'Monitor KSDMA Warnings Daily',
        priority: 'critical',
        description: 'Check KSDMA and IMD weather bulletins at least twice daily. Pay attention to Red, Orange, and Yellow alerts for your district. Follow @KeralaSDMA on social media for real-time updates.',
        source: 'KSDMA Alert Protocol',
      },
      {
        id: 'MN-002',
        title: 'Watch for Landslide Warning Signs',
        priority: 'critical',
        description: 'Evacuate IMMEDIATELY if you notice: new cracks in the ground or walls, tilting trees or poles, unusual sounds from the hillside (grinding, cracking), sudden increase/decrease in stream water levels, or muddy water in previously clear streams.',
        source: 'Amrita University Real-Time Landslide Warning Protocols',
      },
      {
        id: 'MN-003',
        title: 'Avoid River Crossings During Heavy Rain',
        priority: 'critical',
        description: 'Never attempt to cross flooded roads, bridges, or rivers. Just 15cm (6 inches) of fast-moving water can knock an adult off their feet. 60cm (2 feet) can sweep away a vehicle.',
        source: 'NDRF Safety Guidelines',
      },
      {
        id: 'MN-004',
        title: 'Disconnect Electrical Mains if Flooding',
        priority: 'high',
        description: 'If floodwater is approaching your building, turn off the main electrical supply from the distribution board BEFORE water reaches it. Do not touch any electrical equipment with wet hands or while standing in water.',
        source: 'KSEB Emergency Procedures',
      },
      {
        id: 'MN-005',
        title: 'Secure Important Documents',
        priority: 'high',
        description: 'Keep Aadhaar cards, property documents, insurance papers, ration cards, and medical records in sealed waterproof bags stored above the highest flood level in your home.',
        source: 'KSDMA Evacuation Preparedness',
      },
      {
        id: 'MN-006',
        title: 'Report Distress via Official Channels',
        priority: 'high',
        description: 'If stranded: call the Kerala Disaster Helpline 1077 or NDRF 011-24363260. Share your exact GPS coordinates. Avoid relying solely on WhatsApp forwards — verify information from official sources.',
        source: 'KSDMA Emergency Communication Protocol',
      },
      {
        id: 'MN-007',
        title: 'Boil Drinking Water',
        priority: 'medium',
        description: 'During and after flooding, tap water and well water may be contaminated. Boil all drinking water for at least 1 minute. Use water purification tablets if boiling is not possible.',
        source: 'Kerala Health Department Flood Advisory',
      },
    ],
  },

  POST_MONSOON: {
    label: SEASONS.POST_MONSOON.label,
    urgency: 'recovery',
    overview: 'The post-monsoon period is for damage assessment, structural inspection, and recovery. Do not occupy damaged buildings without professional inspection.',
    tips: [
      {
        id: 'PO-001',
        title: 'Professional Structural Inspection',
        priority: 'high',
        description: 'Have a licensed structural engineer inspect your building before reoccupation, especially if it was submerged. Check for foundation settlement, wall cracks, column damage, and weakened roof structures.',
        source: 'KSDMA Post-Flood Building Safety Protocol',
      },
      {
        id: 'PO-002',
        title: 'Clean and Disinfect',
        priority: 'high',
        description: 'Thoroughly clean all flood-affected surfaces with disinfectant. Remove and dispose of soaked insulation, drywall, and carpeting. Allow the structure to dry completely (minimum 48 hours of ventilation) before repairs.',
        source: 'Kerala Health Department Post-Flood Hygiene Guidelines',
      },
      {
        id: 'PO-003',
        title: 'Check Electrical System',
        priority: 'critical',
        description: 'Do NOT restore power until a licensed electrician has inspected the entire system. Flood-damaged wiring, outlets, and appliances pose severe electrocution and fire risks.',
        source: 'KSEB Post-Flood Reconnection Guidelines',
      },
      {
        id: 'PO-004',
        title: 'Document Damage for Insurance',
        priority: 'medium',
        description: 'Photograph and video-document all flood/landslide damage before cleanup begins. File insurance claims promptly. Contact the District Collector\'s office for government relief assistance.',
        source: 'KSDMA Damage Assessment SOP',
      },
      {
        id: 'PO-005',
        title: 'Monitor for Delayed Landslides',
        priority: 'high',
        description: 'Landslides can occur weeks after heavy rains as soil continues to absorb moisture. Maintain vigilance for the warning signs even after the monsoon officially ends.',
        source: 'NCESS Post-Monsoon Advisory',
      },
    ],
  },

  DRY_SEASON: {
    label: SEASONS.DRY_SEASON.label,
    urgency: 'planning',
    overview: 'Use the dry season for long-term resilience planning, structural improvements, and community preparedness training.',
    tips: [
      {
        id: 'DS-001',
        title: 'Plan Structural Improvements',
        priority: 'medium',
        description: 'This is the ideal time to implement Build Back Better upgrades: elevate plinth heights, install retaining walls, add drainage systems, or retrofit existing structures. Construction during the dry season avoids monsoon complications.',
        source: 'KSDMA BBB Implementation Calendar',
      },
      {
        id: 'DS-002',
        title: 'Community Disaster Drill',
        priority: 'medium',
        description: 'Participate in or organize a community disaster preparedness drill. Practice evacuation routes, emergency communication, and first-aid procedures with your neighborhood.',
        source: 'KSDMA Community Resilience Program',
      },
      {
        id: 'DS-003',
        title: 'Review and Update Emergency Plans',
        priority: 'low',
        description: 'Update your family emergency plan: verify contact numbers, check emergency kit supplies, review evacuation routes (roads may have changed), and ensure all family members know the plan.',
        source: 'NDMA Family Preparedness Handbook',
      },
      {
        id: 'DS-004',
        title: 'Plant Slope-Stabilizing Vegetation',
        priority: 'medium',
        description: 'If you live on a slope, plant deep-rooted indigenous vegetation (vetiver grass, bamboo) to stabilize the soil. The dry season allows roots to establish before the monsoon rains test them.',
        source: 'KSDMA Bio-Engineering Guidelines',
      },
      {
        id: 'DS-005',
        title: 'Water Conservation Awareness',
        priority: 'low',
        description: 'Post-monsoon dry periods can lead to water scarcity. Implement rainwater harvesting systems and maintain water storage infrastructure. Kerala\'s 44 rivers are seasonal — plan accordingly.',
        source: 'Kerala Water Authority Advisory',
      },
    ],
  },
};

// ──────────────────────────────────────────────────────────────
// Service Functions
// ──────────────────────────────────────────────────────────────

/**
 * Get tips for the current season (based on server time).
 * @returns {object} Season label, urgency, overview, and tips array
 */
export function getCurrentSeasonTips() {
  const month = new Date().getMonth() + 1; // 1-12
  const { key } = getSeasonForMonth(month);
  const season = TIPS_DATABASE[key];

  return {
    season: key,
    month,
    ...season,
    tip_count: season.tips.length,
  };
}

/**
 * Get tips for a specific season.
 * @param {string} seasonKey - 'PRE_MONSOON' | 'MONSOON' | 'POST_MONSOON' | 'DRY_SEASON'
 * @returns {object|null} Season data or null if invalid key
 */
export function getTipsBySeason(seasonKey) {
  const normalized = seasonKey.toUpperCase().replace(/-/g, '_');
  const season = TIPS_DATABASE[normalized];
  if (!season) return null;

  return {
    season: normalized,
    ...season,
    tip_count: season.tips.length,
  };
}

/**
 * Get all seasons with their tip counts (for navigation).
 * @returns {Array}
 */
export function getAllSeasonsSummary() {
  return Object.entries(TIPS_DATABASE).map(([key, data]) => ({
    season: key,
    label: data.label,
    urgency: data.urgency,
    tip_count: data.tips.length,
    months: SEASONS[key].months,
  }));
}
