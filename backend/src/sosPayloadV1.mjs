export function parseSosPayloadV1(payload) {
  if (!Buffer.isBuffer(payload)) {
    throw new Error('payload must be a Buffer');
  }

  // Minimum required bytes for fields we parse.
  // version(1) + msg_id(16) + ts(8) + lat(4) + lon(4) + accuracy(2) + battery(1)
  // + code(1) + flags(2) + ttl(1) = 40
  if (payload.length < 40) {
    throw new Error('payload too short');
  }

  const version = payload.readUInt8(0);
  if (version !== 1) {
    throw new Error(`unsupported payload version: ${version}`);
  }

  const msgId = payload.subarray(1, 17);
  const tsUnixMs = readUInt64LE(payload, 17);
  const latE7 = payload.readInt32LE(25);
  const lonE7 = payload.readInt32LE(29);
  const accuracyM = payload.readUInt16LE(33);
  const batteryPct = payload.readUInt8(35);
  const emergencyCode = payload.readUInt8(36);
  const flags = payload.readUInt16LE(37);
  const ttlHops = payload.readUInt8(39);

  return {
    version,
    msgId,
    msgIdHex: msgId.toString('hex'),
    tsUnixMs,
    latE7,
    lonE7,
    accuracyM,
    batteryPct,
    emergencyCode,
    flags,
    ttlHops,
  };
}

function readUInt64LE(buf, offset) {
  // Node supports readBigUInt64LE; keep a safe conversion to Number for ms timestamps.
  const value = buf.readBigUInt64LE(offset);
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error('u64 value exceeds JS safe integer range');
  }
  return asNumber;
}
