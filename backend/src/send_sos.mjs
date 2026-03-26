import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import minimist from 'minimist';
import nacl from 'tweetnacl';

const args = minimist(process.argv.slice(2), {
  string: ['url', 'msg-id', 'keyfile'],
  boolean: ['tamper'],
  default: {
    url: 'http://127.0.0.1:3000',
    lat: 9.9312,
    lon: 76.2673,
    accuracy: 25,
    battery: 50,
    code: 1,
    flags: 0,
    ttl: 16,
    repeat: 1,
    gateway: 'DEV-GW-1',
    rssi: -70,
  },
});

const url = String(args.url).replace(/\/$/, '');
const lat = Number(args.lat);
const lon = Number(args.lon);
const accuracyM = Number(args.accuracy);
const batteryPct = Number(args.battery);
const emergencyCode = Number(args.code);
const flags = Number(args.flags);
const ttlHops = Number(args.ttl);
const repeat = Math.max(1, Number(args.repeat) || 1);
const gatewayId = String(args.gateway);
const rssi = Number.isFinite(Number(args.rssi)) ? Number(args.rssi) : null;

if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error('Invalid --lat/--lon');
  process.exit(1);
}

const keyfile = args.keyfile ? String(args.keyfile) : null;
const keypair = await loadOrCreateKeypair(keyfile);

const msgId = args['msg-id'] ? fromHex(String(args['msg-id'])) : crypto.randomBytes(16);
if (msgId.length !== 16) {
  console.error('--msg-id must be 32 hex chars (16 bytes)');
  process.exit(1);
}

const tsUnixMs = Date.now();
const payload = buildSosPayloadV1({
  msgId,
  tsUnixMs,
  lat,
  lon,
  accuracyM,
  batteryPct,
  emergencyCode,
  flags,
  ttlHops,
});

const signature = Buffer.from(nacl.sign.detached(new Uint8Array(payload), keypair.secretKey));
const pubkey = Buffer.from(keypair.publicKey);

if (args.tamper) {
  // Flip one byte after signing to intentionally break verification.
  payload[payload.length - 1] = payload[payload.length - 1] ^ 0xff;
}

const body = {
  payload_b64: payload.toString('base64'),
  pubkey_b64: pubkey.toString('base64'),
  sig_b64: signature.toString('base64'),
  rssi,
  gateway_id: gatewayId,
  received_at_unix_ms: tsUnixMs,
};

console.log(`msg_id_hex=${msgId.toString('hex')}`);

for (let i = 0; i < repeat; i++) {
  const res = await fetch(`${url}/v1/ingest/sos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`POST attempt ${i + 1}/${repeat}: ${res.status} ${text}`);
}

function buildSosPayloadV1({
  msgId,
  tsUnixMs,
  lat,
  lon,
  accuracyM,
  batteryPct,
  emergencyCode,
  flags,
  ttlHops,
}) {
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

function fromHex(hex) {
  const cleaned = hex.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(cleaned) || cleaned.length % 2 !== 0) {
    return Buffer.alloc(0);
  }
  return Buffer.from(cleaned, 'hex');
}

async function loadOrCreateKeypair(keyfilePath) {
  if (!keyfilePath) {
    return nacl.sign.keyPair();
  }

  try {
    const raw = await fs.readFile(keyfilePath, 'utf8');
    const parsed = JSON.parse(raw);
    const publicKey = Buffer.from(parsed.publicKey_b64, 'base64');
    const secretKey = Buffer.from(parsed.secretKey_b64, 'base64');
    if (publicKey.length !== 32 || secretKey.length !== 64) {
      throw new Error('invalid key lengths');
    }
    return { publicKey: new Uint8Array(publicKey), secretKey: new Uint8Array(secretKey) };
  } catch {
    const kp = nacl.sign.keyPair();
    const out = {
      publicKey_b64: Buffer.from(kp.publicKey).toString('base64'),
      secretKey_b64: Buffer.from(kp.secretKey).toString('base64'),
    };
    await fs.writeFile(keyfilePath, JSON.stringify(out, null, 2));
    return kp;
  }
}
