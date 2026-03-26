# ECHO / Adrishya (Human‑Mesh Bharat)

Disaster communications stack that works with **zero infrastructure** in the blast radius, then progressively “climbs” out of the dead zone using **BLE/Wi‑Fi Direct → LoRa → vehicular DTN → cloud triage**.

This repo is the **no-loss engineering blueprint** plus a **working reference backend** you can run locally (PostGIS + signature verification + ingestion).

## What this is (4-layer Hybrid DTN)

### Layer 1 — Human‑Mesh (zero infrastructure)

- Nodes: Android/iOS phones.
- Links: BLE advertising + BLE GATT (optional), Wi‑Fi Direct (optional for bulk).
- Behavior: Store‑and‑forward “frog‑jump” relay between phones.

### Layer 2 — Static Sentinels (local aggregation)

- Nodes: ESP32 + LoRa (SX127x) on streetlights/roofs/offices.
- Links: BLE scan (from Layer 1) + LoRa TX/RX (865–867 MHz India ISM).
- Behavior: Capture signed SOS from BLE, wrap, transmit via LoRa up to ~10 km rural.

### Layer 3 — Kinetic Data Mules (vehicular DTN)

- Nodes: ESP32 + LoRa + storage on buses/jeeps/trucks.
- Behavior: Vacuum LoRa packets; when internet returns, bulk dump packets to cloud.

### Layer 4 — Command Gateway (cloud + triage)

- Nodes: Cloud service + PostGIS + dashboard.
- Behavior: Verify signatures, dedupe, spatial indexing, heatmaps, CAP alert downlink, **resource allocation** (warehouses → hospitals, robust margins, scenario planning).

## Non‑negotiable constraints

- **Delay tolerant**: delivery can be seconds to tens of minutes.
- **Broadcast‑storm safe**: no infinite rebroadcast.
- **Cryptographically authenticated**: reject spoofed SOS.
- **Works offline-first**: phones + edge nodes must function without DNS/internet.

---

## Resource allocation (Layer 4 triage)

Given ingested SOS + known supply/demand, the backend computes **robust supply routing** across scenarios (e.g., road damage, demand spike, node outage).

See `ALLOCATION.md` for:

- Multi-tier network model (warehouses, hubs, hospitals, shelters, routes).
- Scenario-based planning + human-in-the-loop (HITL) overrides.
- Robust margins + explanations.
- Integration with SOS ingest.

## Three-module architecture

### 1. Communication (DTN + relay)
Layers 1–3: BLE mesh → LoRa sentinels → vehicular DTN. See `MODULES.md`.

### 2. Battery optimization (on-device + cloud-side)
- **On-device**: LoRa CAD duty-cycling (2.9s sleep / 0.1s sniff = 97% power savings), RSSI-based suppression.
- **Cloud-side**: track device power state (CRITICAL/LOW/MEDIUM/GOOD) and deprioritize low-battery nodes in allocation.
- **Flutter endpoints**: `/v1/device/battery/:device_id`, `/v1/optimize/config`, `/v1/stats/battery/record`.

See `FLUTTER_BATTERY_INTEGRATION.md` for full mobile integration guide.

### 3. Resource allocation (supply routing)

**v1 (Legacy)**: Greedy tier-based algorithm for basic scenarios.  
**v2 (Advanced, NEW)**: Linear Programming optimization with multi-scenario planning.

Both versions available concurrently:
- `POST /v1/allocate` — v1 greedy algorithm (unchanged, 10-15ms)
- `POST /v1/allocate/v2` — v2 LP optimization (50-150ms, 20-30% better unmet demand)
- `POST /v1/allocate/compare` — compare both versions

**v2 Features**:
- Multi-scenario robust planning (worst-case analysis)
- Vehicle-aware routing (truck/bike/drone degradation)
- Rolling horizon multi-period planning
- Human-in-the-loop overrides (priorities, forcing)
- 5-minute intelligent caching

**Performance**: v2 reduces unmet demand by 20-30% vs v1. Suitable for complex disaster zones where supply optimization is critical.

See `ALLOCATION_V2.md` for API reference, `ALLOCATION_MIGRATION.md` for gradual rollout plan.

## Mobile (Flutter/Android) Integration

The backend provides **battery-aware APIs** for Flutter apps running on affected-area phones:

**Key endpoints**:
- `GET /v1/device/battery/:device_id` — cloud's view of device battery + recommendations
- `GET /v1/optimize/config?power_state=...` — power-saving parameters (RSSI thresholds, CAD cycles, retention)
- `POST /v1/stats/battery/record` — device sends battery stats for analytics
- `GET /v1/admin/battery-status` — ops dashboard (network-wide battery health)

**Power states**:
- **CRITICAL** (<5%): suppress non-emergency messages; 1h retention
- **LOW** (5–20%): selective forwarding; 24h retention
- **MEDIUM** (20–60%): balanced relay; 3d retention
- **GOOD** (>60%): normal operation; 7d retention

Flutter apps use these endpoints to:
1. Fetch cloud's battery estimation + optimization config
2. Apply CAD sleep/sniff tuning, RSSI thresholds, message suppression locally
3. Send battery stats periodically for dashboard analytics

See `FLUTTER_BATTERY_INTEGRATION.md` for detailed implementation patterns, code examples, and best practices.

---

## Protocol blueprint

## Identifiers and time

- `msg_id`: 16 bytes (UUIDv4 bytes) or 128-bit random.
- `ts_unix_ms`: 8 bytes, unsigned little-endian.
- Coordinates in WGS84.

## SOS payload (binary, v1)

Target: **<= 128 bytes payload** (pre-signature). This is what the phone signs.

```text
SOSPayloadV1 (little-endian)
  version            u8      = 1
  msg_id             [16]u8
  ts_unix_ms         u64
  lat_e7             i32     (latitude * 1e7)
  lon_e7             i32     (longitude * 1e7)
  accuracy_m         u16
  battery_pct        u8      (0..100)
  emergency_code     u8      (enum)
  flags              u16     (bitfield)
  ttl_hops           u8      (decrement per forward)
  reserved           [N]u8   (pad/room for future; keep total payload <= 128)

Signature envelope
  pubkey             [32]u8  (Ed25519 public key)
  signature          [64]u8  (Ed25519 signature over SOSPayloadV1 bytes)

Total typical: payload (~40–80) + pubkey (32) + sig (64) = ~136–176 bytes
```

### Emergency codes (example)

- `1`: trapped / buried
- `2`: medical urgent
- `3`: fire
- `4`: flood
- `5`: other

## Dedupe + replay rules (ALL layers)

- Cache key: `msg_id`.
- Cache retention: at least **24h** (edge), **7d** (cloud) or by policy.
- Drop if already seen.
- Drop if `ttl_hops == 0`.
- Drop if timestamp is wildly out of bounds (cloud can be lenient; edge can ignore).

## Smart gossip + RSSI suppression

Goal: prevent broadcast storms.

When node receives an SOS via BLE or LoRa:

1. If `msg_id` seen → drop.
2. If `RSSI >= RSSI_STRONG_THRESHOLD` (very strong, near-duplicate emitter) → **do not rebroadcast**.
3. Else rebroadcast after randomized jitter `0..JITTER_MS`.

Suggested defaults (tune per field test):

- BLE `RSSI_STRONG_THRESHOLD`: around **-50 dBm**
- LoRa `RSSI_STRONG_THRESHOLD`: around **-60 dBm**
- `JITTER_MS`: 0–500 ms (phones), 0–1500 ms (ESP32)

## LoRa power + CAD (battery)

- Use SX127x **CAD** mode cycle (sleep ~2.9s, sniff ~0.1s) when acting as listener.
- Prefer short packets; batch uplinks from vehicles using HTTP.

## Cryptography (anti-spoof)

- Scheme: **Ed25519**.
- Phone generates keypair locally on first run; private key never leaves device.
- Each SOS is signed over raw `SOSPayloadV1` bytes.
- Backend verifies `(pubkey, payload, signature)`.

Threat model note:

- Captured Layer 2/3 device must not enable forging civilian SOS.
- Backend rejects unsigned/invalid signatures.


---

## Backend blueprint (Command Gateway)

## Responsibilities

- Ingest packet dumps from vehicles/gateways.
- Verify Ed25519 signatures.
- Deduplicate by `msg_id`.
- Store points in PostGIS.
- Provide query endpoints for dashboard/triage.

## API (reference implementation in this repo)

### `POST /v1/ingest/sos`

Accepts JSON with base64 fields (reference-friendly). Production can also support binary.

Request body:

```json
{
  "payload_b64": "...",
  "pubkey_b64": "...",
  "sig_b64": "...",
  "rssi": -73,
  "gateway_id": "KSRTC-JEEP-012",
  "received_at_unix_ms": 1710000000000
}
```

Response:

- `200 { "status": "accepted", "msg_id": "..." }` or
- `400/422` for malformed
- `401` for signature invalid
- `409` for duplicate

### `GET /v1/sos/recent?since=...`

Returns recent SOS points.

## Database (PostgreSQL + PostGIS)

Tables:

- `sos_messages` (one row per `msg_id`)
- optional: `gateways`, `alerts`, `audit_log`

Spatial index:

- `geom` as `geometry(Point, 4326)` with GiST index.


---

## Working reference implementation (in this repo)

This repo includes:

- `backend/`: Express service + PostGIS schema.
- `tools/packetgen/`: generate keys + sign SOS + POST to backend.

## Prerequisites

- Docker Desktop (for PostGIS)
- Node.js 18+ (for backend + tools)

## Quickstart (local)

Ensure Docker Desktop is running (the `docker` daemon must be available).

```zsh
cd backend
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

In another terminal:

```zsh
cd tools/packetgen
npm install
node send_sos.mjs --url http://127.0.0.1:3000 \
  --lat 9.9312 --lon 76.2673 --battery 54 --code 2
```

## Acceptance checks

- Sending the same SOS twice returns `409 duplicate` on second attempt.
- Mutating 1 byte in `payload_b64` causes `401 invalid_signature`.
- DB contains a row in `sos_messages` with correct `geom`.

## Logging & proof

For a step-by-step **cold start** runbook, see `quickstart.md`.

### Backend logs

The backend writes **structured JSON logs to stdout** and also persists them to Postgres in `event_logs`.

Common events:

- `http_request` (method/path/status/duration)
- `sos_accepted` (msg_id + key fields)
- `sos_duplicate`
- `sos_rejected` (`missing_fields` / `invalid_signature`)
- `sos_db_error`

Enable more/less verbosity with `LOG_LEVEL` (`debug|info|warn|error`, default `info`).

DB logging controls:

- `LOG_TO_DB=1` (default) writes to `event_logs`.
- `LOG_DB_LEVEL=info|warn|error` controls what gets stored in DB (defaults to `info`).

To show logs as evidence (queryable, copy/paste friendly):

```zsh
cd backend
npm run logs:show -- --limit 25
```

### Proof script (reproducible)

Run this after starting PostGIS + backend; it prints PASS/FAIL checks you can attach as evidence.

```zsh
cd backend
npm run proof
```

The proof output includes an `EVIDENCE event_logs` section (when running locally).

It verifies:

- `/healthz` returns `ok:true`
- valid ingest → `200 accepted`
- replay → `409 duplicate`
- tampered payload → `401 invalid_signature`
- `/v1/sos/recent` returns at least one item


---

## Engineering deliverables (who builds what)

### Firmware (ESP32 + SX127x)

- FreeRTOS tasks:
  - BLE scan + parse envelope
  - LoRa CAD listen + RX
  - Dedupe cache (LRU) + TTL/hop decrement
  - LoRa TX scheduler (jitter)
  - Power manager (deep sleep)

### Mobile SDK

- Background BLE advertise/scan strategy per platform constraints.
- Local store of outbound/inbound message IDs.
- Keypair management + signing.

### Ops / Deployment

- Pre-provision gateway IDs, rotate keys for gateways (not civilians).
- PostGIS tuned for spatial queries; dashboards use cached tiles/queries.

---

## Repo status

- `backend/`: Express ingest API + PostGIS schema + migration script
- `tools/packetgen/`: generate + sign SOS packets and POST to the backend
