import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import nacl from 'tweetnacl';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const explicitUrl = process.env.ECHO_URL ? String(process.env.ECHO_URL) : null;
const baseUrl = (explicitUrl ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const autoStart = explicitUrl ? false : (process.env.ECHO_PROOF_SPAWN_BACKEND ?? '1') !== '0';

function ok(name, details = '') {
  console.log(`PASS ${name}${details ? ` - ${details}` : ''}`);
}

function fail(name, details = '') {
  console.error(`FAIL ${name}${details ? ` - ${details}` : ''}`);
  process.exitCode = 1;
}

function note(msg) {
  console.log(`NOTE ${msg}`);
}

function buildSosPayloadV1({ msgId, tsUnixMs, lat, lon, accuracyM, batteryPct, emergencyCode, flags, ttlHops }) {
  const buf = Buffer.alloc(40);
  buf.writeUInt8(1, 0);
  msgId.copy(buf, 1);
  buf.writeBigUInt64LE(BigInt(tsUnixMs), 17);
  buf.writeInt32LE(Math.round(lat * 1e7), 25);
  buf.writeInt32LE(Math.round(lon * 1e7), 29);
  buf.writeUInt16LE(clampInt(accuracyM, 0, 65535), 33);
  buf.writeUInt8(clampInt(batteryPct, 0, 100), 35);
  buf.writeUInt8(clampInt(emergencyCode, 0, 255), 36);
  buf.writeUInt16LE(clampInt(flags, 0, 65535), 37);
  buf.writeUInt8(clampInt(ttlHops, 0, 255), 39);
  return buf;
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

async function httpJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { res, text, json };
}

async function tryHealth(url) {
  try {
    const { res, json, text } = await httpJson(`${url}/healthz`);
    return { ok: res.status === 200 && json?.ok === true, status: res.status, json, text };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function isPortFree(port, host = '127.0.0.1') {
  return await new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findFreePort(startPort = 3000, host = '127.0.0.1', maxTries = 50) {
  for (let p = startPort; p < startPort + maxTries; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p, host)) return p;
  }
  throw new Error(`no free port found in range ${startPort}-${startPort + maxTries - 1}`);
}

function spawnBackend(port) {
  const backendEntrypoint = path.resolve(__dirname, '..', 'src', 'index.mjs');
  const child = spawn(process.execPath, [backendEntrypoint], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
    },
  });
  return child;
}

async function waitForHealthy(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const health = await tryHealth(url);
    if (health.ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function runChecks(url) {
  let msgIdHex = null;

  // 1) Health
  const health = await tryHealth(url);
  if (health.ok) {
    ok('healthz', 'ok:true');
  } else {
    fail('healthz', health.error ? String(health.error) : `status=${health.status} body=${health.text}`);
    return;
  }

  // 2) Valid ingest then duplicate
  const keypair = nacl.sign.keyPair();
  const msgId = crypto.randomBytes(16);
  const tsUnixMs = Date.now();

  const payload = buildSosPayloadV1({
    msgId,
    tsUnixMs,
    lat: 9.9312,
    lon: 76.2673,
    accuracyM: 25,
    batteryPct: 54,
    emergencyCode: 2,
    flags: 0,
    ttlHops: 16,
  });

  const signature = Buffer.from(nacl.sign.detached(new Uint8Array(payload), keypair.secretKey));
  const pubkey = Buffer.from(keypair.publicKey);

  const baseBody = {
    payload_b64: payload.toString('base64'),
    pubkey_b64: pubkey.toString('base64'),
    sig_b64: signature.toString('base64'),
    rssi: -70,
    gateway_id: 'PROOF-GW-1',
    received_at_unix_ms: tsUnixMs,
  };

  const first = await httpJson(`${url}/v1/ingest/sos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(baseBody),
  });

  if (first.res.status === 200 && first.json?.status === 'accepted') {
    msgIdHex = typeof first.json?.msg_id === 'string' ? first.json.msg_id : null;
    ok('ingest_valid', `msg_id=${first.json.msg_id}`);
  } else {
    fail('ingest_valid', `status=${first.res.status} body=${first.text}`);
  }

  const second = await httpJson(`${url}/v1/ingest/sos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(baseBody),
  });

  if (second.res.status === 409 && second.json?.error === 'duplicate') {
    ok('ingest_duplicate', `msg_id=${second.json.msg_id}`);
  } else {
    fail('ingest_duplicate', `status=${second.res.status} body=${second.text}`);
  }

  // 3) Tamper check
  const tamperedPayload = Buffer.from(payload);
  tamperedPayload[tamperedPayload.length - 1] = tamperedPayload[tamperedPayload.length - 1] ^ 0xff;

  const tamper = await httpJson(`${url}/v1/ingest/sos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...baseBody,
      payload_b64: tamperedPayload.toString('base64'),
    }),
  });

  if (tamper.res.status === 401 && tamper.json?.error === 'invalid_signature') {
    ok('ingest_tamper_rejected', 'invalid_signature');
  } else {
    fail('ingest_tamper_rejected', `status=${tamper.res.status} body=${tamper.text}`);
  }

  // 4) Recent query contains at least 1 item
  const recent = await httpJson(`${url}/v1/sos/recent?since=0`);
  if (recent.res.status === 200 && Array.isArray(recent.json?.items) && recent.json.items.length >= 1) {
    ok('recent_query', `count=${recent.json.items.length}`);
  } else {
    fail('recent_query', `status=${recent.res.status} body=${recent.text}`);
  }

  // 5) Structured logging evidence (from Postgres)
  // This is only reliable for local runs where the proof runner can reach the DB.
  const isLocalUrl = url.startsWith('http://127.0.0.1:') || url === 'http://127.0.0.1' || url.startsWith('http://localhost:') || url === 'http://localhost';
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://echo:echo@localhost:5432/echo';
  if (!isLocalUrl) {
    note('log_evidence skipped (requires local URL + DATABASE_URL)');
    return;
  }

  try {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const result = await client.query(
      `SELECT ts, level, event, req_id, msg_id_hex, http_status, gateway_id, rssi
       FROM event_logs
       WHERE gateway_id = $1
          OR ($2::text IS NOT NULL AND msg_id_hex = $2)
       ORDER BY ts DESC
       LIMIT 25`,
      ['PROOF-GW-1', msgIdHex]
    );

    console.log('EVIDENCE event_logs (latest 25)');
    for (const row of result.rows) {
      console.log(
        `LOG ${new Date(row.ts).toISOString()} level=${row.level} event=${row.event}` +
          ` req_id=${row.req_id ?? '-'} msg_id=${row.msg_id_hex ?? '-'}` +
          ` status=${row.http_status ?? '-'} gw=${row.gateway_id ?? '-'} rssi=${row.rssi ?? '-'}`
      );
    }

    await client.end();
  } catch (err) {
    note(`log_evidence failed: ${String(err)}`);
  }
}

async function main() {
  // If user points us at an existing server, only run checks.
  if (explicitUrl) {
    note(`using ECHO_URL=${baseUrl}`);
    await runChecks(baseUrl);
    return;
  }

  // First try: if something is already healthy at default URL, just use it.
  const existing = await tryHealth(baseUrl);
  if (existing.ok) {
    note(`backend already running at ${baseUrl}`);
    await runChecks(baseUrl);
    return;
  }

  if (!autoStart) {
    fail('healthz', `backend not reachable at ${baseUrl}. Start it (and PostGIS) or set ECHO_URL.`);
    return;
  }

  const port = await findFreePort(3000);
  const url = `http://127.0.0.1:${port}`;
  note(`spawning backend on ${url}`);
  const child = spawnBackend(port);

  const healthy = await waitForHealthy(url);
  if (!healthy) {
    child.kill('SIGTERM');
    fail('healthz', `spawned backend did not become healthy on ${url}. Is PostGIS running?`);
    return;
  }

  try {
    await runChecks(url);
  } finally {
    child.kill('SIGTERM');
  }
}

await main();
