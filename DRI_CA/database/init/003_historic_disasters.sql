-- ============================================================
-- DRI & CA — Migration 003: Historic Disasters
-- ============================================================
-- Maps major past catastrophic events (epicenter coordinates)
-- to provide contextual proximity warnings to users.
-- ============================================================

CREATE TABLE IF NOT EXISTS historic_disasters (
    id            SERIAL PRIMARY KEY,
    event_name    VARCHAR(200) NOT NULL,
    disaster_type VARCHAR(50) NOT NULL CHECK (disaster_type IN ('flood', 'landslide', 'cyclone', 'earthquake', 'tsunami')),
    event_year    INTEGER NOT NULL,
    district      VARCHAR(100) NOT NULL,
    severity      VARCHAR(20) NOT NULL CHECK (severity IN ('moderate', 'high', 'very_high', 'catastrophic')),
    description   TEXT,
    geom          GEOMETRY(Point, 4326) NOT NULL,
    fatality_est  INTEGER,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_historic_disasters_geom
    ON historic_disasters USING GIST (geom);

-- ============================================================
-- SEED DATA — Major historic markers
-- ============================================================

INSERT INTO historic_disasters (event_name, disaster_type, event_year, district, severity, description, fatality_est, geom)
VALUES
  -- 2018 Great Floods Epicenters
  ('2018 Great Flood: Ranni Inundation', 'flood', 2018, 'Pathanamthitta', 'catastrophic', 'Massive inundation along the Pamba river basin due to dam releases.', 40, ST_SetSRID(ST_MakePoint(76.78, 9.38), 4326)),
  ('2018 Great Flood: Chalakudy Submergence', 'flood', 2018, 'Thrissur', 'catastrophic', 'Chalakudy town completely submerged by raging waters from Peringalkuthu dam.', 35, ST_SetSRID(ST_MakePoint(76.33, 10.30), 4326)),
  ('2018 Great Flood: Aluva Deluge', 'flood', 2018, 'Ernakulam', 'catastrophic', 'Aluva town submerged with flood levels exceeding first floors due to Periyar river overflow.', 50, ST_SetSRID(ST_MakePoint(76.35, 10.11), 4326)),

  -- Landslides
  ('2020 Pettimudi Landslide', 'landslide', 2020, 'Idukki', 'catastrophic', 'Massive debris flow buried a tea plantation workers settlement in Rajamala.', 70, ST_SetSRID(ST_MakePoint(77.01, 10.16), 4326)),
  ('2019 Kavalappara Landslide', 'landslide', 2019, 'Malappuram', 'catastrophic', 'Hill collapse buried an entire village under 50 feet of debris during torrential monsoon.', 59, ST_SetSRID(ST_MakePoint(76.15, 11.33), 4326)),
  ('2019 Puthumala Landslide', 'landslide', 2019, 'Wayanad', 'catastrophic', 'Massive earth flow wiped out tea plantation and mosque.', 17, ST_SetSRID(ST_MakePoint(76.10, 11.53), 4326)),
  ('2001 Amboori Landslide', 'landslide', 2001, 'Thiruvananthapuram', 'high', 'One of the worst landslides in southern Kerala covering residential areas.', 39, ST_SetSRID(ST_MakePoint(77.16, 8.52), 4326)),
  ('1924 Munnar Deluge', 'landslide', 1924, 'Idukki', 'catastrophic', 'The Great Flood of 99 wholly wiped out the old Munnar settlement via debris flows.', 100, ST_SetSRID(ST_MakePoint(77.06, 10.08), 4326)),
  
  -- Cyclones & Tsunami
  ('2017 Cyclone Ockhi Epicenter (Coastal Hit)', 'cyclone', 2017, 'Thiruvananthapuram', 'very_high', 'Severe cyclone hitting southern coast line primarily affecting fishermen community.', 200, ST_SetSRID(ST_MakePoint(76.92, 8.38), 4326)),
  ('2004 Indian Ocean Tsunami - Karunagappally', 'tsunami', 2004, 'Kollam', 'catastrophic', 'Tsunami wave run-up of up to 4 meters devastated coastal villages in Alappad and Azheekkal.', 131, ST_SetSRID(ST_MakePoint(76.51, 9.06), 4326));
