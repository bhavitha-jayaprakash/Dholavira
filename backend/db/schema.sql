CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS sos_messages (
  msg_id_hex TEXT PRIMARY KEY,
  version SMALLINT NOT NULL,
  ts_unix_ms BIGINT NOT NULL,
  lat_e7 INTEGER NOT NULL,
  lon_e7 INTEGER NOT NULL,
  accuracy_m INTEGER,
  battery_pct SMALLINT,
  emergency_code SMALLINT,
  flags INTEGER,
  ttl_hops SMALLINT,

  pubkey BYTEA NOT NULL,
  signature BYTEA NOT NULL,
  payload BYTEA NOT NULL,

  gateway_id TEXT,
  rssi INTEGER,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  geom geometry(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(
      ST_MakePoint(lon_e7 / 10000000.0, lat_e7 / 10000000.0),
      4326
    )
  ) STORED
);

CREATE INDEX IF NOT EXISTS sos_messages_geom_gix ON sos_messages USING GIST (geom);
CREATE INDEX IF NOT EXISTS sos_messages_received_at_idx ON sos_messages (received_at DESC);

CREATE TABLE IF NOT EXISTS event_logs (
  event_id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL,
  event TEXT NOT NULL,

  req_id TEXT,
  msg_id_hex TEXT,

  http_method TEXT,
  http_path TEXT,
  http_status INTEGER,
  duration_ms REAL,

  gateway_id TEXT,
  rssi INTEGER,

  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS event_logs_ts_idx ON event_logs (ts DESC);
CREATE INDEX IF NOT EXISTS event_logs_event_idx ON event_logs (event);
CREATE INDEX IF NOT EXISTS event_logs_req_id_idx ON event_logs (req_id);
CREATE INDEX IF NOT EXISTS event_logs_msg_id_hex_idx ON event_logs (msg_id_hex);

CREATE TABLE IF NOT EXISTS device_battery_state (
  device_id TEXT PRIMARY KEY,
  battery_pct SMALLINT NOT NULL,
  power_state TEXT NOT NULL,  -- CRITICAL, LOW, MEDIUM, GOOD
  last_seen_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sos_msg_id TEXT,
  
  -- Cloud's view of device optimization
  should_suppress_rebroadcast BOOLEAN DEFAULT FALSE,
  recommended_message_retention_sec INTEGER DEFAULT 604800  -- 7 days
);

CREATE INDEX IF NOT EXISTS device_battery_state_last_seen_idx ON device_battery_state (last_seen_ts DESC);
CREATE INDEX IF NOT EXISTS device_battery_state_power_state_idx ON device_battery_state (power_state);

CREATE TABLE IF NOT EXISTS battery_optimization_stats (
  stat_id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  battery_pct SMALLINT,
  power_state TEXT,
  messages_suppressed INTEGER DEFAULT 0,
  messages_forwarded INTEGER DEFAULT 0,
  lora_cad_cycles_completed INTEGER DEFAULT 0,
  estimated_power_saved_pct REAL,  -- vs always-listening
  
  details JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS battery_optimization_stats_device_idx ON battery_optimization_stats (device_id);
CREATE INDEX IF NOT EXISTS battery_optimization_stats_ts_idx ON battery_optimization_stats (ts DESC);

