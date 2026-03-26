import test from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';

import { parseSosPayloadV1 } from '../src/sosPayloadV1.mjs';
import { verifyEd25519 } from '../src/ed25519.mjs';

function buildPayload({
  msgId,
  tsUnixMs,
  latE7,
  lonE7,
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
  buf.writeInt32LE(latE7, 25);
  buf.writeInt32LE(lonE7, 29);
  buf.writeUInt16LE(accuracyM, 33);
  buf.writeUInt8(batteryPct, 35);
  buf.writeUInt8(emergencyCode, 36);
  buf.writeUInt16LE(flags, 37);
  buf.writeUInt8(ttlHops, 39);
  return buf;
}

test('parseSosPayloadV1 parses expected fields', () => {
  const msgId = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const payload = buildPayload({
    msgId,
    tsUnixMs: 1710000000000,
    latE7: 99312000,
    lonE7: 762673000,
    accuracyM: 25,
    batteryPct: 54,
    emergencyCode: 2,
    flags: 7,
    ttlHops: 16,
  });

  const parsed = parseSosPayloadV1(payload);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.msgIdHex, msgId.toString('hex'));
  assert.equal(parsed.tsUnixMs, 1710000000000);
  assert.equal(parsed.latE7, 99312000);
  assert.equal(parsed.lonE7, 762673000);
  assert.equal(parsed.accuracyM, 25);
  assert.equal(parsed.batteryPct, 54);
  assert.equal(parsed.emergencyCode, 2);
  assert.equal(parsed.flags, 7);
  assert.equal(parsed.ttlHops, 16);
});

test('parseSosPayloadV1 rejects unsupported version', () => {
  const msgId = Buffer.alloc(16, 1);
  const payload = buildPayload({
    msgId,
    tsUnixMs: 1,
    latE7: 1,
    lonE7: 1,
    accuracyM: 1,
    batteryPct: 1,
    emergencyCode: 1,
    flags: 1,
    ttlHops: 1,
  });
  payload.writeUInt8(2, 0);

  assert.throws(() => parseSosPayloadV1(payload), /unsupported payload version/i);
});

test('verifyEd25519 validates signature and fails on tamper', () => {
  const keypair = nacl.sign.keyPair();
  const payload = Buffer.from('hello');
  const sig = Buffer.from(nacl.sign.detached(new Uint8Array(payload), keypair.secretKey));
  const pub = Buffer.from(keypair.publicKey);

  assert.equal(verifyEd25519({ payload, pubkey: pub, signature: sig }), true);

  const tampered = Buffer.from(payload);
  tampered[0] = tampered[0] ^ 0xff;
  assert.equal(verifyEd25519({ payload: tampered, pubkey: pub, signature: sig }), false);
});
