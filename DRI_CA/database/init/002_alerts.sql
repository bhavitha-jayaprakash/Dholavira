-- ============================================================
-- DRI & CA — Migration 002: Community Alerts Table
-- ============================================================
-- Run after 001_schema.sql:
--   psql -U postgres -d dri_db -f 002_alerts.sql
-- ============================================================

-- ============================================================
-- COMMUNITY ALERTS
-- Crowd-sourced disaster alerts reported by community members.
-- Supports filtering by type, district, and severity.
-- Includes verification workflow for trusted reporting.
-- ============================================================
CREATE TABLE IF NOT EXISTS community_alerts (
    id            SERIAL PRIMARY KEY,
    title         VARCHAR(200) NOT NULL,
    description   TEXT NOT NULL,
    alert_type    VARCHAR(30) NOT NULL CHECK (alert_type IN (
                    'flood', 'landslide', 'heavy_rain', 'dam_release',
                    'road_block', 'evacuation', 'relief_camp', 'general'
                  )),
    severity      VARCHAR(20) NOT NULL CHECK (severity IN (
                    'info', 'advisory', 'warning', 'critical'
                  )),
    district      VARCHAR(100) NOT NULL,
    latitude      DECIMAL(10, 7),
    longitude     DECIMAL(10, 7),
    reported_by   VARCHAR(100) DEFAULT 'anonymous',
    is_active     BOOLEAN DEFAULT true,
    is_verified   BOOLEAN DEFAULT false,
    verified_at   TIMESTAMP,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for common filter patterns
CREATE INDEX IF NOT EXISTS idx_alerts_active
    ON community_alerts (is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_district
    ON community_alerts (district) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_alerts_type
    ON community_alerts (alert_type) WHERE is_active = true;

-- ============================================================
-- SEED ALERTS — Sample data for testing
-- ============================================================

INSERT INTO community_alerts (title, description, alert_type, severity, district, latitude, longitude, reported_by, is_verified)
VALUES
  (
    'Heavy rainfall warning for Wayanad district',
    'IMD has issued an Orange alert for Wayanad. Expected rainfall of 115-204mm in 24 hours. Residents in hilly areas should stay alert for landslide warning signs.',
    'heavy_rain', 'warning', 'Wayanad', 11.6050, 76.2700,
    'KSDMA Official', true
  ),
  (
    'Road blocked near Munnar — debris on SH17',
    'Debris flow has blocked State Highway 17 near the Munnar-Devikulam stretch. Alternate route via Adimali available. KSRTC buses diverted.',
    'road_block', 'advisory', 'Idukki', 10.0889, 77.0595,
    'community_reporter', false
  ),
  (
    'Relief camp open at Government School Aluva',
    'Emergency relief camp operational at Government Higher Secondary School, Aluva. Capacity: 500 people. Providing food, drinking water, and medical aid. Contact: 0484-2624800.',
    'relief_camp', 'info', 'Ernakulam', 10.1004, 76.3570,
    'District Collector Office', true
  ),
  (
    'Periyar River water level rising — Idamalayar dam release imminent',
    'Water level at Idamalayar dam has reached 169m against full capacity of 169.5m. Controlled release expected within 6 hours. Low-lying areas along Periyar River should prepare for evacuation.',
    'dam_release', 'critical', 'Ernakulam', 10.1157, 76.7000,
    'KSEB Dam Safety', true
  );
