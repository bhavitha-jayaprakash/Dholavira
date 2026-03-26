import nacl from 'tweetnacl';

export function verifyEd25519({ payload, pubkey, signature }) {
  if (!Buffer.isBuffer(payload) || !Buffer.isBuffer(pubkey) || !Buffer.isBuffer(signature)) {
    throw new Error('payload/pubkey/signature must be Buffers');
  }
  if (pubkey.length !== 32) {
    return false;
  }
  if (signature.length !== 64) {
    return false;
  }
  return nacl.sign.detached.verify(
    new Uint8Array(payload),
    new Uint8Array(signature),
    new Uint8Array(pubkey)
  );
}
