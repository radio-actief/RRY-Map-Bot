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

/** A prefix the vanity generator takes: 1 to 4 lowercase hex characters (old page). */
export const VANITY_PREFIX = /^[0-9a-f]{1,4}$/;
export const VANITY_PREFIX_MAX = 4;

/** The search gives up after this many keys (old page's maxAttempts). */
export const VANITY_MAX_ATTEMPTS = 5_000_000;

/** The parts of tweetnacl the generator uses (injected, so tests can fix the seed). */
export type VanityNacl = {
  randomBytes(n: number): Uint8Array;
  hash(m: Uint8Array): Uint8Array;
  sign: { keyPair: { fromSeed(seed: Uint8Array): { publicKey: Uint8Array } } };
};

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A generated identity: the public key and the private key for `set prv.key`, both hex. */
export type VanityKey = { publicKey: string; privateKey: string };

/**
 * One batch of the vanity search: up to `tries` random seeds; the first whose public key starts
 * with `prefix` (and does not start with a byte the firmware rejects), with how many were tried.
 */
export function searchVanity(prefix: string, tries: number, nacl: VanityNacl): { found: VanityKey | null; tried: number } {
  for (let i = 1; i <= tries; i++) {
    const seed = nacl.randomBytes(32);
    const publicKey = toHex(nacl.sign.keyPair.fromSeed(seed).publicKey);
    if (publicKey.startsWith(prefix) && isAllowedPrefix(publicKey)) {
      return { found: { publicKey, privateKey: toHex(meshcorePrivateKeyFromSeed(seed, nacl.hash)) }, tried: i };
    }
  }
  return { found: null, tried: tries };
}
