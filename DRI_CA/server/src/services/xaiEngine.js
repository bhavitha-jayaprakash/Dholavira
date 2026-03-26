// ============================================================
// XAI Engine — Explainable AI Remediation Service
// ============================================================
// Rule-based decision tree that maps hazard risk assessments
// to specific structural remediation recommendations from
// KSDMA, PDNA, UNDP, and the Earthquake Handbook.
//
// KEY DESIGN PRINCIPLE:
// This is NOT a black-box LLM. Every recommendation includes:
//   - reason:        WHY this recommendation applies
//   - source:        Which guideline/document it comes from
//   - confidence:    How strongly the rule matched (0.0–1.0)
//   - guideline_ref: Page/section reference for verification
// ============================================================

import { RISK_PRIORITY } from '../config/constants.js';

// ──────────────────────────────────────────────────────────────
// Knowledge Base — Verified Guidelines
// ──────────────────────────────────────────────────────────────

const FLOOD_REMEDIATIONS = [
  {
    id: 'FL-001',
    title: 'Elevated Stilt Foundation',
    category: 'foundation',
    min_risk: 'moderate',
    description: 'Elevate the structure on reinforced concrete or chemically treated bamboo stilts to allow floodwaters, debris, and kinetic energy to pass beneath habitable zones without exerting hydrostatic or hydrodynamic pressure on load-bearing walls.',
    simplified: 'Raise your building on strong stilts (concrete or treated bamboo) so flood water flows underneath instead of pushing against the walls.',
    materials: ['reinforced concrete', 'chemically treated bamboo', 'steel I-beams'],
    source: 'KSDMA PDNA Report 2019, Build Back Better Framework',
    guideline_ref: 'PDNA Section 4.2 — Housing Reconstruction Standards',
    applicable_building_types: ['residential', 'commercial', 'agricultural'],
    eco_friendly: true,
  },
  {
    id: 'FL-002',
    title: 'Disaster-Resilient Masonry',
    category: 'walls',
    min_risk: 'moderate',
    description: 'Utilize masonry with exceptionally low porosity or apply water-resistant, breathable treatments to walls in flood-prone lower levels. This prevents structural weakening, spalling, and capillary action during prolonged inundation.',
    simplified: 'Use special waterproof bricks or apply a water-resistant coating on lower walls so they don\'t absorb water and weaken during floods.',
    materials: ['low-porosity concrete blocks', 'waterproof masonry sealant', 'breathable DPC membrane'],
    source: 'KSDMA PDNA Recovery Strategy — Mason Training Program',
    guideline_ref: 'PDNA Section 4.3 — Masonry Best Practices',
    applicable_building_types: ['residential', 'commercial', 'institutional'],
    eco_friendly: false,
  },
  {
    id: 'FL-003',
    title: 'Elevated Plinth with DPC Layer',
    category: 'foundation',
    min_risk: 'low',
    description: 'Raise the plinth height above the historically recorded maximum flood level (HFL) for the area, with a Damp Proof Course (DPC) layer to prevent capillary moisture rise. Minimum recommended plinth height: 600mm above HFL.',
    simplified: 'Build the base of your house higher than the highest flood level ever recorded in your area. Add a waterproof layer at the base to stop moisture from creeping up the walls.',
    materials: ['concrete', 'bituminous DPC', 'polyethylene sheets'],
    source: 'Indian Standard IS 2878:1975 — Guide for Design of Buildings in Flood-Prone Areas',
    guideline_ref: 'IS 2878 Section 5 — Plinth Protection',
    applicable_building_types: ['residential', 'commercial', 'institutional', 'industrial'],
    eco_friendly: false,
  },
];

const LANDSLIDE_REMEDIATIONS = [
  {
    id: 'LS-001',
    title: 'Surface and Subsurface Drainage Control',
    category: 'drainage',
    min_risk: 'moderate',
    description: 'Install surface interceptor drains to divert runoff, and deep horizontal subsurface pipes to dissipate internal hydrostatic pressure. This maintains the soil\'s internal friction by preventing rapid pore-water pressure buildup during excessive monsoon rainfall.',
    simplified: 'Install drains on the surface to redirect rainwater and underground pipes to release trapped water pressure inside the hillside. This is the most important step because water pressure in the soil is the #1 cause of landslides in Kerala.',
    materials: ['perforated PVC pipes', 'geotextile fabric', 'gravel french drains', 'concrete interceptor channels'],
    source: 'KSDMA Mitigation Measures for Landslides',
    guideline_ref: 'KSDMA Landslide Mitigation Document Section 7',
    applicable_building_types: ['residential', 'commercial', 'institutional', 'agricultural'],
    eco_friendly: true,
  },
  {
    id: 'LS-002',
    title: 'Retaining Wall with Seismic Design',
    category: 'structural',
    min_risk: 'high',
    description: 'Construct reinforced retaining structures (active and passive) accounting for dynamic earth pressures. Kerala falls under Seismic Zone III, so retaining walls must withstand simultaneous seismic acceleration and hydrostatic loads.',
    simplified: 'Build strong retaining walls that can hold back the earth even during an earthquake. Kerala is in an earthquake-prone zone, so the walls must handle both soil pressure AND earthquake shaking at the same time.',
    materials: ['reinforced concrete', 'gabion baskets', 'steel reinforcement bars'],
    source: 'KSDMA Mitigation Guidelines, IS 14680:1999 Landslide Control',
    guideline_ref: 'IS 14680 Section 6 — Retaining Structures for Seismic Zone III',
    applicable_building_types: ['residential', 'commercial', 'institutional', 'industrial'],
    eco_friendly: false,
  },
  {
    id: 'LS-004',
    title: 'Bio-Engineering and Coir Geo-Textiles',
    category: 'nature_based',
    min_risk: 'low',
    description: 'Strategically plant deep-rooted, soil-binding indigenous vegetation to mitigate shallow surface erosion. Apply coir geo-textiles over exposed cuts and embankments for immediate mechanical stabilization while allowing vegetative cover to establish over time.',
    simplified: 'Plant deep-rooted local trees and bushes to hold the soil together. Cover exposed hillside cuts with coconut fiber mats (coir) to prevent erosion while the plants grow and permanently stabilize the slope.',
    materials: ['coir geo-textiles', 'vetiver grass', 'indigenous deep-root species', 'jute netting'],
    source: 'KSDMA Nature-Based Solutions (NBS) Guidelines',
    guideline_ref: 'KSDMA Section 7.6 — Bio-Engineering Solutions',
    applicable_building_types: ['residential', 'agricultural'],
    eco_friendly: true,
  },
];

const COASTAL_REMEDIATIONS = [
  {
    id: 'CO-001',
    title: 'Aerodynamic Roofing for Deflection',
    category: 'roofing',
    min_risk: 'high',
    description: 'Construct pitched roofs with aerodynamic designs (preferably hip roofs at 30-40 degree angles) to minimize drag from cyclonic wind shear. Fasten tiles or sheets securely with J-bolts and washers to prevent uplift.',
    simplified: 'Build sloped roofs (hip roofs) so strong storm winds slide safely over them instead of tearing them off. Always use strong metal hooks and washers to bolt down your roof sheets.',
    materials: ['J-bolts', 'galvanized washers', 'aerodynamic roof tiles'],
    source: 'Orange Book of Disaster Management 2025',
    guideline_ref: 'Orange Book — Cyclone Mitigation Construction',
    applicable_building_types: ['residential', 'commercial', 'institutional'],
    eco_friendly: false,
  },
  {
    id: 'CO-002',
    title: 'Mangrove Bio-Shields',
    category: 'site_planning',
    min_risk: 'moderate',
    description: 'In corporate and agricultural zoning near tidal margins, strictly incorporate a mangrove bio-shield buffer zone. A dense strip dissipates wave energy massively, reducing hydrodynamic run-up during storm surges and tsunamis.',
    simplified: 'Leave a thick strip of native trees or mangroves between your building and the ocean/river to act as a natural wall. These trees will physically block and slow down huge waves heading toward your property.',
    materials: ['mangrove saplings', 'native coastal flora'],
    source: 'KSDMA Nature-Based Solutions Guidelines',
    guideline_ref: 'KSDMA NBS Section 4 — Coastal Defence',
    applicable_building_types: ['residential', 'commercial', 'agricultural'],
    eco_friendly: true,
  },
  {
    id: 'CO-003',
    title: 'Saline-Resistant Foundation Cements',
    category: 'materials',
    min_risk: 'high',
    description: 'Use Sulphate Resisting Portland Cement (SRPC) or Portland Slag Cement (PSC) for all sub-surface concrete works to prevent rapid chloride-induced corrosion of reinforcing steel in saline coastal environments.',
    simplified: 'Use special saline-resistant cement for your foundation so that salty sea water does not rust the steel rods inside the concrete, keeping the building strong for years.',
    materials: ['Sulphate Resisting Portland Cement (SRPC)', 'epoxy-coated rebar'],
    source: 'Orange Book of Disaster Management 2025',
    guideline_ref: 'IS 456 — Concrete in Marine Environments',
    applicable_building_types: ['residential', 'commercial', 'institutional', 'industrial'],
    eco_friendly: false,
  },
];

const EARTHQUAKE_REMEDIATIONS = [
  {
    id: 'EQ-001',
    title: 'Continuous Seismic Bands',
    category: 'structural',
    min_risk: 'moderate', // baseline trigger
    description: 'Provide continuous reinforced concrete or timber seismic bands at the plinth, lintel, and roof levels. These continuous seismic bands tie all masonry walls together to prevent out-of-plane collapse during ground shaking.',
    simplified: 'Install a strong, continuous ring of concrete or timber flat along the walls just above the doors and windows. This acts like a tight belt, holding all the walls together so they don\'t fall outwards. This is required for all homes in Kerala.',
    materials: ['reinforced concrete', 'structural timber', 'reinforcement bars'],
    source: 'Earthquake Handbook Edition 2',
    guideline_ref: 'Handbook Chapter 4 — Seismic Bands',
    applicable_building_types: ['residential', 'commercial', 'institutional', 'industrial', 'agricultural'],
    eco_friendly: false,
  },
  {
    id: 'EQ-002',
    title: 'Symmetrical Structural Configuration',
    category: 'layout',
    min_risk: 'high',
    description: 'Ensure symmetrical architectural layouts (squares or simple rectangles) with seismic shear walls to avoid severe torsional twisting forces at building corners during an earthquake (IS 1893:2016).',
    simplified: 'Design the building to be a simple, equal shape (like a square or smooth rectangle). Complicated L-shapes or irregular forms twist dangerously during an earthquake.',
    materials: ['seismic shear wall'],
    source: 'IS 1893:2016 — Criteria for Earthquake Resistant Design',
    guideline_ref: 'Earthquake Handbook — Architectural Form Configuration',
    applicable_building_types: ['residential', 'commercial', 'institutional', 'industrial'],
    eco_friendly: false,
  },
];

const GENERAL_REMEDIATIONS = [
  {
    id: 'GN-001',
    title: 'Emergency Evacuation Route Planning',
    category: 'safety',
    min_risk: 'moderate',
    description: 'Maintain clear egress paths of minimum 900mm width. Pre-identify at least two evacuation routes to designated relief shelters. Ensure routes avoid historically flooded streets and unstable slopes.',
    simplified: 'Always have at least two escape routes planned from your building to the nearest shelter. Make sure the hallways and doors are wide enough (at least 3 feet) for everyone to leave quickly.',
    materials: [],
    source: 'Orange Book of Disaster Management 2025',
    guideline_ref: 'Orange Book — Evacuation Standards',
    applicable_building_types: ['residential', 'commercial', 'institutional', 'industrial', 'agricultural'],
    eco_friendly: true,
  },
];

// ──────────────────────────────────────────────────────────────
// XAI Decision Engine
// ──────────────────────────────────────────────────────────────

/**
 * Compute confidence score (0.0 - 1.0)
 */
function computeConfidence(actualRisk, minRisk) {
  const actual = RISK_PRIORITY[actualRisk] || 0;
  const min = RISK_PRIORITY[minRisk] || 0;

  if (actual === 0) return 0;
  if (actual < min) return 0;

  const diff = actual - min;
  if (diff === 0) return 0.65;
  if (diff === 1) return 0.80;
  return 0.95;
}

/**
 * Find highest risk level in a hazard payload array
 */
function getWorstCaseRisk(riskObj, riskKey = 'risk_level') {
  let worst = 'none';
  if (riskObj?.found && riskObj.zones.length > 0) {
    for (const zone of riskObj.zones) {
      if ((RISK_PRIORITY[zone[riskKey]] || 0) > (RISK_PRIORITY[worst] || 0)) {
        worst = zone[riskKey];
      }
    }
  }
  return worst;
}

/**
 * Generic rule applier for DRY code
 */
function applyRules(remediationsList, hazardName, worstRisk, buildingType, recommendations, reasoningChain) {
  for (const rem of remediationsList) {
    const confidence = computeConfidence(worstRisk, rem.min_risk);
    const typeMatch = rem.applicable_building_types.includes(buildingType);

    if (confidence > 0 && typeMatch) {
      recommendations.push({
        ...rem,
        hazard_type: hazardName,
        confidence,
        reason: `This site triggered a ${hazardName} warning with worst-case risk level "${worstRisk}". ` +
                `This recommendation applies at "${rem.min_risk}" risk or above for "${buildingType}" buildings.`,
      });

      reasoningChain.push({
        step: reasoningChain.length + 1,
        action: 'RULE_MATCH',
        detail: `${hazardName.toUpperCase()} remediation ${rem.id} (${rem.title}) selected. ` +
                `Confidence: ${(confidence * 100).toFixed(0)}%. ` +
                `Trigger: risk >= ${rem.min_risk}, building = ${buildingType}.`,
      });
    }
  }
}

/**
 * Generate explainable remediation recommendations
 */
export function generateRemediation({ buildingType, overallRisk, floodRisk, landslideRisk, coastalRisk, seismicRisk, coordinates }) {
  const startTime = Date.now();
  const recommendations = [];
  const reasoningChain = [];

  // Determine worst risk per hazard category
  const worstFloodRisk = getWorstCaseRisk(floodRisk, 'risk_level');
  const worstLandslideRisk = getWorstCaseRisk(landslideRisk, 'susceptibility_level');
  const worstCoastalRisk = getWorstCaseRisk(coastalRisk, 'risk_level');
  // Earthquakes are a baseline risk (moderate) in Kerala Zone III, unless elevated by proximity to a fault line
  const worstSeismicRisk = getWorstCaseRisk(seismicRisk, 'risk_level') === 'none' ? 'moderate' : getWorstCaseRisk(seismicRisk, 'risk_level');

  reasoningChain.push({
    step: 1,
    action: 'RISK_SEVERITY_ASSESSMENT',
    detail: `Flood: ${worstFloodRisk}, Landslide: ${worstLandslideRisk}, Coastal: ${worstCoastalRisk}, Seismic: ${worstSeismicRisk}. ` +
            `Overall Site Risk Classification: ${overallRisk}.`,
  });

  // Apply specific matrices
  if (worstFloodRisk !== 'none') applyRules(FLOOD_REMEDIATIONS, 'flood', worstFloodRisk, buildingType, recommendations, reasoningChain);
  if (worstLandslideRisk !== 'none') applyRules(LANDSLIDE_REMEDIATIONS, 'landslide', worstLandslideRisk, buildingType, recommendations, reasoningChain);
  if (worstCoastalRisk !== 'none') applyRules(COASTAL_REMEDIATIONS, 'coastal', worstCoastalRisk, buildingType, recommendations, reasoningChain);
  if (worstSeismicRisk !== 'none') applyRules(EARTHQUAKE_REMEDIATIONS, 'seismic', worstSeismicRisk, buildingType, recommendations, reasoningChain);

  // Apply general if there is any serious risk
  if (overallRisk !== 'none' && RISK_PRIORITY[overallRisk] >= RISK_PRIORITY['moderate']) {
    applyRules(GENERAL_REMEDIATIONS, 'general', overallRisk, buildingType, recommendations, reasoningChain);
  }

  // Sort by confidence (highest first)
  recommendations.sort((a, b) => b.confidence - a.confidence);

  const processingTimeMs = Date.now() - startTime;
  reasoningChain.push({
    step: reasoningChain.length + 1,
    action: 'FINAL_REPORT',
    detail: `Generated ${recommendations.length} total recommendations in ${processingTimeMs}ms across 4 hazard dimensions.`,
  });

  return {
    coordinates,
    buildingType,
    overallRisk,
    summary: buildSummary(overallRisk, recommendations.length, worstFloodRisk!=='none', worstLandslideRisk!=='none', worstCoastalRisk!=='none'),
    recommendations: recommendations.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      hazard_type: r.hazard_type,
      description: r.description,
      simplified: r.simplified,
      materials: r.materials,
      eco_friendly: r.eco_friendly,
      confidence: r.confidence,
      reason: r.reason,
      source: r.source,
      guideline_ref: r.guideline_ref,
    })),
    xai: {
      engine_version: '2.0.0 (Multi-Hazard)',
      method: 'multi_dimensional_decision_tree',
      transparency_note: 'Recommendations derived strictly from verified KSDMA, PDNA, Orange Book 2025, and Earthquake Handbook references. No black-box ML models are used. Kerala falls under Seismic Zone III, triggering baseline earthquake remediations for all locations.',
      reasoning_chain: reasoningChain,
      processing_time_ms: processingTimeMs,
      knowledge_base_size: {
        total_rules: FLOOD_REMEDIATIONS.length + LANDSLIDE_REMEDIATIONS.length + COASTAL_REMEDIATIONS.length + EARTHQUAKE_REMEDIATIONS.length + GENERAL_REMEDIATIONS.length
      },
    },
  };
}

/**
 * Build human-readable summary
 */
function buildSummary(overallRisk, recCount, hasFlood, hasLandslide, hasCoastal) {
  const hazards = [];
  if (hasFlood) hazards.push('flood');
  if (hasLandslide) hazards.push('landslide');
  if (hasCoastal) hazards.push('coastal');
  hazards.push('baseline seismic');
  
  const hazardStr = hazards.join(', ');
  
  return `This site has an overall ${overallRisk} risk classification, driven by checking: ${hazardStr}. ` +
         `${recCount} structural remediation recommendations have been formulated. ` +
         `Please consult with a licensed structural engineer before construction.`;
}

/**
 * Returns full knowledge base
 */
export function getGuidelinesKnowledgeBase() {
  const clean = (arr) => arr.map(({ id, title, category, min_risk, description, source, guideline_ref, eco_friendly }) => ({
    id, title, category, min_risk, description, source, guideline_ref, eco_friendly
  }));

  return {
    flood: clean(FLOOD_REMEDIATIONS),
    landslide: clean(LANDSLIDE_REMEDIATIONS),
    coastal: clean(COASTAL_REMEDIATIONS),
    seismic: clean(EARTHQUAKE_REMEDIATIONS),
    general: clean(GENERAL_REMEDIATIONS),
    meta: {
      total_rules: FLOOD_REMEDIATIONS.length + LANDSLIDE_REMEDIATIONS.length + COASTAL_REMEDIATIONS.length + EARTHQUAKE_REMEDIATIONS.length + GENERAL_REMEDIATIONS.length,
      sources: [
        'KSDMA PDNA Report 2019',
        'Orange Book of Disaster Management 2025',
        'Earthquake Handbook Edition 2',
        'IS 1893:2016 Criteria for Earthquake Resistant Design',
        'KSDMA Nature-Based Solutions Guidelines'
      ],
    },
  };
}
