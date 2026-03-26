import express from 'express';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

import { createDbPool } from './db.mjs';
import { parseSosPayloadV1 } from './sosPayloadV1.mjs';
import { verifyEd25519 } from './ed25519.mjs';
import { createLogger } from './logger.mjs';
import { BatteryOptimizationManager } from './batteryManager.mjs';
import allocationV2 from './allocationWrapper.mjs';

dotenv.config();

const app = express();
app.use(express.json({ limit: '256kb' }));

const pool = createDbPool();
const logger = createLogger({ pool });
const batteryMgr = new BatteryOptimizationManager(pool);

app.use((req, res, next) => {
  const reqId = crypto.randomUUID();
  req.reqId = reqId;
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1e6;
    void logger.info({
      event: 'http_request',
      req_id: reqId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Math.round(ms * 10) / 10,
    });
  });

  next();
});

app.get('/healthz', async (_req, res) => {
  try {
    const result = await pool.query('SELECT 1 AS ok');
    res.json({
      ok: result.rows?.[0]?.ok === 1,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    await logger.error({ event: 'healthz_error', error: String(err) });
    res.status(500).json({ ok: false, error: String(err), timestamp: new Date().toISOString() });
  }
});

app.post('/v1/ingest/sos', async (req, res) => {
  const {
    payload_b64,
    pubkey_b64,
    sig_b64,
    rssi = null,
    gateway_id = null,
    received_at_unix_ms = null,
  } = req.body ?? {};

  if (typeof payload_b64 !== 'string' || typeof pubkey_b64 !== 'string' || typeof sig_b64 !== 'string') {
    await logger.warn({
      event: 'sos_rejected',
      reason: 'missing_fields',
      req_id: req.reqId,
    });
    return res.status(422).json({ error: 'missing_fields', details: 'payload_b64, pubkey_b64, sig_b64 are required strings' });
  }

  let payload;
  let pubkey;
  let signature;
  try {
    payload = Buffer.from(payload_b64, 'base64');
    pubkey = Buffer.from(pubkey_b64, 'base64');
    signature = Buffer.from(sig_b64, 'base64');
  } catch (err) {
    await logger.warn({
      event: 'sos_rejected',
      reason: 'invalid_base64',
      req_id: req.reqId,
      gateway_id,
      rssi,
      error: String(err),
    });
    return res.status(422).json({ error: 'invalid_base64', details: String(err) });
  }

  const verified = verifyEd25519({ payload, pubkey, signature });
  if (!verified) {
    await logger.warn({
      event: 'sos_rejected',
      reason: 'invalid_signature',
      req_id: req.reqId,
      gateway_id,
      rssi,
    });
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let decoded;
  try {
    decoded = parseSosPayloadV1(payload);
  } catch (err) {
    await logger.warn({
      event: 'sos_rejected',
      reason: 'invalid_payload',
      req_id: req.reqId,
      gateway_id,
      rssi,
      error: String(err),
    });
    return res.status(422).json({ error: 'invalid_payload', details: String(err) });
  }

  const receivedAt =
    typeof received_at_unix_ms === 'number' && Number.isFinite(received_at_unix_ms)
      ? new Date(received_at_unix_ms)
      : new Date();

  try {
    const insert = await pool.query(
      `INSERT INTO sos_messages (
        msg_id_hex, version, ts_unix_ms, lat_e7, lon_e7, accuracy_m, battery_pct, emergency_code, flags, ttl_hops,
        pubkey, signature, payload, gateway_id, rssi, received_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16
      )
      ON CONFLICT (msg_id_hex) DO NOTHING
      RETURNING msg_id_hex`,
      [
        decoded.msgIdHex,
        decoded.version,
        decoded.tsUnixMs,
        decoded.latE7,
        decoded.lonE7,
        decoded.accuracyM,
        decoded.batteryPct,
        decoded.emergencyCode,
        decoded.flags,
        decoded.ttlHops,
        pubkey,
        signature,
        payload,
        gateway_id,
        rssi,
        receivedAt,
      ]
    );

    if (insert.rowCount === 0) {
      await logger.info({
        event: 'sos_duplicate',
        req_id: req.reqId,
        msg_id: decoded.msgIdHex,
        gateway_id,
        rssi,
      });
      return res.status(409).json({ error: 'duplicate', msg_id: decoded.msgIdHex });
    }

    // Track device battery state (using pubkey as device_id)
    const deviceId = pubkey_b64;
    if (decoded.batteryPct !== null && typeof decoded.batteryPct === 'number') {
      void batteryMgr.updateDeviceBatteryState(deviceId, decoded.batteryPct, decoded.msgIdHex);
    }

    await logger.info({
      event: 'sos_accepted',
      req_id: req.reqId,
      msg_id: decoded.msgIdHex,
      lat_e7: decoded.latE7,
      lon_e7: decoded.lonE7,
      emergency_code: decoded.emergencyCode,
      battery_pct: decoded.batteryPct,
      gateway_id,
      rssi,
    });
    return res.json({ status: 'accepted', msg_id: decoded.msgIdHex });
  } catch (err) {
    await logger.error({
      event: 'sos_db_error',
      req_id: req.reqId,
      error: String(err),
    });
    return res.status(500).json({ error: 'db_error', details: String(err) });
  }
});

app.get('/v1/sos/recent', async (req, res) => {
  const since = typeof req.query.since === 'string' ? Number(req.query.since) : null;
  const sinceMs = Number.isFinite(since) ? since : null;

  try {
    const result = await pool.query(
      `SELECT
        msg_id_hex,
        ts_unix_ms,
        lat_e7,
        lon_e7,
        accuracy_m,
        battery_pct,
        emergency_code,
        flags,
        ttl_hops,
        gateway_id,
        rssi,
        EXTRACT(EPOCH FROM received_at) * 1000 AS received_at_unix_ms
      FROM sos_messages
      WHERE ($1::bigint IS NULL OR ts_unix_ms >= $1)
      ORDER BY received_at DESC
      LIMIT 500`,
      [sinceMs]
    );

    res.json({ items: result.rows });
  } catch (err) {
    await logger.error({ event: 'recent_db_error', req_id: req.reqId, error: String(err) });
    res.status(500).json({ error: 'db_error', details: String(err) });
  }
});

// === Flutter/Mobile Device Battery Endpoints ===

/**
 * GET /v1/device/battery/:device_id
 * 
 * Return cloud's view of device battery state + recommendations.
 * device_id is base64-encoded pubkey.
 */
app.get('/v1/device/battery/:device_id', async (req, res) => {
  const { device_id } = req.params;

  if (!device_id || typeof device_id !== 'string') {
    return res.status(422).json({ error: 'invalid_device_id' });
  }

  try {
    const state = await batteryMgr.getDeviceBatteryState(device_id);

    if (!state) {
      // Device has never sent an SOS; return default good state
      return res.json({
        device_id,
        battery_pct: 100,
        power_state: 'GOOD',
        suppression_recommended: false,
        retention_sec: 604800,
        last_seen_ts: null,
        config: batteryMgr.getOptimizationConfig('GOOD')
      });
    }

    res.json({
      device_id,
      battery_pct: state.battery_pct,
      power_state: state.power_state,
      suppression_recommended: state.should_suppress_rebroadcast,
      retention_sec: state.recommended_message_retention_sec,
      last_seen_ts: state.last_seen_ts ? new Date(state.last_seen_ts).toISOString() : null,
      config: batteryMgr.getOptimizationConfig(state.power_state)
    });
  } catch (err) {
    await logger.error({
      event: 'battery_state_error',
      req_id: req.reqId,
      device_id,
      error: String(err)
    });
    res.status(500).json({ error: 'db_error', details: String(err) });
  }
});

/**
 * GET /v1/optimize/config
 * 
 * Return battery optimization config (for Flutter apps to apply locally).
 * Optional query param: ?power_state=GOOD|MEDIUM|LOW|CRITICAL
 */
app.get('/v1/optimize/config', async (req, res) => {
  const powerState = req.query.power_state ?? 'GOOD';

  const validStates = ['GOOD', 'MEDIUM', 'LOW', 'CRITICAL'];
  if (!validStates.includes(powerState)) {
    return res.status(422).json({ error: 'invalid_power_state', valid_states: validStates });
  }

  try {
    const config = batteryMgr.getOptimizationConfig(powerState);
    res.json({
      power_state: powerState,
      config,
      description: 'Battery optimization parameters for local device filtering and relay.'
    });
  } catch (err) {
    await logger.error({
      event: 'optimize_config_error',
      req_id: req.reqId,
      power_state: req.query.power_state,
      error: String(err)
    });
    res.status(500).json({ error: 'error', details: String(err) });
  }
});

/**
 * GET /v1/stats/battery?device_id=...&hours=24
 * 
 * Return battery optimization stats for a device (analytics dashboard).
 */
app.get('/v1/stats/battery', async (req, res) => {
  const deviceId = req.query.device_id;
  const hoursBack = typeof req.query.hours === 'string' ? Number(req.query.hours) : 24;

  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(422).json({ error: 'device_id is required' });
  }

  if (!Number.isFinite(hoursBack) || hoursBack < 1 || hoursBack > 720) {
    return res.status(422).json({ error: 'hours must be 1-720' });
  }

  try {
    const stats = await batteryMgr.getDeviceStats(deviceId, hoursBack);
    res.json({
      device_id: deviceId,
      hours_back: hoursBack,
      sample_count: stats.length,
      stats
    });
  } catch (err) {
    await logger.error({
      event: 'battery_stats_error',
      req_id: req.reqId,
      device_id: deviceId,
      hours: hoursBack,
      error: String(err)
    });
    res.status(500).json({ error: 'db_error', details: String(err) });
  }
});

/**
 * GET /v1/admin/battery-status
 * 
 * Return network-wide battery status (ops dashboard).
 */
app.get('/v1/admin/battery-status', async (req, res) => {
  try {
    const status = await batteryMgr.getNetworkBatteryStatus();
    res.json({
      at: new Date().toISOString(),
      status
    });
  } catch (err) {
    await logger.error({
      event: 'battery_status_error',
      req_id: req.reqId,
      error: String(err)
    });
    res.status(500).json({ error: 'db_error', details: String(err) });
  }
});

/**
 * POST /v1/stats/battery/record
 * 
 * Device sends battery stats to cloud for persistence + analytics.
 * Body: { device_id, battery_pct, messages_suppressed, messages_forwarded, power_saved_pct }
 */
app.post('/v1/stats/battery/record', async (req, res) => {
  const { device_id, battery_pct, messages_suppressed, messages_forwarded, power_saved_pct } = req.body ?? {};

  if (!device_id || typeof battery_pct !== 'number') {
    return res.status(422).json({ error: 'device_id and battery_pct are required' });
  }

  const msgSuppressed = typeof messages_suppressed === 'number' ? messages_suppressed : 0;
  const msgForwarded = typeof messages_forwarded === 'number' ? messages_forwarded : 0;
  const powerSaved = typeof power_saved_pct === 'number' ? power_saved_pct : 0;

  try {
    await batteryMgr.recordBatteryStats(device_id, battery_pct, msgSuppressed, msgForwarded, powerSaved);
    await logger.info({
      event: 'battery_stats_recorded',
      req_id: req.reqId,
      device_id,
      battery_pct,
      messages_suppressed: msgSuppressed,
      messages_forwarded: msgForwarded,
      power_saved_pct: powerSaved
    });
    res.json({ status: 'recorded' });
  } catch (err) {
    await logger.error({
      event: 'battery_stats_record_error',
      req_id: req.reqId,
      device_id,
      error: String(err)
    });
    res.status(500).json({ error: 'db_error', details: String(err) });
  }
});

/**
 * Allocation v2 Endpoints
 * POST /v1/allocate/v2 - Run advanced allocation
 * POST /v1/allocate/compare - Compare v1 vs v2 results
 */

app.post('/v1/allocate/v2', async (req, res) => {
  try {
    const { nodes, edges, scenarios, mode = 'static', rolling_steps = 1, hitl_overrides } = req.body;
    
    if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(scenarios)) {
      await logger.warn({
        event: 'allocate_v2_rejected',
        reason: 'missing_fields',
        req_id: req.reqId
      });
      return res.status(422).json({ error: 'missing_fields', details: 'nodes, edges, scenarios arrays required' });
    }

    const result = await allocationV2.allocate({
      nodes,
      edges,
      scenarios,
      mode,
      rolling_steps,
      hitl_overrides
    });

    await logger.info({
      event: 'allocate_v2_success',
      req_id: req.reqId,
      flows: result.flows?.length || 0,
      scenarios: scenarios.length,
      mode
    });

    res.json({
      version: 'v2',
      status: 'success',
      ...result,
      _metadata: {
        timestamp: new Date().toISOString(),
        mode,
        req_id: req.reqId
      }
    });
  } catch (err) {
    await logger.error({
      event: 'allocate_v2_error',
      req_id: req.reqId,
      error: String(err)
    });
    res.status(500).json({
      version: 'v2',
      status: 'error',
      error: String(err),
      flows: [],
      active_nodes: [],
      critical_routes: [],
      unmet_demand: [],
      explanations: [],
      robust_margin: {}
    });
  }
});

app.post('/v1/allocate/compare', async (req, res) => {
  try {
    const { nodes, edges, scenarios, rolling_steps = 1, hitl_overrides } = req.body;
    
    if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(scenarios)) {
      await logger.warn({
        event: 'allocate_compare_rejected',
        reason: 'missing_fields',
        req_id: req.reqId
      });
      return res.status(422).json({ error: 'missing_fields', details: 'nodes, edges, scenarios arrays required' });
    }

    // Get v2 result
    const v2Result = await allocationV2.allocate({
      nodes,
      edges,
      scenarios,
      mode: 'static',
      rolling_steps,
      hitl_overrides
    });

    // Get v1 result for comparison (from legacy allocator if available)
    // For now, we'll just note that v1 comparison would go here
    const comparison = allocationV2.compareResults(
      { flows: [], active_nodes: [], unmet_demand: {}, critical_routes: [] },
      v2Result
    );

    await logger.info({
      event: 'allocate_compare_success',
      req_id: req.reqId,
      v2_flows: v2Result.flows?.length || 0,
      recommendation: comparison.recommendation
    });

    res.json({
      version: 'comparison',
      status: 'success',
      v2_result: v2Result,
      comparison_metrics: comparison,
      _metadata: {
        timestamp: new Date().toISOString(),
        req_id: req.reqId
      }
    });
  } catch (err) {
    await logger.error({
      event: 'allocate_compare_error',
      req_id: req.reqId,
      error: String(err)
    });
    res.status(500).json({
      version: 'comparison',
      status: 'error',
      error: String(err),
      v2_result: {},
      comparison_metrics: {}
    });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`echo backend listening on http://localhost:${port}`);
});
