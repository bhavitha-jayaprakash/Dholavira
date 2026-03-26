// ============================================================
// Semantic Simplification Service
// ============================================================
// Transforms dense civil engineering / geotechnical jargon into
// clear, step-by-step layperson language using a domain-specific
// glossary and rule-based text processing.
//
// This is DETERMINISTIC — no LLM calls. Every simplification
// is traceable to a glossary entry. This keeps the service
// offline-capable and auditable.
// ============================================================

// ──────────────────────────────────────────────────────────────
// Domain Glossary
// ──────────────────────────────────────────────────────────────
// Maps technical terms/phrases to simpler equivalents.
// Order matters: longer phrases are matched first to avoid
// partial replacements.
// ──────────────────────────────────────────────────────────────

const GLOSSARY = [
  // Multi-word phrases first (longest match priority)
  { term: 'dynamic earth pressure retaining walls', simple: 'strong retaining walls designed to withstand earthquake shaking', domain: 'geotechnical' },
  { term: 'dynamic earth pressure', simple: 'the force that soil pushes against a wall, especially during earthquakes', domain: 'geotechnical' },
  { term: 'pore-water pressure', simple: 'water pressure trapped inside the soil', domain: 'geotechnical' },
  { term: 'hydrostatic pressure', simple: 'the pressure created by standing water', domain: 'hydraulics' },
  { term: 'hydrodynamic pressure', simple: 'the force of moving water', domain: 'hydraulics' },
  { term: 'capillary action', simple: 'moisture creeping upward through walls like a sponge', domain: 'materials' },
  { term: 'factor of safety', simple: 'safety margin (how much stronger the structure is than the minimum needed)', domain: 'structural' },
  { term: 'shear strength', simple: 'the soil\'s ability to hold together without sliding', domain: 'geotechnical' },
  { term: 'slope gradient', simple: 'steepness of the hill', domain: 'geotechnical' },
  { term: 'soil nailing', simple: 'driving long steel rods into the ground to anchor loose soil to solid rock', domain: 'geotechnical' },
  { term: 'soil piping', simple: 'underground tunnels formed by water eroding through soil (very dangerous and invisible from the surface)', domain: 'geotechnical' },
  { term: 'debris flow', simple: 'a fast-moving river of mud, rocks, and debris', domain: 'hazard' },
  { term: 'mass movement', simple: 'large-scale movement of soil or rock downhill (landslide)', domain: 'hazard' },
  { term: 'slip surface', simple: 'the underground layer where the earth starts to slide', domain: 'geotechnical' },
  { term: 'overburden materials', simple: 'loose, heavy material sitting on top of the slope', domain: 'geotechnical' },
  { term: 'Damp Proof Course', simple: 'waterproof layer', domain: 'construction' },
  { term: 'stack effect', simple: 'natural airflow where hot air rises and pulls in cool air from below', domain: 'architecture' },
  { term: 'chirp spread spectrum', simple: 'a radio signal technique that works over very long distances with very little power', domain: 'communications' },
  { term: 'cross-ventilation', simple: 'windows on opposite sides so air flows through the building', domain: 'architecture' },
  { term: 'return period', simple: 'how often this type of flood is expected (e.g., "25-year flood" means it has a 4% chance each year)', domain: 'hydrology' },
  { term: 'RCP 8.5', simple: 'worst-case climate change scenario predicted by scientists', domain: 'climate' },
  { term: 'build back better', simple: 'rebuilding stronger and safer than before the disaster', domain: 'policy' },
  { term: 'catchment area', simple: 'the land area that collects rainwater flowing into a river', domain: 'hydrology' },
  { term: 'inundation', simple: 'flooding / being covered by water', domain: 'hydrology' },
  { term: 'seismic shear wall', simple: 'a solid wall specially designed to resist earthquake shaking forces', domain: 'structural' },
  { term: 'continuous seismic band', simple: 'a strong belt of concrete or timber running around all walls to hold them firmly together during an earthquake', domain: 'structural' },
  { term: 'aerodynamic roofing', simple: 'a roof shape designed to let storm winds flow over it smoothly without ripping it off', domain: 'cyclone' },
  { term: 'saline-resistant cement', simple: 'special cement that does not decay or rust when hit by ocean saltwater', domain: 'materials' },
  { term: 'cyclonic wind shear', simple: 'extreme, twisting storm winds that can tear weak roofs apart', domain: 'cyclone' },
  { term: 'hydrodynamic run-up', simple: 'how far inland and how high a massive ocean wave travels when hitting the coast', domain: 'tsunami' },
  { term: 'mangrove bio-shield', simple: 'a thick forest of coastal trees planted to naturally block storm waves before they hit houses', domain: 'coastal' },

  // Single terms (shorter)
  { term: 'laterite', simple: 'red tropical soil (common in Kerala, becomes weak when very wet)', domain: 'geology' },
  { term: 'geotextile', simple: 'strong fabric material used to stabilize soil', domain: 'construction' },
  { term: 'geo-textile', simple: 'strong fabric material used to stabilize soil', domain: 'construction' },
  { term: 'spalling', simple: 'chunks of concrete or brick breaking off from a surface', domain: 'materials' },
  { term: 'porosity', simple: 'how much water a material can absorb', domain: 'materials' },
  { term: 'plinth', simple: 'the base/foundation level of a building', domain: 'construction' },
  { term: 'stilts', simple: 'raised support columns that lift a building off the ground', domain: 'construction' },
  { term: 'masonry', simple: 'brick or block wall construction', domain: 'construction' },
  { term: 'retrofitting', simple: 'strengthening an existing building', domain: 'construction' },
  { term: 'benching', simple: 'cutting a hillside into flat steps (terraces)', domain: 'earthwork' },
  { term: 'gabion', simple: 'wire cage filled with rocks (used to hold back earth)', domain: 'construction' },
  { term: 'tendon', simple: 'steel rod or cable used for anchoring', domain: 'structural' },
  { term: 'egress', simple: 'exit / escape route', domain: 'safety' },
  { term: 'anthropogenic', simple: 'caused by human activity', domain: 'general' },
  { term: 'mitigation', simple: 'reducing the damage or risk', domain: 'general' },
  { term: 'substratum', simple: 'the layer of rock or hard soil beneath the surface', domain: 'geology' },
  { term: 'strata', simple: 'layers of rock or soil', domain: 'geology' },
];

// Sort by term length (longest first) for greedy matching
const SORTED_GLOSSARY = [...GLOSSARY].sort((a, b) => b.term.length - a.term.length);

// ──────────────────────────────────────────────────────────────
// Simplification Engine
// ──────────────────────────────────────────────────────────────

/**
 * Simplify technical text by replacing jargon terms with
 * their plain-English equivalents.
 *
 * @param {string} text - The technical text to simplify
 * @returns {{ original: string, simplified: string, replacements: Array, stats: object }}
 */
export function simplifyText(text) {
  if (!text || typeof text !== 'string') {
    return {
      original: text || '',
      simplified: text || '',
      replacements: [],
      stats: { terms_found: 0, terms_replaced: 0, glossary_size: GLOSSARY.length },
    };
  }

  let simplified = text;
  const replacements = [];

  for (const entry of SORTED_GLOSSARY) {
    // Case-insensitive search
    const regex = new RegExp(escapeRegex(entry.term), 'gi');
    const matches = simplified.match(regex);

    if (matches) {
      simplified = simplified.replace(regex, entry.simple);
      replacements.push({
        original_term: entry.term,
        replaced_with: entry.simple,
        domain: entry.domain,
        occurrences: matches.length,
      });
    }
  }

  return {
    original: text,
    simplified,
    replacements,
    stats: {
      terms_found: replacements.length,
      total_replacements: replacements.reduce((sum, r) => sum + r.occurrences, 0),
      glossary_size: GLOSSARY.length,
      text_length_original: text.length,
      text_length_simplified: simplified.length,
    },
  };
}

/**
 * Get the full glossary for documentation / client display.
 * @returns {Array}
 */
export function getGlossary() {
  return GLOSSARY.map(({ term, simple, domain }) => ({ term, simple, domain }));
}

/**
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
