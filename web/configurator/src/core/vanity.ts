/** Vanity identity helpers: MeshCore private-key format and prefix rules. */

/**
 * MeshCore stores the expanded Ed25519 key (orlp/ed25519): SHA-512 of the
 * 32-byte seed with the scalar half clamped. tweetnacl's secretKey is
 * seed||publicKey instead, which the firmware would read as a different key.
 * Returns the 64 bytes for `set prv.key`.
 */
export function meshcorePrivateKeyFromSeed(
  seed: Uint8Array,
  sha512: (m: Uint8Array) => Uint8Array,
): Uint8Array {
  const prv = Uint8Array.from(sha512(seed));
  prv[0] &= 248;
  prv[31] &= 63;
  prv[31] |= 64;
  return prv;
}

/** Firmware rejects keys whose public key starts with byte 00 or ff. */
export function isAllowedPrefix(prefix: string): boolean {
  const p = String(prefix || "").toLowerCase();
  return !(p.startsWith("00") || p.startsWith("ff"));
}

/** Public key hex from "OK, reboot to apply! New pubkey: ...", else null. */
export function pubkeyFromSetReply(reply: string): string | null {
  const m = /New pubkey:\s*([0-9a-f]{64})/i.exec(String(reply || ""));
  return m ? m[1].toLowerCase() : null;
}
