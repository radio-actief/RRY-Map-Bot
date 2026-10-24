import { describe, expect, it } from "vitest";
import { REGION_DEF_MIN_TEXT, parseVersion, supportsRegionDef } from "../src/core/firmware";

describe("parseVersion", () => {
  it("parses the ver reply of stock MeshCore", () => {
    const v = parseVersion("v1.17.1 (Build: 14 Aug 2026)");
    expect([v?.major, v?.minor, v?.patch]).toEqual([1, 17, 1]);
  });
  it("parses versions with a suffix or without the v", () => {
    const a = parseVersion("v1.16.0-abc123 (Build: 1 Jul 2026)");
    expect([a?.major, a?.minor, a?.patch]).toEqual([1, 16, 0]);
    const b = parseVersion("1.15");
    expect([b?.major, b?.minor, b?.patch]).toEqual([1, 15, 0]);
  });
  it("returns null when no version can be found", () => {
    expect(parseVersion("garbage")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("Unknown command")).toBeNull();
  });
});

describe("supportsRegionDef", () => {
  it("needs 1.16 or newer", () => {
    expect(supportsRegionDef(parseVersion("v1.15.9"))).toBe(false);
    expect(supportsRegionDef(parseVersion("v1.16.0"))).toBe(true);
    expect(supportsRegionDef(parseVersion("v2.0.0"))).toBe(true);
    expect(supportsRegionDef(parseVersion("v0.99.0"))).toBe(false);
    expect(supportsRegionDef(null)).toBe(false);
  });
  it("exposes the minimum as text", () => {
    expect(REGION_DEF_MIN_TEXT).toBe("1.16");
  });
});
