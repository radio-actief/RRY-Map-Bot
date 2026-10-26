import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfiguratorModules } from "./load-module.mjs";

const win = loadConfiguratorModules(
  "lib/tweetnacl.min.js",
  "src/configurator/vanity.js",
);
const { vanity } = win.ConfiguratorApp;

function fromHex(hex) {
  return Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
}
function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Reference vector from MeshCore's own lib/ed25519 ed25519_create_keypair(seed).
const SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const MESHCORE_PRV =
  "3894eea49c580aef816935762be049559d6d1440dede12e6a125f1841fff8e6f" +
  "a9d71862a3e5746b571be3d187b0041046f52ebd850c7cbd5fde8ee38473b649";
const MESHCORE_PUB =
  "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";

test("converts a seed to the 64-byte private key MeshCore stores", () => {
  const prv = vanity.meshcorePrivateKeyFromSeed(fromHex(SEED), win.nacl.hash);
  assert.equal(toHex(prv), MESHCORE_PRV);
});

test("tweetnacl's public key for the seed matches MeshCore's", () => {
  const kp = win.nacl.sign.keyPair.fromSeed(fromHex(SEED));
  assert.equal(toHex(kp.publicKey), MESHCORE_PUB);
});

test("refuses prefixes the firmware rejects (00 and ff first byte)", () => {
  assert.equal(vanity.isAllowedPrefix("00"), false);
  assert.equal(vanity.isAllowedPrefix("ff1"), false);
  assert.equal(vanity.isAllowedPrefix("0"), true);
  assert.equal(vanity.isAllowedPrefix("f"), true);
  assert.equal(vanity.isAllowedPrefix("be"), true);
});

test("reads the new public key from the set prv.key reply", () => {
  assert.equal(
    vanity.pubkeyFromSetReply("OK, reboot to apply! New pubkey: " + MESHCORE_PUB.toUpperCase()),
    MESHCORE_PUB,
  );
  assert.equal(vanity.pubkeyFromSetReply("Error, bad key"), null);
});
