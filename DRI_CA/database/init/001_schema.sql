-- ============================================================
-- DRI & CA — Database Schema
-- Disaster Resilience Intelligence & Community Awareness
-- ============================================================
-- Run against a local PostgreSQL instance with PostGIS installed:
--   psql -U postgres -f 001_schema.sql
-- ============================================================

-- 1. Create the database (run separately if needed)
-- CREATE DATABASE dri_db;
-- \c dri_db;

-- 2. Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- FLOOD ZONES
-- Stores polygonal flood hazard areas with risk metadata.
-- Source reference: KSDMA flood probability raster data,
-- converted to vector polygons for query purposes.
-- ============================================================
CREATE TABLE IF NOT EXISTS flood_zones (
    id            SERIAL PRIMARY KEY,
    zone_name     VARCHAR(255) NOT NULL,
    district      VARCHAR(100) NOT NULL,
    risk_level    VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'moderate', 'high', 'very_high')),
    return_period INTEGER,                    -- Flood return period in years (10, 25, 50, 100, 200, 500)
    description   TEXT,
    geom          GEOMETRY(Polygon, 4326) NOT NULL,  -- WGS84 coordinate system
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Spatial index for fast intersection queries
CREATE INDEX IF NOT EXISTS idx_flood_zones_geom
    ON flood_zones USING GIST (geom);

-- ============================================================
-- LANDSLIDE ZONES
-- Stores polygonal landslide susceptibility areas.
-- Source reference: NCESS / GSI susceptibility maps
-- for the Western Ghats region.
-- ============================================================
CREATE TABLE IF NOT EXISTS landslide_zones (
    id                   SERIAL PRIMARY KEY,
    zone_name            VARCHAR(255) NOT NULL,
    district             VARCHAR(100) NOT NULL,
    susceptibility_level VARCHAR(20) NOT NULL CHECK (susceptibility_level IN ('low', 'moderate', 'high', 'very_high')),
    soil_type            VARCHAR(100),          -- e.g., 'laterite', 'alluvial', 'rocky'
    slope_gradient       DECIMAL(5, 2),         -- Slope angle in degrees
    description          TEXT,
    geom                 GEOMETRY(Polygon, 4326) NOT NULL,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_landslide_zones_geom
    ON landslide_zones USING GIST (geom);

-- ============================================================
-- FEASIBILITY CHECKS
-- Audit log of every user feasibility query and its result.
-- ============================================================
CREATE TABLE IF NOT EXISTS feasibility_checks (
    id              SERIAL PRIMARY KEY,
    latitude        DECIMAL(10, 7) NOT NULL,
    longitude       DECIMAL(10, 7) NOT NULL,
    building_type   VARCHAR(50) NOT NULL,
    flood_risk      JSONB,                     -- Array of matched flood zones
    landslide_risk  JSONB,                     -- Array of matched landslide zones
    overall_risk    VARCHAR(20),               -- Computed overall risk level
    checked_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SEED DATA
-- Sample polygons covering real areas in Kerala for testing.
-- These approximate actual high-risk zones in Idukki,
-- Wayanad, Ernakulam, and Alappuzha districts.
-- ============================================================

-- Flood zone: Aluva-Perumbavoor corridor (Ernakulam district)
-- This area was severely inundated during the 2018 floods.
INSERT INTO flood_zones (zone_name, district, risk_level, return_period, description, geom)
VALUES (
    'Aluva-Perumbavoor Flood Plain',
    'Ernakulam',
    'high',
    25,
    'Low-lying corridor along the Periyar River. Experienced severe inundation in 2018 floods with depths exceeding 3 meters.',
    ST_GeomFromText('POLYGON((76.33 10.05, 76.45 10.05, 76.45 10.15, 76.33 10.15, 76.33 10.05))', 4326)
);

-- Flood zone: Kuttanad below-sea-level region (Alappuzha district)
INSERT INTO flood_zones (zone_name, district, risk_level, return_period, description, geom)
VALUES (
    'Kuttanad Wetland Basin',
    'Alappuzha',
    'very_high',
    10,
    'Unique below-sea-level agricultural region. Chronically flood-prone with 10-year return period risk. Critical for stilt foundation requirements.',
    ST_GeomFromText('POLYGON((76.30 9.35, 76.50 9.35, 76.50 9.55, 76.30 9.55, 76.30 9.35))', 4326)
);

-- Flood zone: Chalakudy River corridor
INSERT INTO flood_zones (zone_name, district, risk_level, return_period, description, geom)
VALUES (
    'Chalakudy River Flood Zone',
    'Thrissur',
    'moderate',
    50,
    'Moderate risk flood zone along the Chalakudy River. Periodic flooding during heavy monsoon years.',
    ST_GeomFromText('POLYGON((76.25 10.28, 76.40 10.28, 76.40 10.38, 76.25 10.38, 76.25 10.28))', 4326)
);

-- Landslide zone: Munnar hill slopes (Idukki district)
INSERT INTO landslide_zones (zone_name, district, susceptibility_level, soil_type, slope_gradient, description, geom)
VALUES (
    'Munnar Western Slopes',
    'Idukki',
    'very_high',
    'laterite',
    35.00,
    'Steep laterite slopes with history of debris flows. The 1924 floods completely destroyed old Munnar settlement. Active IoT monitoring by Amrita University since 2009.',
    ST_GeomFromText('POLYGON((77.00 10.05, 77.12 10.05, 77.12 10.12, 77.00 10.12, 77.00 10.05))', 4326)
);

-- Landslide zone: Wayanad hill district
INSERT INTO landslide_zones (zone_name, district, susceptibility_level, soil_type, slope_gradient, description, geom)
VALUES (
    'Wayanad Chooralmala Slopes',
    'Wayanad',
    'high',
    'laterite',
    28.50,
    'High susceptibility zone in the Western Ghats. Heavily weathered laterite over crystalline bedrock. Multiple fatal landslides recorded in recent monsoon seasons.',
    ST_GeomFromText('POLYGON((76.20 11.55, 76.35 11.55, 76.35 11.68, 76.20 11.68, 76.20 11.55))', 4326)
);

-- Landslide zone: Idukki highlands
INSERT INTO landslide_zones (zone_name, district, susceptibility_level, soil_type, slope_gradient, description, geom)
VALUES (
    'Idukki Dam Periphery Slopes',
    'Idukki',
    'high',
    'rocky',
    32.00,
    'Steep terrain surrounding Idukki reservoir. Risk compounded by dam spillway releases during extreme rainfall events.',
    ST_GeomFromText('POLYGON((76.92 9.82, 77.02 9.82, 77.02 9.90, 76.92 9.90, 76.92 9.82))', 4326)
);

-- ============================================================
-- VERIFICATION QUERY (run after seeding to confirm setup)
-- ============================================================
-- SELECT 'flood_zones' AS tbl, COUNT(*) FROM flood_zones
-- UNION ALL
-- SELECT 'landslide_zones', COUNT(*) FROM landslide_zones;
