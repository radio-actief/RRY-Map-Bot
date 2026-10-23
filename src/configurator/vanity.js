/**
 * Vanity identity helpers: MeshCore private-key format and prefix rules.
 */
(function (App) {
  "use strict";

  /**
   * MeshCore stores the expanded Ed25519 key (orlp/ed25519): SHA-512 of the
   * 32-byte seed with the scalar half clamped. tweetnacl's secretKey is
   * seed‖publicKey instead, which the firmware would read as a different key.
   * @param {Uint8Array} seed 32 bytes
   * @param {(msg: Uint8Array) => Uint8Array} sha512 e.g. nacl.hash
   * @returns {Uint8Array} 64 bytes for `set prv.key`
   */
  function meshcorePrivateKeyFromSeed(seed, sha512) {
    const prv = Uint8Array.from(sha512(seed));
    prv[0] &= 248;
    prv[31] &= 63;
    prv[31] |= 64;
    return prv;
  }

  /** Firmware rejects keys whose public key starts with byte 00 or ff. */
  function isAllowedPrefix(prefix) {
    const p = String(prefix || "").toLowerCase();
    return !(p.startsWith("00") || p.startsWith("ff"));
  }

  /** Public key hex from "OK, reboot to apply! New pubkey: …", else null. */
  function pubkeyFromSetReply(reply) {
    const m = /New pubkey:\s*([0-9a-f]{64})/i.exec(String(reply || ""));
    return m ? m[1].toLowerCase() : null;
  }

  App.vanity = {
    meshcorePrivateKeyFromSeed: meshcorePrivateKeyFromSeed,
    isAllowedPrefix: isAllowedPrefix,
    pubkeyFromSetReply: pubkeyFromSetReply,
  };
})(window.ConfiguratorApp);
