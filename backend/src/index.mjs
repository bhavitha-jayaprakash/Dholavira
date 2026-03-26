import express from 'express';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

import { createDbPool } from './db.mjs';
import { parseSosPayloadV1 } from './sosPayloadV1.mjs';
import { verifyEd25519 } from './ed25519.mjs';
import { createLogger } from './logger.mjs';

dotenv.config();

const app = express();
app.use(express.json({ limit: '256kb' }));

const pool = createDbPool();
const logger = createLogger({ pool });

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
    res.json({ ok: result.rows?.[0]?.ok === 1 });
  } catch (err) {
    await logger.error({ event: 'healthz_error', error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
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

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`echo backend listening on http://localhost:${port}`);
});
