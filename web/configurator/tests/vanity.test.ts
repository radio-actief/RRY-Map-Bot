import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import {
  isAllowedPrefix,
  meshcorePrivateKeyFromSeed,
  pubkeyFromSetReply,
} from "../src/core/vanity";

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// Reference vector from MeshCore's own lib/ed25519 ed25519_create_keypair(seed).
const SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const MESHCORE_PRV =
  "3894eea49c580aef816935762be049559d6d1440dede12e6a125f1841fff8e6f" +
  "a9d71862a3e5746b571be3d187b0041046f52ebd850c7cbd5fde8ee38473b649";
const MESHCORE_PUB = "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";

describe("vanity helpers", () => {
  it("converts a seed to the 64-byte private key MeshCore stores", () => {
    expect(toHex(meshcorePrivateKeyFromSeed(fromHex(SEED), nacl.hash))).toBe(MESHCORE_PRV);
  });

  it("matches MeshCore's public key for the seed via tweetnacl", () => {
    expect(toHex(nacl.sign.keyPair.fromSeed(fromHex(SEED)).publicKey)).toBe(MESHCORE_PUB);
  });

  it("refuses prefixes the firmware rejects (00 and ff first byte)", () => {
    expect(isAllowedPrefix("00")).toBe(false);
    expect(isAllowedPrefix("ff1")).toBe(false);
    expect(isAllowedPrefix("0")).toBe(true);
    expect(isAllowedPrefix("f")).toBe(true);
    expect(isAllowedPrefix("be")).toBe(true);
  });

  it("reads the new public key from the set prv.key reply", () => {
    expect(pubkeyFromSetReply("OK, reboot to apply! New pubkey: " + MESHCORE_PUB.toUpperCase())).toBe(
      MESHCORE_PUB,
    );
    expect(pubkeyFromSetReply("Error, bad key")).toBeNull();
  });
});
