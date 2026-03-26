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
