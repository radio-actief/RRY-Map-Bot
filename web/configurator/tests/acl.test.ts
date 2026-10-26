import { describe, expect, it } from "vitest";
import { aclChanges, aclLines, normaliseKey, parseAcl } from "../src/core/acl";

const K1 = "a1".repeat(32), K2 = "9f".repeat(32), K3 = "55".repeat(32);

describe("access list", () => {
  it("parseAcl reads roles and keys, skipping junk", () => {
    expect(parseAcl(`ACL:\r\n03 ${K1.toUpperCase()}\n02 ${K2}\nnoise\n`)).toEqual([{ key: K1, role: 3 }, { key: K2, role: 2 }]);
    expect(parseAcl("ACL:\r\n")).toEqual([]);
    expect(parseAcl("Unknown command")).toBeNull();
    expect(parseAcl(`ACL:\n83 ${K1}\n`)).toEqual([{ key: K1, role: 3, perms: 0x83 }]);
    expect(parseAcl(`ACL:\n00 ${K1}\n`)).toEqual([]);
  });
  it("normaliseKey", () => {
    expect(normaliseKey(` ${K1.slice(0, 8).toUpperCase()}-${K1.slice(8, 32)} ${K1.slice(32)} `)).toBe(K1);
    expect(normaliseKey(K1.slice(1))).toBeNull();
    expect(normaliseKey("zz".repeat(32))).toBeNull();
  });
  it("aclLines removes first, then adds and role changes; unchanged entries send nothing", () => {
    const from = [{ key: K1, role: 3 as const }, { key: K2, role: 2 as const }, { key: K3, role: 1 as const }];
    const to = [{ key: K1, role: 3 as const }, { key: K2, role: 3 as const }, { key: "0a".repeat(32), role: 3 as const }];
    expect(aclLines(from, to)).toEqual([`setperm ${K3} 0`, `setperm ${K2} 3`, `setperm ${"0a".repeat(32)} 3`]);
    expect(aclChanges(from, to)).toBe(3);
    expect(aclLines(to, to)).toEqual([]);
  });
  it("re-adding a removed key with its old role is no change", () => {
    const from = [{ key: K1, role: 2 as const }];
    expect(aclLines(from, [{ key: K1, role: 2 }])).toEqual([]);
  });
  it("raw perms above the role send nothing; undefined counts as empty", () => {
    const e = [{ key: K1, role: 3 as const, perms: 0x83 }];
    expect(aclLines(e, [{ key: K1, role: 3 }])).toEqual([]);
    expect(aclChanges(undefined, e)).toBe(1);
    expect(aclChanges(e, undefined)).toBe(1);
    expect(aclChanges(undefined, undefined)).toBe(0);
  });
});
