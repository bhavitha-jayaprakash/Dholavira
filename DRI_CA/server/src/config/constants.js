// ============================================================
// Application Constants & Enums
// ============================================================
// Centralized definitions used across the API. Keeps magic
// strings out of route/service code and ensures consistency.
// ============================================================

/** Valid building types accepted by the feasibility API. */
export const BUILDING_TYPES = [
  'residential',
  'commercial',
  'industrial',
  'institutional',
  'agricultural',
];

/** Risk levels, ordered by severity. */
export const RISK_LEVELS = ['none', 'low', 'moderate', 'high', 'very_high', 'catastrophic'];

/** Numeric priority map for risk comparison. */
export const RISK_PRIORITY = {
  catastrophic: 5,
  very_high: 4,
  high: 3,
  moderate: 2,
  low: 1,
  none: 0,
};

/** Kerala districts for validation. */
export const KERALA_DISTRICTS = [
  'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha',
  'Kottayam', 'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad',
  'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod',
];

/** Alert severity levels. */
export const ALERT_SEVERITIES = ['info', 'advisory', 'warning', 'critical'];

/** Alert types for community reporting. */
export const ALERT_TYPES = [
  'flood',
  'landslide',
  'heavy_rain',
  'cyclone',
  'earthquake',
  'tsunami',
  'dam_release',
  'road_block',
  'evacuation',
  'relief_camp',
  'general',
];

/** Kerala seasonal calendar for awareness tips. */
export const SEASONS = {
  PRE_MONSOON:  { months: [3, 4, 5],       label: 'Pre-Monsoon (Mar–May)' },
  MONSOON:      { months: [6, 7, 8, 9],    label: 'Monsoon (Jun–Sep)' },
  POST_MONSOON: { months: [10, 11],        label: 'Post-Monsoon (Oct–Nov)' },
  DRY_SEASON:   { months: [12, 1, 2],      label: 'Dry Season (Dec–Feb)' },
};

/** Bhashini language codes. */
export const LANGUAGES = {
  en: { code: 'en', name: 'English' },
  ml: { code: 'ml', name: 'Malayalam' },
  hi: { code: 'hi', name: 'Hindi' },
  ta: { code: 'ta', name: 'Tamil' },
  kn: { code: 'kn', name: 'Kannada' },
};

/**
 * Get the current Kerala season based on a month number (1-12).
 * @param {number} month - 1 = January, 12 = December
 * @returns {{ key: string, label: string }}
 */
export function getSeasonForMonth(month) {
  for (const [key, { months, label }] of Object.entries(SEASONS)) {
    if (months.includes(month)) return { key, label };
  }
  return { key: 'DRY_SEASON', label: SEASONS.DRY_SEASON.label };
}
