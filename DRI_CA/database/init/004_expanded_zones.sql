-- ============================================================
-- DRI & CA — Migration 004: Expanded Multi-Hazard Zones
-- ============================================================
-- Incorporates Coastal Hazard (Erosion/Tsunami/Cyclone)
-- and specific Seismic Hazard Zones (Earthquake fault lines).
-- ============================================================

-- ============================================================
-- COASTAL ZONES
-- High risk of storm surges, cyclonic winds, and tsunami run-up.
-- ============================================================
CREATE TABLE IF NOT EXISTS coastal_zones (
    id            SERIAL PRIMARY KEY,
    zone_name     VARCHAR(255) NOT NULL,
    district      VARCHAR(100) NOT NULL,
    risk_level    VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'moderate', 'high', 'very_high')),
    hazard_type   VARCHAR(50) NOT NULL CHECK (hazard_type IN ('erosion', 'cyclone', 'tsunami')),
    description   TEXT,
    geom          GEOMETRY(Polygon, 4326) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coastal_zones_geom
    ON coastal_zones USING GIST (geom);

-- ============================================================
-- SEISMIC ZONES
-- While all of Kerala is Zone III, specific areas near faults
-- (like Periyar lineament) have varying sensitivity triggers.
-- ============================================================
CREATE TABLE IF NOT EXISTS seismic_zones (
    id            SERIAL PRIMARY KEY,
    zone_name     VARCHAR(255) NOT NULL,
    district      VARCHAR(100) NOT NULL,
    sensitivity   VARCHAR(20) NOT NULL CHECK (sensitivity IN ('moderate', 'high', 'very_high')),
    fault_line    VARCHAR(150),
    description   TEXT,
    geom          GEOMETRY(Polygon, 4326) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seismic_zones_geom
    ON seismic_zones USING GIST (geom);


-- ============================================================
-- SEED DATA
-- ============================================================

-- Coastal Zones
INSERT INTO coastal_zones (zone_name, district, risk_level, hazard_type, description, geom)
VALUES 
  ('Alappad Coastal Strip', 'Kollam', 'catastrophic', 'tsunami', 'Highly vulnerable narrow coastal strip prone to severe wave action and historically devastated by the 2004 Tsunami.', ST_GeomFromText('POLYGON((76.45 9.00, 76.55 9.00, 76.55 9.15, 76.45 9.15, 76.45 9.00))', 4326)),
  ('Chellanam Erosion Zone', 'Ernakulam', 'very_high', 'erosion', 'Severe perennial coastal erosion zone worsened by cyclonic swells and sea-level rise.', ST_GeomFromText('POLYGON((76.25 9.75, 76.30 9.75, 76.30 9.85, 76.25 9.85, 76.25 9.75))', 4326)),
  ('Shangumugham Belt', 'Thiruvananthapuram', 'high', 'erosion', 'Active beach erosion and cyclonic wind shear zone.', ST_GeomFromText('POLYGON((76.88 8.45, 76.95 8.45, 76.95 8.52, 76.88 8.52, 76.88 8.45))', 4326));

-- Seismic Zones (Based on Fault lineaments in Kerala - mostly Zone III but amplified near faults)
INSERT INTO seismic_zones (zone_name, district, sensitivity, fault_line, description, geom)
VALUES
  ('Periyar Lineament', 'Ernakulam', 'high', 'Periyar Fault', 'A major deep-seated fault zone in central Kerala capable of triggering localized tremors. Structures here must strictly adhere to IS 1893:2016.', ST_GeomFromText('POLYGON((76.35 10.05, 76.85 10.05, 76.85 10.25, 76.35 10.25, 76.35 10.05))', 4326)),
  ('Wadakkancherry Fault', 'Thrissur', 'moderate', 'Wadakkancherry Lineament', 'Historical micro-seismic activity recorded along this fault line.', ST_GeomFromText('POLYGON((76.15 10.55, 76.40 10.55, 76.40 10.75, 76.15 10.75, 76.15 10.55))', 4326));

